import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BalanceListQuery,
  BalanceView,
  BinView,
  CreateBinRequest,
  CreateMovementRequest,
  CreateReservationRequest,
  CreateStockCountRequest,
  CreateStockItemRequest,
  CreateWarehouseRequest,
  MovementListQuery,
  MovementView,
  ReservationView,
  StockCountView,
  StockItemListQuery,
  StockItemView,
  SubmitCountLineRequest,
  UpdateStockItemRequest,
} from '@teknikflow/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import {
  countDelta,
  countDirection,
  insufficientOutgoing,
  isLotExpired,
  movementDeltas,
  movementDeltasForAdjustment,
  qtyToView,
  validateMovementShape,
  type StockMovementType,
} from './inventory-engine.js';
import {
  toBalanceView,
  toBinView,
  toCountLineView,
  toMovementView,
  toReservationView,
  toStockCountView,
  toStockItemView,
  toWarehouseView,
} from './inventory-views.js';

/**
 * Faz 09 — stok servisi (ADR-0011).
 *
 * Değişmezler:
 * - Hareketler APPEND-ONLY: StockMovement satırı asla güncellenmez/silinmez.
 * - Bakiye hareketle AYNI transaction'da güncellenir; OUT tarafı
 *   `SELECT … FOR UPDATE` ile kilitlenir (esnek bakiye yarışı kapalı).
 * - Negatif stok ONAYSIZ olamaz: serbest bakiye (onHand − reserved)
 *   yetersizse 409 NEGATIVE_STOCK_FORBIDDEN. Onaylı tek istisna sayım
 *   kapanışı ADJUSTMENT'i (farklar denetimli düzeltme hareketidir).
 * - movementKey kiracı başına benzersiz: çift gönderim/tekrar TEK satır
 *   üretir; yarışta kaybeden taraf saklanan satırı oynatır (replayed).
 *
 * Kaynak düzeyi yetki: genel hareket ucu stock:manage (ADJUSTMENT dahil);
 * stock:manage_limited yalnız RECEIVE/TRANSFER/ISSUE/RETURN (denetleyicide
 * ek olarak burada doğrulanır — ROLES_PERMISSIONS.md "Limited" satırı).
 */

const MOVEMENT_INCLUDE = {
  stockItem: { select: { sku: true, name: true, unit: true, trackingMode: true } },
  lot: { select: { lotNo: true, expiresAt: true } },
  fromWarehouse: { select: { name: true } },
  toWarehouse: { select: { name: true } },
  actor: { select: { displayName: true } },
} satisfies Prisma.StockMovementInclude;

const BALANCE_INCLUDE = {
  stockItem: {
    select: { sku: true, name: true, unit: true, trackingMode: true, reorderPoint: true, active: true },
  },
  warehouse: { select: { name: true, type: true } },
  lot: { select: { lotNo: true, expiresAt: true } },
} satisfies Prisma.StockBalanceInclude;

function notFound(message = 'Kayıt bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({ message: 'Bu işlem için yetkiniz yok', code: 'FORBIDDEN' });
}

/** Hareket parametreleri — motor çağrı sözleşmesi (servisler paylaşır). */
export interface MovementParams {
  type: StockMovementType;
  itemId: string;
  lotId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  movementKey?: string;
  note?: string;
  occurredAt?: Date;
  /** Yalnız ADJUSTMENT için: pozitif düzeltme IN, eksik (fire) OUT. */
  adjustmentDirection?: 'IN' | 'OUT';
  /** Rezervasyon içinden tüketim: bakiye reservedQty'si de düşülür. */
  reservationId?: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ========================= Katalog (SKU) =========================

  async createItem(
    tenantId: string,
    input: CreateStockItemRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<StockItemView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      try {
        const item = await tx.stockItem.create({
          data: {
            tenantId,
            sku: input.sku,
            name: input.name,
            description: input.description ?? null,
            unit: input.unit,
            trackingMode: input.trackingMode,
            reorderPoint: input.reorderPoint,
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'inventory.item_create',
          resourceType: 'stock_item',
          resourceId: item.id,
          requestId: actor.requestId,
          metadata: { sku: item.sku, trackingMode: item.trackingMode },
        });
        return toStockItemView(item, 0);
      } catch (error) {
        if (isUniqueViolation(error, 'stock_items_tenantId_sku_key')) {
          throw new ConflictException({
            message: `SKU zaten kayıtlı: ${input.sku}`,
            code: 'ITEM_DUPLICATE',
          });
        }
        throw error;
      }
    });
  }

  async updateItem(
    tenantId: string,
    itemId: string,
    input: UpdateStockItemRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<StockItemView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const item = await tx.stockItem.findFirst({ where: { id: itemId, tenantId } });
      if (!item) throw notFound('Stok kalem bulunamadı');
      const updated = await tx.stockItem.update({
        where: { id: item.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.unit !== undefined ? { unit: input.unit } : {}),
          ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'inventory.item_update',
        resourceType: 'stock_item',
        resourceId: item.id,
        requestId: actor.requestId,
        metadata: { sku: item.sku, changes: Object.keys(input) },
      });
      const total = await sumOnHand(tx, tenantId, item.id);
      return toStockItemView(updated, total);
    });
  }

  async listItem(tenantId: string, itemId: string): Promise<StockItemView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const item = await tx.stockItem.findFirst({ where: { id: itemId, tenantId } });
      if (!item) throw notFound('Stok kalem bulunamadı');
      const total = await sumOnHand(tx, tenantId, item.id);
      return toStockItemView(item, total);
    });
  }

  async listItems(
    tenantId: string,
    query: StockItemListQuery,
  ): Promise<{ data: StockItemView[]; total: number; page: number; pageSize: number }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const where: Prisma.StockItemWhereInput = {
        tenantId,
        ...(query.active ? { active: query.active === 'true' } : {}),
        ...(query.trackingMode ? { trackingMode: query.trackingMode } : {}),
        ...(query.q
          ? {
              OR: [
                { sku: { contains: query.q, mode: 'insensitive' as const } },
                { name: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [rows, total, sums] = await Promise.all([
        tx.stockItem.findMany({
          where,
          orderBy: [{ sku: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.stockItem.count({ where }),
        tx.stockBalance.groupBy({
          by: ['stockItemId'],
          where: { tenantId },
          _sum: { onHand: true },
        }),
      ]);
      const sumMap = new Map(sums.map((s) => [s.stockItemId, qtyToView(Number(s._sum.onHand ?? 0))]));
      let views = rows.map((item) => toStockItemView(item, sumMap.get(item.id) ?? 0));
      if (query.lowStock === 'true') views = views.filter((view) => view.lowStock);
      return { data: views, total, page: query.page, pageSize: query.pageSize };
    });
  }

  // ========================= Depo / raf =========================

  async createWarehouse(
    tenantId: string,
    input: CreateWarehouseRequest,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      if (input.assignedToId) {
        const owner = await tx.user.findFirst({
          where: { id: input.assignedToId, memberships: { some: { tenantId } } },
          select: { id: true },
        });
        if (!owner) throw notFound('Depo sorumlusu kullanıcı bulunamadı');
      }
      if (input.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: input.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw notFound('Şube bulunamadı');
      }
      try {
        const warehouse = await tx.warehouse.create({
          data: {
            tenantId,
            name: input.name,
            type: input.type,
            branchId: input.branchId ?? null,
            assignedToId: input.assignedToId ?? null,
          },
          include: {
            branch: { select: { name: true } },
            assignedTo: { select: { displayName: true } },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'inventory.warehouse_create',
          resourceType: 'warehouse',
          resourceId: warehouse.id,
          requestId: actor.requestId,
          metadata: { name: warehouse.name, type: warehouse.type },
        });
        return toWarehouseView(warehouse);
      } catch (error) {
        if (isUniqueViolation(error, 'warehouses_tenantId_name_key')) {
          throw new ConflictException({
            message: `Depo adı zaten kayıtlı: ${input.name}`,
            code: 'WAREHOUSE_DUPLICATE',
          });
        }
        throw error;
      }
    });
  }

  async listWarehouses(tenantId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const rows = await tx.warehouse.findMany({
        where: { tenantId },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        include: {
          branch: { select: { name: true } },
          assignedTo: { select: { displayName: true } },
        },
      });
      return { data: rows.map(toWarehouseView) };
    });
  }

  async createBin(
    tenantId: string,
    warehouseId: string,
    input: CreateBinRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<BinView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, tenantId },
        select: { id: true },
      });
      if (!warehouse) throw notFound('Depo bulunamadı');
      try {
        const bin = await tx.stockBin.create({
          data: { tenantId, warehouseId, code: input.code, note: input.note ?? null },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'inventory.bin_create',
          resourceType: 'warehouse',
          resourceId: warehouseId,
          requestId: actor.requestId,
          metadata: { binCode: bin.code },
        });
        return toBinView(bin);
      } catch (error) {
        if (isUniqueViolation(error, 'stock_bins_warehouseId_code_key')) {
          throw new ConflictException({
            message: `Raf kodu bu depoda zaten kayıtlı: ${input.code}`,
            code: 'BIN_DUPLICATE',
          });
        }
        throw error;
      }
    });
  }

  async listBins(tenantId: string, warehouseId: string): Promise<{ data: BinView[] }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockBin.findMany({
        where: { tenantId, warehouseId },
        orderBy: { code: 'asc' },
      });
      return { data: rows.map(toBinView) };
    });
  }

  // ========================= Hareketler =========================

  /**
   * Genel hareket ucu (RECEIVE/ISSUE/TRANSFER/RETURN/ADJUSTMENT).
   * CONSUME yalnız iş emri parça ucundan (work-order-parts.service).
   * movementKey çift gönderimi tekilleştirir (replayed=true oynatma).
   */
  async createMovement(
    tenantId: string,
    input: CreateMovementRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
  ): Promise<{ body: MovementView; replayed: boolean }> {
    // ROLES_PERMISSIONS "Limited": düzeltme (ADJUSTMENT) tam yönetim ister.
    if (input.type === 'ADJUSTMENT' && !actor.permissions.has('stock:manage')) {
      throw forbidden();
    }
    try {
      return await this.scoped.withTenant(tenantId, async (tx) => {
        // Hızlı oynatma yolu — aynı movementKey daha önce işlendi mi?
        const existing = await tx.stockMovement.findFirst({
          where: { tenantId, movementKey: input.movementKey },
          include: MOVEMENT_INCLUDE,
        });
        if (existing) return { body: toMovementView(existing), replayed: true };

        const row = await this.applyMovement(tx, tenantId, actor.userId, {
          type: input.type,
          itemId: input.itemId,
          ...(input.lotId ? { lotId: input.lotId } : {}),
          ...(input.fromWarehouseId ? { fromWarehouseId: input.fromWarehouseId } : {}),
          ...(input.toWarehouseId ? { toWarehouseId: input.toWarehouseId } : {}),
          quantity: input.quantity,
          movementKey: input.movementKey,
          ...(input.note ? { note: input.note } : {}),
          ...(input.occurredAt ? { occurredAt: new Date(input.occurredAt) } : {}),
          ...(input.type === 'ADJUSTMENT'
            ? { adjustmentDirection: (input.toWarehouseId ? 'IN' : 'OUT') as 'IN' | 'OUT' }
            : {}),
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'inventory.movement_create',
          resourceType: 'stock_movement',
          resourceId: row.id,
          requestId: actor.requestId,
          metadata: {
            type: input.type,
            itemId: input.itemId,
            quantity: input.quantity,
            movementKey: input.movementKey,
          },
        });
        return { body: toMovementView(row), replayed: false };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'stock_movements_tenantId_movementKey_key')) {
        // Eşzamanlı yarış: kazananın satırını oynat (çift hareket YOK).
        const replay = await this.scoped.withTenant(tenantId, async (tx) =>
          tx.stockMovement.findFirst({
            where: { tenantId, movementKey: input.movementKey },
            include: MOVEMENT_INCLUDE,
          }),
        );
        if (replay) return { body: toMovementView(replay), replayed: true };
      }
      throw error;
    }
  }

  async listMovements(
    tenantId: string,
    query: MovementListQuery,
  ): Promise<{ data: MovementView[]; total: number; page: number; pageSize: number }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const where: Prisma.StockMovementWhereInput = {
        tenantId,
        ...(query.itemId ? { stockItemId: query.itemId } : {}),
        ...(query.type ? { movementType: query.type } : {}),
        ...(query.referenceId ? { referenceId: query.referenceId } : {}),
        ...(query.warehouseId
          ? {
              OR: [
                { fromWarehouseId: query.warehouseId },
                { toWarehouseId: query.warehouseId },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.stockMovement.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: MOVEMENT_INCLUDE,
        }),
        tx.stockMovement.count({ where }),
      ]);
      return { data: rows.map(toMovementView), total, page: query.page, pageSize: query.pageSize };
    });
  }

  /** Tek hareket — izlenebilirlik detayı (lot/seri geçmişi). */
  async getMovement(tenantId: string, movementId: string): Promise<MovementView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const row = await tx.stockMovement.findFirst({
        where: { id: movementId, tenantId },
        include: MOVEMENT_INCLUDE,
      });
      if (!row) throw notFound('Stok hareketi bulunamadı');
      return toMovementView(row);
    });
  }

  // ========================= Bakiye =========================

  async listBalances(
    tenantId: string,
    query: BalanceListQuery,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<{ data: BalanceView[] }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      // mine=true: yalnız kendi araç stoğu (mobil van ekranı).
      let warehouseFilter: Prisma.StockBalanceWhereInput['warehouse'] | undefined;
      if (query.mine === 'true') {
        warehouseFilter = {
          type: 'VEHICLE',
          assignedToId: viewer.userId,
        };
      } else if (query.warehouseType) {
        warehouseFilter = { type: query.warehouseType };
      }
      const where: Prisma.StockBalanceWhereInput = {
        tenantId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.itemId ? { stockItemId: query.itemId } : {}),
        ...(warehouseFilter ? { warehouse: warehouseFilter } : {}),
      };
      // Düşük stok süzgeci iki kolon karşılaştırması ister (SQL'e taşınamaz
      // Prisma ile) — güvenli üst sınır ile çekip bellekte süzüyoruz.
      const rows = await tx.stockBalance.findMany({
        where,
        orderBy: [{ warehouseId: 'asc' }, { stockItemId: 'asc' }, { lotId: 'asc' }],
        take: 2000,
        include: BALANCE_INCLUDE,
      });
      let views = rows.map(toBalanceView);
      if (query.lowStock === 'true') views = views.filter((view) => view.lowStock);
      return { data: views };
    });
  }

  // ========================= Rezervasyon =========================

  async createReservation(
    tenantId: string,
    input: CreateReservationRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<ReservationView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: input.workOrderId, tenantId },
        select: { id: true, status: true, workOrderNo: true },
      });
      if (!workOrder) throw notFound('İş emri bulunamadı');
      if (workOrder.status === 'CLOSED' || workOrder.status === 'CANCELLED') {
        throw new ConflictException({
          message: 'Kapatılmış iş emrine stok rezerve edilemez',
          code: 'WORK_ORDER_IMMUTABLE',
        });
      }

      const item = await requireItem(tx, tenantId, input.itemId, true);
      const lot = await requireLotIfTracked(tx, tenantId, item, input.lotId);

      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, tenantId, active: true },
        select: { id: true, name: true },
      });
      if (!warehouse) throw notFound('Depo bulunamadı');

      // Rezervasyon kilidi: serbest bakiyeden düşülür (onHand dokunulmaz).
      const locked = await lockBalance(tx, tenantId, input.warehouseId, item.id, lot?.id ?? null);
      const onHand = locked?.onHand ?? 0;
      const reserved = locked?.reservedQty ?? 0;
      if (insufficientOutgoing(onHand, reserved, input.quantity)) {
        throw negativeStock(onHand - reserved, input.quantity);
      }
      if (locked) {
        await tx.stockBalance.update({
          where: { id: locked.id },
          data: { reservedQty: reserved + input.quantity },
        });
      } else {
        throw negativeStock(0, input.quantity);
      }

      const reservation = await tx.stockReservation.create({
        data: {
          tenantId,
          workOrderId: workOrder.id,
          stockItemId: item.id,
          warehouseId: warehouse.id,
          lotId: lot?.id ?? null,
          reservedQty: input.quantity,
          consumedQty: 0,
          status: 'ACTIVE',
          note: input.note ?? null,
          createdById: actor.userId,
        },
        include: {
          stockItem: { select: { sku: true, name: true, unit: true } },
          workOrder: { select: { workOrderNo: true } },
          warehouse: { select: { name: true } },
          lot: { select: { lotNo: true } },
          createdBy: { select: { displayName: true } },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'inventory.reservation_create',
        resourceType: 'stock_reservation',
        resourceId: reservation.id,
        requestId: actor.requestId,
        metadata: {
          workOrderId: workOrder.id,
          itemId: item.id,
          quantity: input.quantity,
          warehouseId: warehouse.id,
        },
      });
      return toReservationView(reservation);
    });
  }

  /** Serbest bırakma — kilidi geri verir; tüketilmiş kısmı geri alamaz. */
  async releaseReservation(
    tenantId: string,
    reservationId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<ReservationView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const reservation = await tx.stockReservation.findFirst({
        where: { id: reservationId, tenantId },
      });
      if (!reservation) throw notFound('Rezervasyon bulunamadı');
      if (reservation.status === 'RELEASED') {
        // Çift gönderim: zaten serbest — kanonik görünüm.
        const row = await tx.stockReservation.findFirst({
          where: { id: reservation.id },
          include: {
            stockItem: { select: { sku: true, name: true, unit: true } },
            workOrder: { select: { workOrderNo: true } },
            warehouse: { select: { name: true } },
            lot: { select: { lotNo: true } },
            createdBy: { select: { displayName: true } },
          },
        });
        return toReservationView(row!);
      }
      if (reservation.status === 'CONSUMED') {
        throw new ConflictException({
          message: 'Tam tüketilen rezervasyon serbest bırakılamaz',
          code: 'RESERVATION_CONSUMED',
        });
      }

      const remaining = qtyToView(Number(reservation.reservedQty) - Number(reservation.consumedQty));
      const locked = await lockBalance(
        tx,
        tenantId,
        reservation.warehouseId,
        reservation.stockItemId,
        reservation.lotId,
      );
      if (locked) {
        await tx.stockBalance.update({
          where: { id: locked.id },
          data: { reservedQty: Math.max(0, locked.reservedQty - remaining) },
        });
      }
      const updated = await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
        include: {
          stockItem: { select: { sku: true, name: true, unit: true } },
          workOrder: { select: { workOrderNo: true } },
          warehouse: { select: { name: true } },
          lot: { select: { lotNo: true } },
          createdBy: { select: { displayName: true } },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'inventory.reservation_release',
        resourceType: 'stock_reservation',
        resourceId: reservation.id,
        requestId: actor.requestId,
        metadata: { releasedQty: remaining },
      });
      return toReservationView(updated);
    });
  }

  async listReservations(
    tenantId: string,
    workOrderId: string | undefined,
  ): Promise<{ data: ReservationView[] }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockReservation.findMany({
        where: { tenantId, ...(workOrderId ? { workOrderId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          stockItem: { select: { sku: true, name: true, unit: true } },
          workOrder: { select: { workOrderNo: true } },
          warehouse: { select: { name: true } },
          lot: { select: { lotNo: true } },
          createdBy: { select: { displayName: true } },
        },
      });
      return { data: rows.map(toReservationView) };
    });
  }

  // ========================= Sayım (cycle count) =========================

  async createCount(
    tenantId: string,
    input: CreateStockCountRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<StockCountView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: input.warehouseId, tenantId, active: true },
        select: { id: true },
      });
      if (!warehouse) throw notFound('Depo bulunamadı');
      const open = await tx.stockCount.findFirst({
        where: { tenantId, warehouseId: input.warehouseId, status: 'OPEN' },
        select: { id: true },
      });
      if (open) {
        throw new ConflictException({
          message: 'Bu depoda açık sayım var — önce kapatın',
          code: 'COUNT_ALREADY_OPEN',
          countId: open.id,
        });
      }
      const count = await tx.stockCount.create({
        data: {
          tenantId,
          warehouseId: input.warehouseId,
          note: input.note ?? null,
          createdById: actor.userId,
        },
        include: {
          warehouse: { select: { name: true } },
          createdBy: { select: { displayName: true } },
          lines: { select: { countedQty: true, deltaQty: true } },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'inventory.count_create',
        resourceType: 'stock_count',
        resourceId: count.id,
        requestId: actor.requestId,
        metadata: { warehouseId: input.warehouseId },
      });
      return toStockCountView(count);
    });
  }

  /**
   * Sayım satırı — beklenen miktar SUNUCUDA anlık bakiyeden dondurulur.
   * Aynı (kalem, lot) ikinci gönderim son gözlemi günceller (append yok;
   * kapanışta tek düzeltme üretilir).
   */
  async submitCountLine(
    tenantId: string,
    countId: string,
    input: SubmitCountLineRequest,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: countId, tenantId },
        select: { id: true, status: true, warehouseId: true },
      });
      if (!count) throw notFound('Sayım bulunamadı');
      if (count.status === 'CLOSED') {
        throw new ConflictException({
          message: 'Kapatılmış sayıma satır eklenemez',
          code: 'COUNT_ALREADY_CLOSED',
        });
      }
      const item = await requireItem(tx, tenantId, input.itemId, true);
      const lot = await requireLotIfTracked(tx, tenantId, item, input.lotId);

      // Beklenen: satır anındaki bakiye (yoksa 0) — sunucuda dondurulur.
      const locked = await lockBalance(tx, tenantId, count.warehouseId, item.id, lot?.id ?? null);
      const expected = qtyToView(locked?.onHand ?? 0);

      const existing = await tx.stockCountLine.findFirst({
        where: {
          tenantId,
          countId,
          stockItemId: item.id,
          lotId: lot?.id ?? null,
        },
      });
      if (existing) {
        const updated = await tx.stockCountLine.update({
          where: { id: existing.id },
          data: {
            expectedQty: expected,
            countedQty: input.countedQty,
            note: input.note ?? existing.note,
            countedById: actor.userId,
            countedAt: new Date(),
          },
          include: {
            stockItem: { select: { sku: true, name: true, unit: true } },
            lot: { select: { lotNo: true } },
            countedBy: { select: { displayName: true } },
          },
        });
        return toCountLineView(updated);
      }
      const line = await tx.stockCountLine.create({
        data: {
          tenantId,
          countId,
          stockItemId: item.id,
          lotId: lot?.id ?? null,
          expectedQty: expected,
          countedQty: input.countedQty,
          countedById: actor.userId,
          countedAt: new Date(),
          note: input.note ?? null,
        },
        include: {
          stockItem: { select: { sku: true, name: true, unit: true } },
          lot: { select: { lotNo: true } },
          countedBy: { select: { displayName: true } },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'inventory.count_line_submit',
        resourceType: 'stock_count',
        resourceId: countId,
        requestId: actor.requestId,
        metadata: { itemId: item.id, countedQty: input.countedQty, expected },
      });
      return toCountLineView(line);
    });
  }

  /**
   * Sayım kapanışı — farklar için ADJUSTMENT hareketleri TEK
   * transaction'da üretilir (atomik; kısmi kapanış yok). Negatif düzeltme
   * serbest bakiye kapısını GEÇER: sayım onaylı tek negatif yoldur.
   */
  async closeCount(
    tenantId: string,
    countId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<StockCountView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: countId, tenantId },
        select: { id: true, status: true, warehouseId: true },
      });
      if (!count) throw notFound('Sayım bulunamadı');
      if (count.status === 'CLOSED') {
        throw new ConflictException({
          message: 'Sayım zaten kapalı',
          code: 'COUNT_ALREADY_CLOSED',
        });
      }
      const lines = await tx.stockCountLine.findMany({
        where: { tenantId, countId },
        orderBy: { createdAt: 'asc' },
        include: { stockItem: { select: { sku: true } } },
      });

      let adjustments = 0;
      for (const line of lines) {
        if (line.countedQty === null) continue; // sayılmayan satır düzeltmez
        const expected = Number(line.expectedQty);
        const counted = Number(line.countedQty);
        const delta = countDelta(expected, counted);
        const direction = countDirection(delta);
        if (direction === 'NONE') {
          await tx.stockCountLine.update({
            where: { id: line.id },
            data: { deltaQty: 0 },
          });
          continue;
        }
        await this.applyMovement(tx, tenantId, actor.userId, {
          type: 'ADJUSTMENT',
          itemId: line.stockItemId,
          ...(line.lotId ? { lotId: line.lotId } : {}),
          ...(direction === 'IN'
            ? { toWarehouseId: count.warehouseId }
            : { fromWarehouseId: count.warehouseId }),
          quantity: Math.abs(delta),
          referenceType: 'stock_count',
          referenceId: count.id,
          adjustmentDirection: direction,
          note: `Sayım ${countId} düzeltmesi (beklenen ${expected}, sayılan ${counted})`,
        });
        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { deltaQty: delta },
        });
        adjustments += 1;
      }

      const closed = await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'CLOSED', closedById: actor.userId, closedAt: new Date() },
        include: {
          warehouse: { select: { name: true } },
          createdBy: { select: { displayName: true } },
          lines: { select: { countedQty: true, deltaQty: true } },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'inventory.count_close',
        resourceType: 'stock_count',
        resourceId: count.id,
        requestId: actor.requestId,
        metadata: { adjustments, warehouseId: count.warehouseId },
      });
      return toStockCountView(closed);
    });
  }

  async listCounts(tenantId: string): Promise<{ data: StockCountView[] }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockCount.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          warehouse: { select: { name: true } },
          createdBy: { select: { displayName: true } },
          lines: { select: { countedQty: true, deltaQty: true } },
        },
      });
      return { data: rows.map(toStockCountView) };
    });
  }

  async listCountLines(tenantId: string, countId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: countId, tenantId },
        select: { id: true },
      });
      if (!count) throw notFound('Sayım bulunamadı');
      const rows = await tx.stockCountLine.findMany({
        where: { tenantId, countId },
        orderBy: [{ createdAt: 'asc' }],
        include: {
          stockItem: { select: { sku: true, name: true, unit: true } },
          lot: { select: { lotNo: true } },
          countedBy: { select: { displayName: true } },
        },
      });
      return { data: rows.map(toCountLineView) };
    });
  }

  // ========================= Hareket çekirdeği (atomik) =========================

  /**
   * İş emri parça tüketimi iç geçidi — CONSUME ZORLANIR (genel hareket
   * ucu CONSUME kabul etmez; yalnız work-order-parts.service buradan
   * geçer, böylece her tüketim iş emri referanslı ve olay kayıtlıdır).
   */
  applyMovementForParts(
    tx: ScopedClient,
    tenantId: string,
    actorId: string,
    params: Omit<MovementParams, 'type'>,
  ) {
    return this.applyMovement(tx, tenantId, actorId, { ...params, type: 'CONSUME' });
  }


  /**
   * Hareket + bakiye güncellemesi TEK transaction'da (çağrı zaten
   * kiracı transaction'ının içindedir). Yarışta movementKey tekil
   * kısıtı devreye girer — çift hareket yüzeyi kapalıdır.
   */
  private async applyMovement(
    tx: ScopedClient,
    tenantId: string,
    actorId: string,
    params: MovementParams,
  ) {
    // 1) Şekil doğrulaması (savunma derinliği).
    const shapeError = validateMovementShape(
      params.type,
      params.fromWarehouseId,
      params.toWarehouseId,
    );
    if (shapeError) {
      throw new BadRequestException({ message: shapeError, code: 'INVALID_MOVEMENT_SHAPE' });
    }

    // 2) Kalem + lot kuralları.
    const item = await requireItem(
      tx,
      tenantId,
      params.itemId,
      params.type !== 'ADJUSTMENT',
    );
    const lot = await requireLotIfTracked(tx, tenantId, item, params.lotId);
    if (params.type === 'CONSUME' && item.trackingMode === 'SERIAL' && !Number.isInteger(params.quantity)) {
      throw new ConflictException({
        message: 'Seri izlenen kalemde miktar tam sayı olmalı (1 lot = 1 adet)',
        code: 'SERIAL_QUANTITY_INVALID',
      });
    }
    if (
      lot &&
      params.type !== 'ADJUSTMENT' &&
      isLotExpired(lot.expiresAt ? new Date(lot.expiresAt) : null)
    ) {
      throw new ConflictException({
        message: `Lot süresi dolmuş: ${lot.lotNo}`,
        code: 'LOT_EXPIRED',
        lotId: lot.id,
      });
    }

    // 3) Depolar kiracı kapsamında var mı?
    const warehouses: string[] = [];
    if (params.fromWarehouseId) warehouses.push(params.fromWarehouseId);
    if (params.toWarehouseId) warehouses.push(params.toWarehouseId);
    for (const warehouseId of warehouses) {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: warehouseId, tenantId, active: true },
        select: { id: true },
      });
      if (!warehouse) throw notFound('Depo bulunamadı');
    }

    // 4) Delta matematiği (motor — TEK gerçeklik).
    const deltas =
      params.type === 'ADJUSTMENT'
        ? movementDeltasForAdjustment(params.adjustmentDirection ?? 'IN', params.quantity)
        : movementDeltas(params.type, params.quantity);

    // 5) OUT tarafı — satır kilidi + negatif stok kapısı.
    // Onaylı tek negatif yol sayım kapanışı ADJUSTMENT'tır (kapı atlanır).
    const approvedAdjustment = params.type === 'ADJUSTMENT';
    let reservedDeltaOut = 0;
    if (deltas.fromDelta < 0 && params.fromWarehouseId) {
      const locked = await lockBalance(
        tx,
        tenantId,
        params.fromWarehouseId,
        item.id,
        lot?.id ?? null,
      );
      const onHand = locked?.onHand ?? 0;
      const reserved = locked?.reservedQty ?? 0;
      if (locked) {
        if (params.reservationId) {
          // Rezervasyon içi tüketim: kilidin üstünden düşülür (available dokunulmaz).
          if (reserved < params.quantity) {
            throw new ConflictException({
              message: 'Rezervasyon miktarı tüketim için yetersiz',
              code: 'RESERVATION_EXCEEDED',
            });
          }
          reservedDeltaOut = -params.quantity;
        } else if (!approvedAdjustment && insufficientOutgoing(onHand, reserved, params.quantity)) {
          throw negativeStock(onHand - reserved, params.quantity);
        }
        await tx.stockBalance.update({
          where: { id: locked.id },
          data: {
            onHand: qtyToView(onHand + deltas.fromDelta),
            reservedQty: Math.max(0, qtyToView(reserved + reservedDeltaOut)),
          },
        });
      } else if (params.reservationId) {
        throw new ConflictException({
          message: 'Rezervasyon miktarı tüketim için yetersiz',
          code: 'RESERVATION_EXCEEDED',
        });
      } else if (!approvedAdjustment) {
        throw negativeStock(0, params.quantity);
      } else {
        // Onaylı sayım düzeltmesi: bakiye satırı yok → negatif değerle yarat.
        await tx.stockBalance.create({
          data: {
            tenantId,
            warehouseId: params.fromWarehouseId,
            stockItemId: item.id,
            lotId: lot?.id ?? null,
            onHand: qtyToView(deltas.fromDelta),
            reservedQty: 0,
          },
        });
      }
    }

    // Rezervasyon satırı ilerletilir (varsa).
    if (params.reservationId) {
      const reservation = await tx.stockReservation.findFirst({
        where: { id: params.reservationId, tenantId },
      });
      if (!reservation || reservation.status === 'RELEASED') {
        throw new ConflictException({
          message: 'Rezervasyon tüketim için geçerli değil',
          code: 'RESERVATION_INVALID',
        });
      }
      const consumed = Number(reservation.consumedQty) + params.quantity;
      const status =
        consumed >= Number(reservation.reservedQty) ? 'CONSUMED' : 'PARTIALLY_CONSUMED';
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { consumedQty: qtyToView(consumed), status },
      });
    }

    // 6) IN tarafı — bakiye yarat/güncelle (kilitle; yarışta benzersiz indeks).
    if (deltas.toDelta > 0 && params.toWarehouseId) {
      await changeBalance(
        tx,
        tenantId,
        params.toWarehouseId,
        item.id,
        lot?.id ?? null,
        deltas.toDelta,
      );
    }

    // 7) Defter satırı — APPEND-ONLY. movementKey tekil: yarış kaybedeni
    // tüm transaction ile geri alınır (bakiye yarım yazma yok).
    const movement = await tx.stockMovement.create({
      data: {
        tenantId,
        stockItemId: item.id,
        lotId: lot?.id ?? null,
        fromWarehouseId: params.fromWarehouseId ?? null,
        toWarehouseId: params.toWarehouseId ?? null,
        movementType: params.type,
        quantity: params.quantity,
        quantityDelta: deltas.globalDelta,
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        movementKey: params.movementKey ?? null,
        unitCostMinor: params.type === 'CONSUME' ? (lot?.costMinor ?? null) : null,
        note: params.note ?? null,
        actorId,
        ...(params.occurredAt ? { occurredAt: params.occurredAt } : {}),
      },
      include: MOVEMENT_INCLUDE,
    });
    return movement;
  }
}

// ========================= Yardımcılar =========================

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const err = error as { code?: string; meta?: { target?: string[]; constraint?: string } };
  if (err?.code !== 'P2002') return false;
  if (!constraint) return true;
  const target = err.meta?.target ?? [];
  return target.includes(constraint) || err.meta?.constraint === constraint;
}

function negativeStock(available: number, requested: number): ConflictException {
  return new ConflictException({
    message: 'Stok yetersiz — negatif bakiye onaysız oluşturulamaz',
    code: 'NEGATIVE_STOCK_FORBIDDEN',
    details: {
      available: qtyToView(available),
      requested: qtyToView(requested),
    },
  });
}

async function requireItem(
  tx: ScopedClient,
  tenantId: string,
  itemId: string,
  requireActive: boolean,
) {
  const item = await tx.stockItem.findFirst({ where: { id: itemId, tenantId } });
  if (!item) throw notFound('Stok kalem bulunamadı');
  if (requireActive && !item.active) {
    throw new ConflictException({
      message: 'Pasif stok kalemi hareket yazamaz',
      code: 'ITEM_INACTIVE',
    });
  }
  return item;
}

/** İzleme moduna göre lot doğrulaması: LOT/SERIAL zorunlu, NONE yasak. */
async function requireLotIfTracked(
  tx: ScopedClient,
  tenantId: string,
  item: { id: string; trackingMode: 'NONE' | 'LOT' | 'SERIAL' },
  lotId: string | undefined,
) {
  if (item.trackingMode === 'NONE') {
    if (lotId) {
      throw new ConflictException({
        message: 'İzlemsiz kalemde lot seçilemez',
        code: 'LOT_FORBIDDEN',
      });
    }
    return null;
  }
  if (!lotId) {
    throw new ConflictException({
      message:
        item.trackingMode === 'SERIAL'
          ? 'Seri izlenen kalemde seri (lot) zorunludur'
          : 'Parti izlenen kalemde parti (lot) zorunludur',
      code: 'LOT_REQUIRED',
    });
  }
  const lot = await tx.stockLot.findFirst({
    where: { id: lotId, tenantId, stockItemId: item.id },
  });
  if (!lot) throw notFound('Lot/seri bulunamadı');
  return lot;
}

/** Bakiye satırını kilitler (FOR UPDATE) — eşzamanlı OUT yarışını sıraya alır. */
async function lockBalance(
  tx: ScopedClient,
  tenantId: string,
  warehouseId: string,
  stockItemId: string,
  lotId: string | null,
): Promise<{ id: string; onHand: number; reservedQty: number } | null> {
  const rows = await tx.$queryRaw<
    Array<{ id: string; onHand: number; reservedQty: number }>
  >(
    Prisma.sql`SELECT "id", "onHand"::float8 AS "onHand", "reservedQty"::float8 AS "reservedQty"
      FROM "stock_balances"
      WHERE "tenantId" = ${tenantId} AND "warehouseId" = ${warehouseId}
        AND "stockItemId" = ${stockItemId} AND "lotId" IS NOT DISTINCT FROM ${lotId}
      FOR UPDATE`,
  );
  return rows[0] ?? null;
}

/** IN tarafı: bakiyeyi yarat/güncelle; yarışta kilitleyip üstüne ekle. */
async function changeBalance(
  tx: ScopedClient,
  tenantId: string,
  warehouseId: string,
  stockItemId: string,
  lotId: string | null,
  delta: number,
): Promise<void> {
  const locked = await lockBalance(tx, tenantId, warehouseId, stockItemId, lotId);
  if (locked) {
    await tx.stockBalance.update({
      where: { id: locked.id },
      data: { onHand: qtyToView(locked.onHand + delta) },
    });
    return;
  }
  try {
    await tx.stockBalance.create({
      data: {
        tenantId,
        warehouseId,
        stockItemId,
        lotId,
        onHand: qtyToView(delta),
        reservedQty: 0,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // NULLS NOT DISTINCT tekil indeksi yarışı kazandı → kilitle ve ekle.
      const again = await lockBalance(tx, tenantId, warehouseId, stockItemId, lotId);
      if (!again) throw error;
      await tx.stockBalance.update({
        where: { id: again.id },
        data: { onHand: qtyToView(again.onHand + delta) },
      });
      return;
    }
    throw error;
  }
}

async function sumOnHand(tx: ScopedClient, tenantId: string, itemId: string): Promise<number> {
  const sums = await tx.stockBalance.groupBy({
    by: ['stockItemId'],
    where: { tenantId, stockItemId: itemId },
    _sum: { onHand: true },
  });
  return qtyToView(Number(sums[0]?._sum.onHand ?? 0));
}
