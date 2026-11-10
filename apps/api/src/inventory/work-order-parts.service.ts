import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  ConsumePartRequest,
  PartConsumptionView,
} from '@teknikflow/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { IdempotencyService, type IdempotencyOutcome } from '../execution/idempotency.service.js';
import { toPartConsumptionView } from './inventory-views.js';
import { InventoryService } from './inventory.service.js';

/**
 * Faz 09 — iş emri parça tüketimi (J2 yolculuğu; ADR-0011).
 *
 * ATOMİK tüketim: CONSUME hareketi + bakiye + (varsa) rezervasyon
 * ilerlemesi + iş emri olayı TEK kiracı transaction'ında. Idempotency
 * anahtarı (x-idempotency-key, Faz 08 altyapısı) hem API oynatmasını hem
 * defter movementKey'ini besler — uçak modu kurtarma/çift dokunuş TEK
 * tüketim satırı üretir.
 *
 * Kaynak düzeyi yetki:
 *  - work_orders:complete (denetleyici kapısı) + atanmış teknisyen YA DA
 *    stock:manage (ofis/depocu adına tüketim).
 *  - Depo çözümü: input.warehouseId yoksa teknisyenin KENDİ aracı deposu
 *    (VEHICLE, assignedTo=kullanıcı). stock:manage OLMAYAN teknisyen
 *    yalnız kendi aracından tüketebilir — başka depo 403.
 */

const PARTS_INCLUDE = {
  stockItem: { select: { sku: true, name: true, unit: true, trackingMode: true } },
  lot: { select: { lotNo: true } },
  fromWarehouse: { select: { name: true } },
  actor: { select: { displayName: true } },
} satisfies Prisma.StockMovementInclude;

function notFound(message = 'Kayıt bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({ message: 'Bu işlem için yetkiniz yok', code: 'FORBIDDEN' });
}

@Injectable()
export class WorkOrderPartsService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    private readonly inventory: InventoryService,
  ) {}

  async consumePart(
    tenantId: string,
    workOrderId: string,
    input: ConsumePartRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<PartConsumptionView>> {
    return this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/parts',
      async (tx) => {
        // 1) İş emri yürütülebilir mi?
        const workOrder = await tx.workOrder.findFirst({
          where: { id: workOrderId, tenantId },
          select: { id: true, status: true, assignedToId: true },
        });
        if (!workOrder) throw notFound('İş emri bulunamadı');
        if (workOrder.status === 'CLOSED' || workOrder.status === 'CANCELLED') {
          throw new ConflictException({
            message: 'Kapatılmış veya iptal edilmiş iş emrine parça tüketimi yazılamaz',
            code: 'WORK_ORDER_IMMUTABLE',
          });
        }

        // 2) Kaynak düzeyi yetki — atanmış ya da tam stok yönetimi.
        const hasManage = actor.permissions.has('stock:manage');
        if (!hasManage) {
          const assigned =
            workOrder.assignedToId === actor.userId ||
            (await tx.workOrderAssignment.findFirst({
              where: {
                workOrderId: workOrder.id,
                userId: actor.userId,
                status: 'ACTIVE',
              },
              select: { id: true },
            }));
          if (!assigned) throw forbidden();
        }

        // 3) Rezervasyon tercihi — kilit sahibi iş emriyle aynı olmalı.
        let reservation: {
          id: string;
          warehouseId: string;
          lotId: string | null;
          stockItemId: string;
        } | null = null;
        if (input.reservationId) {
          const row = await tx.stockReservation.findFirst({
            where: { id: input.reservationId, tenantId, workOrderId: workOrder.id },
            select: { id: true, warehouseId: true, lotId: true, stockItemId: true, status: true },
          });
          if (!row || row.status === 'RELEASED' || row.status === 'CONSUMED') {
            throw new ConflictException({
              message: 'Rezervasyon tüketim için geçerli değil',
              code: 'RESERVATION_INVALID',
            });
          }
          if (row.stockItemId !== input.itemId) {
            throw new ConflictException({
              message: 'Rezervasyon farklı bir kalem için yapılmış',
              code: 'RESERVATION_ITEM_MISMATCH',
            });
          }
          if (input.lotId && row.lotId && input.lotId !== row.lotId) {
            throw new ConflictException({
              message: 'Rezervasyon farklı bir lot için yapılmış',
              code: 'RESERVATION_LOT_MISMATCH',
            });
          }
          reservation = row;
        }

        // 4) Depo çözümü: açık seçim → stock:manage gerekir; aksi kendi araç stoğu.
        let warehouseId = reservation?.warehouseId ?? input.warehouseId;
        if (!warehouseId) {
          const van = await tx.warehouse.findFirst({
            where: {
              tenantId,
              type: 'VEHICLE',
              assignedToId: actor.userId,
              active: true,
            },
            select: { id: true },
          });
          if (!van) {
            throw new ConflictException({
              message:
                'Tüketim deposu belirlenemedi — size bağlı araç deposu yok, depo belirtin',
              code: 'VAN_WAREHOUSE_MISSING',
            });
          }
          warehouseId = van.id;
        } else if (!hasManage) {
          // Yalnız stock:issue_own sahibi: başka depoyu seçemez.
          const warehouse = await tx.warehouse.findFirst({
            where: { id: warehouseId, tenantId, active: true },
            select: { id: true, type: true, assignedToId: true },
          });
          if (!warehouse) throw notFound('Depo bulunamadı');
          const ownVan =
            warehouse.type === 'VEHICLE' && warehouse.assignedToId === actor.userId;
          if (!ownVan) throw forbidden();
        }

        // 5) ATOMİK tüketim — hareket + bakiye + rezervasyon tek geçişte.
        const movementKey = opts.idempotencyKey ?? randomUUID();
        const movement = await this.inventory.applyMovementForParts(tx, tenantId, actor.userId, {
          itemId: input.itemId,
          ...(input.lotId ? { lotId: input.lotId } : {}),
          ...(reservation?.lotId && !input.lotId ? { lotId: reservation.lotId } : {}),
          quantity: input.quantity,
          fromWarehouseId: warehouseId,
          reservationId: reservation?.id,
          referenceType: 'work_order',
          referenceId: workOrder.id,
          movementKey,
          ...(input.note ? { note: input.note } : {}),
        });

        // 6) İş emri olayı — servis raporu ve geçmiş için.
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            eventType: 'work_order.part_consumed',
            actorId: actor.userId,
            metadataJson: {
              movementId: movement.id,
              itemId: input.itemId,
              sku: movement.stockItem.sku,
              quantity: input.quantity,
              warehouseId,
              lotId: movement.lotId,
              unitCostMinor: movement.unitCostMinor,
            },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'work_order.part_consume',
          resourceType: 'work_order',
          resourceId: workOrder.id,
          requestId: actor.requestId,
          metadata: {
            movementId: movement.id,
            itemId: input.itemId,
            quantity: input.quantity,
          },
        });
        return toPartConsumptionView(movement);
      },
    );
  }

  /** İş emrinin parça tüketimi — CONSUME defter satırları (referansla). */
  async listParts(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<PartConsumptionView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: { id: true, assignedToId: true },
      });
      if (!workOrder) throw notFound('İş emri bulunamadı');
      if (
        !viewer.permissions.has('work_orders:view_all') &&
        workOrder.assignedToId !== viewer.userId
      ) {
        const active = await tx.workOrderAssignment.findFirst({
          where: { workOrderId: workOrder.id, userId: viewer.userId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!active) throw forbidden();
      }
      const rows = await tx.stockMovement.findMany({
        where: {
          tenantId,
          movementType: 'CONSUME',
          referenceType: 'work_order',
          referenceId: workOrder.id,
        },
        orderBy: { occurredAt: 'asc' },
        include: PARTS_INCLUDE,
      });
      return rows.map(toPartConsumptionView);
    });
  }
}
