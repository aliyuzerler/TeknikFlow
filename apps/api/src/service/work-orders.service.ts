import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, WorkOrderStatus } from '@prisma/client';
import type {
  AssignableUserView,
  CreateWorkOrderRequest,
  ServicePriority,
  TransitionWorkOrderRequest,
  UpdateWorkOrderRequest,
  WorkOrderAssignmentView,
  WorkOrderEventView,
  WorkOrderListQuery,
  WorkOrderNoteCreate,
  WorkOrderNoteView,
  WorkOrderView,
} from '@teknikflow/contracts';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { branchScopeAllows } from '../auth/auth-context.js';
import { normalizeName } from '../crm/crm-utils.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import type { TransitionAuthority } from './work-order-state.js';
import { requireTransitionRule, transitionEffects } from './work-order-state.js';
import { ScheduleConflictService } from './schedule-conflict.service.js';
import { computeSlaDueAt, defaultResolveMinutes } from './sla.js';
import {
  hasCustomerSignatures,
  missingRequiredChecklist,
  visitDataFromLocation,
} from '../execution/execution-rules.js';
import { EVIDENCE_MISSING_CODE } from '@teknikflow/contracts';
import { slaState } from './dispatch-engine.js';

/**
 * Faz 05 — iş emri servisi: yaşam döngüsü, atama, notlar, zaman çizelgesi.
 *
 * Tüm erişim kiracı kapsamlı transaction içinde (RLS). Çapraz-kiracı kimlik
 * → 404 (varlık sızıntısı yok). İyimser eşzamanlılık: expectedVersion
 * uyuşmazsa 409 VERSION_CONFLICT. Numara üretimi sayaç tablosunda atomik
 * UPSERT ile — (tenantId, workOrderNo) tekil indeks geri savunma.
 */

/** Detay/include: liste + detay görünümünün ilişkileri. */
const WO_INCLUDE = {
  customer: { select: { id: true, name: true } },
  asset: { select: { id: true, assetTag: true } },
  serviceLocation: { select: { id: true, name: true, address: true } },
  branch: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, displayName: true } },
  request: { select: { id: true, subject: true, status: true } },
} as const;

const DETAIL_INCLUDE = {
  ...WO_INCLUDE,
  events: {
    orderBy: { occurredAt: 'desc' },
    include: { actor: { select: { id: true, displayName: true } } },
  },
  notes: {
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, displayName: true } } },
  },
  assignments: {
    orderBy: { assignedAt: 'desc' },
    include: {
      user: { select: { id: true, displayName: true } },
      assignedBy: { select: { id: true, displayName: true } },
    },
  },
} as const;

type WorkOrderDetail = Prisma.WorkOrderGetPayload<{ include: typeof DETAIL_INCLUDE }>;
type WorkOrderRow = Prisma.WorkOrderGetPayload<{ include: typeof WO_INCLUDE }>;

/** Geçiş yetkisi sınıfı → izin denetimi (work-order-state.ts belgelerine bakın). */
function hasTransitionAuthority(
  authority: TransitionAuthority,
  permissions: Set<string>,
  isAssignee: boolean,
): boolean {
  const create = permissions.has('work_orders:create');
  const dispatch = permissions.has('work_orders:dispatch');
  const complete = permissions.has('work_orders:complete');
  const viewAll = permissions.has('work_orders:view_all');
  switch (authority) {
    case 'PLANNING':
      return create || dispatch;
    case 'DISPATCH':
      return dispatch;
    case 'EXECUTION':
      return complete && (viewAll || isAssignee);
    case 'CLOSE':
      return complete && viewAll;
    case 'CANCEL':
      return create || dispatch;
  }
}

@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly scheduleConflicts: ScheduleConflictService,
  ) {}

  // ------------------------- Liste / görünürlük -------------------------

  /** Liste: view_all → tüm işler; değilse (teknisyen) yalnız kendi atamaları. */
  async listWorkOrders(
    tenantId: string,
    viewer: { userId: string; permissions: Set<string> },
    query: WorkOrderListQuery,
  ) {
    const viewAll = viewer.permissions.has('work_orders:view_all');
    const where: Prisma.WorkOrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
      ...(query.mine === 'true' ? { assignedToId: viewer.userId } : {}),
      ...(!viewAll ? { assignedToId: viewer.userId } : {}),
      ...(query.q
        ? {
            OR: [
              { subject: { contains: query.q, mode: 'insensitive' } },
              { workOrderNo: { contains: query.q, mode: 'insensitive' } },
              { customer: { nameNormalized: { contains: normalizeName(query.q) } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.WorkOrderOrderByWithRelationInput[] = [
      { status: 'asc' },
      { createdAt: 'desc' },
    ];
    return this.scoped.withTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.workOrder.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: WO_INCLUDE,
        }),
        tx.workOrder.count({ where }),
      ]);
      return { rows: rows as WorkOrderRow[], total };
    });
  }

  /** Detay: view_all YA DA atanmış (kaynak düzeyi — düğme gizlemek yetki değildir). */
  async getWorkOrderDetail(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = (await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        include: DETAIL_INCLUDE,
      })) as WorkOrderDetail | null;
      if (!workOrder) throw notFound();
      await this.assertVisible(tx, workOrder, viewer);
      return workOrder;
    });
  }

  private async assertVisible(
    tx: ScopedClient,
    workOrder: { id: string; assignedToId: string | null },
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<void> {
    if (viewer.permissions.has('work_orders:view_all')) return;
    if (workOrder.assignedToId === viewer.userId) return;
    const active = await tx.workOrderAssignment.findFirst({
      where: { workOrderId: workOrder.id, userId: viewer.userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!active) {
      // Atanmamış + view_all yok → varlık sızıntısı vermeden reddet.
      throw new ForbiddenException({ message: 'Bu iş emri için yetkiniz yok', code: 'FORBIDDEN' });
    }
  }

  /** Kullanıcının bu iş emrinde AKTİF ataması var mı? */
  private async isAssignee(
    tx: ScopedClient,
    workOrderId: string,
    userId: string,
    assignedToId: string | null,
  ): Promise<boolean> {
    if (assignedToId === userId) return true;
    const assignment = await tx.workOrderAssignment.findFirst({
      where: { workOrderId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    return assignment !== null;
  }

  // ------------------------- Oluşturma -------------------------

  async createWorkOrder(
    tenantId: string,
    input: CreateWorkOrderRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<WorkOrderRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      // FK bütünlüğü: tüm referanslar KENDİ kiracısında ve doğru müşteriye ait.
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, tenantId },
        select: { id: true, name: true },
      });
      if (!customer) throw notFound();
      if (input.assetId) {
        const asset = await tx.asset.findFirst({
          where: { id: input.assetId, tenantId },
          select: { customerId: true },
        });
        if (!asset) throw notFound('Ekipman bulunamadı');
        if (asset.customerId !== input.customerId) {
          throw new BadRequestException({
            message: 'Ekipman bu müşteriye ait değil',
            code: 'ASSET_CUSTOMER_MISMATCH',
          });
        }
      }
      if (input.serviceLocationId) {
        const location = await tx.serviceLocation.findFirst({
          where: { id: input.serviceLocationId, tenantId },
          select: { customerId: true },
        });
        if (!location) throw notFound('Servis lokasyonu bulunamadı');
        if (location.customerId !== input.customerId) {
          throw new BadRequestException({
            message: 'Lokasyon bu müşteriye ait değil',
            code: 'LOCATION_CUSTOMER_MISMATCH',
          });
        }
      }
      if (input.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: input.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw notFound('Şube bulunamadı');
      }

      // Talepten dönüşüm: talep açık olmalı ve birebir iş emri üretmeli.
      let request: {
        id: string;
        status: string;
        createdAt: Date;
        slaDueAt: Date | null;
      } | null = null;
      if (input.requestId) {
        request = await tx.serviceRequest.findFirst({
          where: { id: input.requestId, tenantId },
          select: { id: true, status: true, createdAt: true, slaDueAt: true },
        });
        if (!request) throw notFound('Servis talebi bulunamadı');
        if (request.status !== 'NEW' && request.status !== 'IN_REVIEW') {
          throw new ConflictException({
            message: 'Talep dönüşüme açık değil (dönüştürülmüş ya da iptal edilmiş)',
            code: 'REQUEST_NOT_CONVERTIBLE',
          });
        }
      }

      const now = new Date();
      // Faz 06 — SLA: talepten dönüşümde müşteri sözü DEVRALINIR;
      // doğrudan açılışta öncelik politikasından hesaplanır.
      const slaPolicy = await tx.slaPolicy.findUnique({
        where: { tenantId_priority: { tenantId, priority: input.priority } },
        select: { resolveMinutes: true },
      });
      const slaDueAt = request
        ? request.slaDueAt
        : computeSlaDueAt(now, slaPolicy?.resolveMinutes ?? defaultResolveMinutes(input.priority));

      const workOrderNo = await this.nextWorkOrderNo(tx, tenantId, now);
      const planned =
        input.scheduledStart && input.scheduledEnd ? ('PLANNED' as const) : ('DRAFT' as const);

      const created = (await tx.workOrder.create({
        data: {
          tenantId,
          workOrderNo,
          ...(input.requestId ? { requestId: input.requestId } : {}),
          customerId: input.customerId,
          ...(input.assetId ? { assetId: input.assetId } : {}),
          ...(input.serviceLocationId ? { serviceLocationId: input.serviceLocationId } : {}),
          ...(input.branchId ? { branchId: input.branchId } : {}),
          type: input.type,
          priority: input.priority,
          status: planned,
          subject: input.subject,
          ...(input.description ? { description: input.description } : {}),
          ...(input.scheduledStart ? { scheduledStart: new Date(input.scheduledStart) } : {}),
          ...(input.scheduledEnd ? { scheduledEnd: new Date(input.scheduledEnd) } : {}),
          slaDueAt,
          createdById: actor.userId,
          version: 0,
        },
        include: WO_INCLUDE,
      })) as WorkOrderRow;

      await tx.workOrderEvent.create({
        data: {
          tenantId,
          workOrderId: created.id,
          eventType: 'work_order.created',
          toState: created.status,
          actorId: actor.userId,
          metadataJson: { source: input.requestId ? 'request_conversion' : 'direct' },
        },
      });

      if (request) {
        await tx.serviceRequest.update({
          where: { id: request.id },
          data: { status: 'CONVERTED' },
        });
        await this.writeCrmEvent(tx, tenantId, {
          customerId: input.customerId,
          assetId: input.assetId ?? null,
          eventType: 'service_request.converted',
          actorId: actor.userId,
          requestId: actor.requestId,
          metadata: { requestId: request.id, workOrderNo },
        });
      }

      await this.writeCrmEvent(tx, tenantId, {
        customerId: input.customerId,
        assetId: input.assetId ?? null,
        eventType: 'work_order.created',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { workOrderId: created.id, workOrderNo, type: input.type },
      });

      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'work_order.create',
        resourceType: 'work_order',
        resourceId: created.id,
        requestId: actor.requestId,
        metadata: { workOrderNo, status: created.status, fromRequestId: input.requestId ?? null },
      });

      return created;
    });
  }

  /** Atomik numara: sayaç tablosunda UPSERT-artış (aynı kiracı+yıl). */
  private async nextWorkOrderNo(tx: ScopedClient, tenantId: string, now: Date): Promise<string> {
    const year = now.getUTCFullYear();
    const rows = await tx.$queryRaw<Array<{ lastNumber: number }>>`
      INSERT INTO "work_order_counters" ("tenantId", "year", "lastNumber")
      VALUES (${tenantId}, ${year}, 1)
      ON CONFLICT ("tenantId", "year")
      DO UPDATE SET "lastNumber" = "work_order_counters"."lastNumber" + 1
      RETURNING "lastNumber"`;
    const lastNumber = rows[0]?.lastNumber;
    if (typeof lastNumber !== 'number') {
      throw new ConflictException({
        message: 'İş emri numarası üretilemedi',
        code: 'WORK_ORDER_NUMBER_FAILED',
      });
    }
    return `WO-${year}-${String(lastNumber).padStart(4, '0')}`;
  }

  // ------------------------- Düzenleme (iyimser eşzamanlılık) -------------------------

  async updateWorkOrder(
    tenantId: string,
    workOrderId: string,
    input: UpdateWorkOrderRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
  ): Promise<WorkOrderRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const current = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: {
          id: true,
          version: true,
          status: true,
          assignedToId: true,
          scheduledStart: true,
          scheduledEnd: true,
        },
      });
      if (!current) throw notFound();
      if (current.version !== input.expectedVersion) {
        throw new ConflictException({
          message: 'İş emri başka bir kullanıcı tarafından güncellendi',
          code: 'VERSION_CONFLICT',
          currentVersion: current.version,
        });
      }
      if (current.status === 'CLOSED' || current.status === 'CANCELLED') {
        throw new ConflictException({
          message: 'Kapatılmış veya iptal edilmiş iş emri düzenlenemez',
          code: 'WORK_ORDER_IMMUTABLE',
        });
      }

      if (input.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: input.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw notFound('Şube bulunamadı');
      }

      const changed: string[] = [];
      const data: Prisma.WorkOrderUpdateInput = {};
      let newStart: Date | null | undefined;
      let newEnd: Date | null | undefined;
      if (input.subject !== undefined && input.subject !== null) {
        data.subject = input.subject;
        changed.push('subject');
      }
      if (input.description !== undefined) {
        data.description = input.description ?? null;
        changed.push('description');
      }
      if (input.type !== undefined) {
        data.type = input.type;
        changed.push('type');
      }
      if (input.priority !== undefined) {
        data.priority = input.priority;
        changed.push('priority');
      }
      if (input.branchId !== undefined) {
        data.branch = input.branchId ? { connect: { id: input.branchId } } : { disconnect: true };
        changed.push('branchId');
      }
      if (input.scheduledStart !== undefined) {
        newStart = input.scheduledStart ? new Date(input.scheduledStart) : null;
        data.scheduledStart = newStart;
        changed.push('scheduledStart');
      }
      if (input.scheduledEnd !== undefined) {
        newEnd = input.scheduledEnd ? new Date(input.scheduledEnd) : null;
        data.scheduledEnd = newEnd;
        changed.push('scheduledEnd');
      }
      if (changed.length === 0) {
        throw new BadRequestException({ message: 'Güncellenecek alan yok', code: 'NO_FIELDS' });
      }
      if (newStart && newEnd && newEnd.getTime() <= newStart.getTime()) {
        throw new BadRequestException({
          message: 'Bitiş zamanı başlangıçtan sonra olmalı',
          code: 'SCHEDULE_INVALID',
        });
      }

      // Faz 06 — atanmış iş emrinin pencere değişimi çakışma denetiminden
      // geçer (çift rezervasyon engelinin ikinci gerçeklik noktası).
      const scheduleChanged =
        input.scheduledStart !== undefined || input.scheduledEnd !== undefined;
      const effectiveStart = newStart ?? current.scheduledStart;
      const effectiveEnd = newEnd ?? current.scheduledEnd;
      if (
        scheduleChanged &&
        current.assignedToId &&
        effectiveStart &&
        effectiveEnd &&
        effectiveEnd > effectiveStart
      ) {
        const evaluation = await this.scheduleConflicts.assertNoConflicts(
          tx,
          tenantId,
          {
            assigneeUserId: current.assignedToId,
            window: { start: effectiveStart, end: effectiveEnd },
            excludeWorkOrderId: current.id,
          },
          { requested: input.overrideConflict === true, reason: input.overrideReason },
          actor.permissions,
        );
        if (evaluation.overridden) {
          data.scheduleOverrideReason = input.overrideReason!.trim();
          await tx.workOrderEvent.create({
            data: {
              tenantId,
              workOrderId: current.id,
              eventType: 'work_order.dispatch_override',
              actorId: actor.userId,
              metadataJson: {
                reason: input.overrideReason!.trim(),
                conflicts: evaluation.conflicts.map((conflict) => conflict.type),
                scheduledStart: effectiveStart.toISOString(),
                scheduledEnd: effectiveEnd.toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
        }
      }

      const updated = (await tx.workOrder.update({
        where: { id: current.id },
        data: { ...data, version: { increment: 1 } },
        include: WO_INCLUDE,
      })) as WorkOrderRow;

      await tx.workOrderEvent.create({
        data: {
          tenantId,
          workOrderId: current.id,
          eventType: 'work_order.updated',
          actorId: actor.userId,
          metadataJson: { fields: changed },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'work_order.update',
        resourceType: 'work_order',
        resourceId: current.id,
        requestId: actor.requestId,
        metadata: { fields: changed },
      });
      return updated;
    });
  }

  // ------------------------- Durum geçişi -------------------------

  async transitionWorkOrder(
    tenantId: string,
    workOrderId: string,
    input: TransitionWorkOrderRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
  ): Promise<WorkOrderRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const current = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        include: WO_INCLUDE,
      });
      if (!current) throw notFound();

      // İyimser eşzamanlılık (opsiyonel beklenen sürüm).
      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        throw new ConflictException({
          message: 'İş emri başka bir kullanıcı tarafından güncellendi',
          code: 'VERSION_CONFLICT',
          currentVersion: current.version,
        });
      }

      // Çift gönderim idempotentliği: ASSIGNED iş emrine AYNI teknisyenle
      // yeniden atama → değişiklik yok (geçiş kuralı hükümsüz, kayıt üretilmez).
      if (
        input.to === 'ASSIGNED' &&
        current.status === 'ASSIGNED' &&
        input.assigneeUserId &&
        current.assignedToId === input.assigneeUserId
      ) {
        const activeSame = await tx.workOrderAssignment.findFirst({
          where: { workOrderId: current.id, userId: input.assigneeUserId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (activeSame) return current as WorkOrderRow;
      }

      const rule = requireTransitionRule(current.status, input.to);
      const assignee = await this.isAssignee(tx, current.id, actor.userId, current.assignedToId);
      if (!hasTransitionAuthority(rule.authority, actor.permissions, assignee)) {
        throw new ForbiddenException({
          message: 'Bu geçiş için yetkiniz yok',
          code: 'FORBIDDEN',
        });
      }

      // Faz 08 — KANIT KAPILARI (ADR-0007/OFFLINE_SYNC.md):
      // COMPLETE: zorunlu checklist maddeleri yanıtlanmış olmalı.
      // CLOSE:    en az bir MÜŞTERİ imzası bulunmalı (müşteri onayı).
      if (rule.action === 'COMPLETE') {
        const items = await tx.checklistItem.findMany({
          where: { workOrderId: current.id },
          select: { id: true, label: true, required: true, responseValue: true },
        });
        const missing = missingRequiredChecklist(items);
        if (missing.length > 0) {
          throw new ConflictException({
            message: 'Tamamlama için zorunlu checklist maddeleri yanıtlanmamış',
            code: EVIDENCE_MISSING_CODE,
            missing,
          });
        }
      }
      if (rule.action === 'CLOSE') {
        const signatures = await tx.workOrderSignature.findMany({
          where: { workOrderId: current.id },
          select: { signedBy: true },
        });
        if (!hasCustomerSignatures(signatures)) {
          throw new ConflictException({
            message: 'Kapatma için en az bir müşteri imzası gerekli',
            code: EVIDENCE_MISSING_CODE,
          });
        }
      }

      // Eyleme özgü doğrulama ve yan veriler.
      const extra: Prisma.WorkOrderUpdateInput = {};
      const eventMetadata: Record<string, unknown> = { action: rule.action };

      if (rule.action === 'ASSIGN') {
        const target = await this.loadAssignableMember(tx, tenantId, input.assigneeUserId!);
        // Şube kapsamı: iş emrinin şubesi atananın kapsamında olmalı.
        if (
          current.branchId &&
          target.branchScope !== 'ALL' &&
          !branchScopeAllows(target.branchScope, current.branchId)
        ) {
          throw new BadRequestException({
            message: 'Teknisyenin şube kapsamı bu iş emrinin şubesini kapsamıyor',
            code: 'BRANCH_SCOPE_MISMATCH',
          });
        }

        // Faz 06 — çift rezervasyon engeli (ADR-0008): atamayla birlikte
        // yürürlüğe giren tam pencere için çakışma denetimi. Override yalnız
        // work_orders:dispatch_override izni + zorunlu nedenle geçerli.
        const effectiveStart = input.scheduledStart
          ? new Date(input.scheduledStart)
          : current.scheduledStart;
        const effectiveEnd = input.scheduledEnd
          ? new Date(input.scheduledEnd)
          : current.scheduledEnd;
        if (effectiveStart && effectiveEnd && effectiveEnd > effectiveStart) {
          const evaluation = await this.scheduleConflicts.assertNoConflicts(
            tx,
            tenantId,
            {
              assigneeUserId: target.userId,
              window: { start: effectiveStart, end: effectiveEnd },
              excludeWorkOrderId: current.id,
            },
            {
              requested: input.overrideConflict === true,
              reason: input.overrideReason,
            },
            actor.permissions,
          );
          if (evaluation.overridden) {
            extra.scheduleOverrideReason = input.overrideReason!.trim();
            eventMetadata.conflicts = evaluation.conflicts.map((conflict) => conflict.type);
          }
        }

        extra.assignedTo = { connect: { id: target.userId } };
        eventMetadata.assigneeUserId = target.userId;
      }

      if (rule.action === 'UNASSIGN') {
        extra.assignedTo = { disconnect: true };
      }

      if (rule.action === 'PLAN') {
        if (input.scheduledStart) {
          extra.scheduledStart = new Date(input.scheduledStart);
        }
        if (input.scheduledEnd) {
          extra.scheduledEnd = new Date(input.scheduledEnd);
        }
        if (input.branchId) {
          const branch = await tx.branch.findFirst({
            where: { id: input.branchId, tenantId },
            select: { id: true },
          });
          if (!branch) throw notFound('Şube bulunamadı');
          extra.branch = { connect: { id: input.branchId } };
        }
      }

      if (rule.action === 'CANCEL') {
        extra.cancellationReason = input.reasonCode!;
        extra.cancellationNote = input.note ?? null;
        eventMetadata.reasonCode = input.reasonCode!;
      }

      // Zaman damgaları + atama temizliği (durum makinesi etkileri).
      const effects = transitionEffects(input.to);
      const data: Prisma.WorkOrderUpdateInput = {
        ...extra,
        status: input.to,
        version: { increment: 1 },
        ...(effects.acceptedAt !== undefined ? { acceptedAt: effects.acceptedAt ?? null } : {}),
        ...(effects.startedAt !== undefined ? { startedAt: effects.startedAt ?? null } : {}),
        ...(effects.completedAt !== undefined ? { completedAt: effects.completedAt ?? null } : {}),
        ...(effects.closedAt !== undefined ? { closedAt: effects.closedAt ?? null } : {}),
        ...(effects.cancelledAt !== undefined ? { cancelledAt: effects.cancelledAt ?? null } : {}),
      };

      const updated = (await tx.workOrder.update({
        where: { id: current.id },
        data,
        include: WO_INCLUDE,
      })) as WorkOrderRow;

      // Faz 08 — GPS kilometre taşları: ARRIVE → CHECK_IN, COMPLETE →
      // CHECK_OUT (append-only visit). Konum yoksa MANUAL kaynakla kayıt
      // (izin reddi / cihaz fallback'i — açık eylem yine denetlenir).
      if (rule.action === 'ARRIVE' || rule.action === 'COMPLETE') {
        const visitType = rule.action === 'ARRIVE' ? 'CHECK_IN' : 'CHECK_OUT';
        const visit = visitDataFromLocation(input.location, visitType);
        const visitRow = await tx.workOrderVisit.create({
          data: {
            tenantId,
            workOrderId: current.id,
            visitType: visit.visitType,
            latitude: visit.latitude,
            longitude: visit.longitude,
            accuracyMeters: visit.accuracyMeters,
            source: visit.source,
            manualReason: visit.manualReason,
            capturedAt: visit.capturedAt,
            recordedById: actor.userId,
          },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: current.id,
            eventType: rule.action === 'ARRIVE' ? 'work_order.check_in' : 'work_order.check_out',
            fromState: current.status,
            toState: input.to,
            actorId: actor.userId,
            metadataJson: {
              visitId: visitRow.id,
              source: visit.source,
              hasCoordinates: visit.latitude !== null,
              accuracyMeters: visit.accuracyMeters,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // Zaman çizelgesi: durum değişimi + eyleme özgü olaylar.
      await tx.workOrderEvent.create({
        data: {
          tenantId,
          workOrderId: current.id,
          eventType: 'work_order.state_changed',
          fromState: current.status,
          toState: input.to,
          actorId: actor.userId,
          metadataJson: eventMetadata as Prisma.InputJsonValue,
        },
      });
      if (rule.action === 'ASSIGN') {
        await tx.workOrderAssignment.create({
          data: {
            tenantId,
            workOrderId: current.id,
            userId: input.assigneeUserId!,
            assignedById: actor.userId,
            status: 'ACTIVE',
          },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: current.id,
            eventType: 'work_order.assigned',
            actorId: actor.userId,
            metadataJson: { assigneeUserId: input.assigneeUserId },
          },
        });
        // Faz 06 — bilinçli çakışma üzerine atama denetim izi (neden + bulgular).
        if (extra.scheduleOverrideReason) {
          await tx.workOrderEvent.create({
            data: {
              tenantId,
              workOrderId: current.id,
              eventType: 'work_order.dispatch_override',
              actorId: actor.userId,
              metadataJson: {
                reason: extra.scheduleOverrideReason,
                conflicts: eventMetadata.conflicts ?? [],
                scheduledStart: (input.scheduledStart
                  ? new Date(input.scheduledStart)
                  : current.scheduledStart
                )?.toISOString(),
                scheduledEnd: (input.scheduledEnd
                  ? new Date(input.scheduledEnd)
                  : current.scheduledEnd
                )?.toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
      if (rule.action === 'UNASSIGN') {
        await tx.workOrderAssignment.updateMany({
          where: { workOrderId: current.id, status: 'ACTIVE' },
          data: { status: 'REMOVED', removedAt: new Date() },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: current.id,
            eventType: 'work_order.unassigned',
            actorId: actor.userId,
            metadataJson: {},
          },
        });
      }
      if (rule.action === 'CANCEL') {
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: current.id,
            eventType: 'work_order.cancelled',
            fromState: current.status,
            toState: 'CANCELLED',
            actorId: actor.userId,
            metadataJson: { reasonCode: input.reasonCode },
          },
        });
      }

      // CRM zaman çizelgesi: müşteri/varlık geçmişine önemli adımlar düşer.
      if (input.to === 'COMPLETED' || input.to === 'CLOSED' || input.to === 'CANCELLED') {
        await this.writeCrmEvent(tx, tenantId, {
          customerId: current.customerId,
          assetId: current.assetId ?? null,
          eventType: `work_order.${input.to.toLowerCase()}`,
          actorId: actor.userId,
          requestId: actor.requestId,
          metadata: { workOrderId: current.id, workOrderNo: current.workOrderNo },
        });
      }

      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'work_order.transition',
        resourceType: 'work_order',
        resourceId: current.id,
        requestId: actor.requestId,
        metadata: { from: current.status, to: input.to, action: rule.action },
      });

      return updated;
    });
  }

  /** Atanabilir üye: AKTİF üyelik + iş görme yetkisi olan rol (teknisyen vb.). */
  private async loadAssignableMember(tx: ScopedClient, tenantId: string, userId: string) {
    const membership = await tx.membership.findFirst({
      where: {
        tenantId,
        userId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      include: {
        user: { select: { id: true, displayName: true } },
        role: { include: { rolePermissions: { select: { permissionKey: true } } } },
      },
    });
    if (!membership) {
      throw new NotFoundException({
        message: 'Bu kiracıda aktif üyelik bulunamadı',
        code: 'ASSIGNEE_NOT_MEMBER',
      });
    }
    const permissionKeys = new Set(membership.role.rolePermissions.map((p) => p.permissionKey));
    // Atanabilir = YÜRÜTEBİLEN rol: complete izni (owner/admin/servis yöneticisi)
    // VEYA view_assigned (teknisyen). Görüntüleyen-ama-yürütmeyen roller
    // (finans, planlayıcı) atanamaz.
    if (
      !permissionKeys.has('work_orders:complete') &&
      !permissionKeys.has('work_orders:view_assigned')
    ) {
      throw new BadRequestException({
        message: 'Bu kullanıcı iş emri atanabilir rolde değil',
        code: 'ASSIGNEE_NOT_ASSIGNABLE',
      });
    }
    return {
      userId: membership.user.id,
      displayName: membership.user.displayName,
      branchScope: membership.branchScope as 'ALL' | string[],
    };
  }

  /** Atama çekmecesi için üye listesi (work_orders:dispatch). */
  async listAssignableUsers(tenantId: string): Promise<AssignableUserView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
        include: {
          user: { select: { id: true, displayName: true, emailNormalized: true } },
          role: { include: { rolePermissions: { select: { permissionKey: true } } } },
        },
        orderBy: { user: { displayName: 'asc' } },
      });
      return memberships
        .filter((m) => {
          const keys = new Set(m.role.rolePermissions.map((p) => p.permissionKey));
          // Yalnız yürütebilen roller atanabilir (complete | view_assigned).
          return keys.has('work_orders:complete') || keys.has('work_orders:view_assigned');
        })
        .map((m) => ({
          userId: m.user.id,
          membershipId: m.id,
          displayName: m.user.displayName,
          email: m.user.emailNormalized,
          roleKey: m.role.key,
          roleName: m.role.name,
          branchScope: (m.branchScope as 'ALL' | string[]) ?? 'ALL',
        }));
    });
  }

  // ------------------------- Notlar -------------------------

  async addNote(
    tenantId: string,
    workOrderId: string,
    input: WorkOrderNoteCreate,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<WorkOrderNoteView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: { id: true, assignedToId: true },
      });
      if (!workOrder) throw notFound();
      await this.assertVisible(tx, workOrder, viewer);

      const note = await tx.workOrderNote.create({
        data: {
          tenantId,
          workOrderId: workOrder.id,
          authorId: viewer.userId,
          body: input.body,
          visibility: input.visibility,
        },
        include: { author: { select: { displayName: true } } },
      });
      // Olay meta verisi gövde TAŞIMAZ (görünürlük + kimlik yeter).
      await tx.workOrderEvent.create({
        data: {
          tenantId,
          workOrderId: workOrder.id,
          eventType: 'work_order.note_added',
          actorId: viewer.userId,
          metadataJson: { noteId: note.id, visibility: input.visibility },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: viewer.userId,
        action: 'work_order.note_add',
        resourceType: 'work_order',
        resourceId: workOrder.id,
        metadata: { noteId: note.id, visibility: input.visibility },
      });
      return {
        noteId: note.id,
        authorId: note.authorId,
        authorName: note.author?.displayName ?? null,
        body: note.body,
        visibility: note.visibility,
        createdAt: note.createdAt.toISOString(),
      };
    });
  }

  // ------------------------- Görünüm eşleme -------------------------

  /** RLS kapsamı dışında (transaction sonrası) saf eşleme — testlerde de kullanılır. */
  static toView(row: WorkOrderRow, now: Date = new Date()): WorkOrderView {
    const sla = slaState(row.slaDueAt, row.status, now);
    return {
      workOrderId: row.id,
      workOrderNo: row.workOrderNo,
      requestId: row.requestId,
      customerId: row.customer.id,
      customerName: row.customer.name,
      assetId: row.assetId,
      assetTag: row.asset?.assetTag ?? null,
      serviceLocationId: row.serviceLocationId,
      locationName: row.serviceLocation?.name ?? row.serviceLocation?.address ?? null,
      branchId: row.branchId,
      branchName: row.branch?.name ?? null,
      type: row.type,
      priority: row.priority,
      status: row.status,
      subject: row.subject,
      description: row.description,
      scheduledStart: row.scheduledStart?.toISOString() ?? null,
      scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
      assignedToId: row.assignedToId,
      assignedToName: row.assignedTo?.displayName ?? null,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancellationReason: row.cancellationReason,
      slaDueAt: row.slaDueAt?.toISOString() ?? null,
      slaBreached: sla.breached,
      slaAtRisk: sla.atRisk,
      scheduleOverrideReason: row.scheduleOverrideReason,
      version: row.version,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  static toEventView(event: {
    id: string;
    eventType: string;
    fromState: WorkOrderStatus | null;
    toState: WorkOrderStatus | null;
    actorId: string | null;
    actor?: { displayName: string } | null;
    metadataJson: unknown;
    occurredAt: Date;
  }): WorkOrderEventView {
    return {
      eventId: event.id,
      eventType: event.eventType,
      fromState: event.fromState,
      toState: event.toState,
      actorId: event.actorId,
      actorName: event.actor?.displayName ?? null,
      metadata: (event.metadataJson ?? {}) as Record<string, unknown>,
      occurredAt: event.occurredAt.toISOString(),
    };
  }

  static toAssignmentView(a: {
    id: string;
    userId: string;
    assignedById: string | null;
    status: 'ACTIVE' | 'REMOVED';
    assignedAt: Date;
    removedAt: Date | null;
    user?: { displayName: string } | null;
    assignedBy?: { displayName: string } | null;
  }): WorkOrderAssignmentView {
    return {
      assignmentId: a.id,
      userId: a.userId,
      userName: a.user?.displayName ?? null,
      assignedById: a.assignedById,
      status: a.status,
      assignedAt: a.assignedAt.toISOString(),
      removedAt: a.removedAt?.toISOString() ?? null,
    };
  }

  static toNoteView(n: {
    id: string;
    authorId: string | null;
    body: string;
    visibility: 'INTERNAL' | 'CUSTOMER';
    createdAt: Date;
    author?: { displayName: string } | null;
  }): WorkOrderNoteView {
    return {
      noteId: n.id,
      authorId: n.authorId,
      authorName: n.author?.displayName ?? null,
      body: n.body,
      visibility: n.visibility,
      createdAt: n.createdAt.toISOString(),
    };
  }

  /** CRM olayı yazar (müşteri/varlık zaman çizelgesi — tek kaynak crm_events). */
  private async writeCrmEvent(
    tx: ScopedClient,
    tenantId: string,
    event: {
      customerId: string;
      assetId: string | null;
      eventType: string;
      actorId: string;
      requestId?: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.crmEvent.create({
      data: {
        tenantId,
        customerId: event.customerId,
        assetId: event.assetId,
        eventType: event.eventType,
        actorId: event.actorId,
        requestId: event.requestId ?? null,
        metadataJson: event.metadata as Prisma.InputJsonValue,
      },
    });
  }
}

function notFound(message = 'İş emri bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

/** Öncelik karşılaştırma (rapor/liste sıralaması yardımcıları). */
export function priorityRank(priority: ServicePriority): number {
  const RANKS: Record<ServicePriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return RANKS[priority];
}
