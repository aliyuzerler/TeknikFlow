import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ChecklistItemView,
  CompleteChecklistItemRequest,
  CreateChecklistItemRequest,
  CreateTimeEntryRequest,
  ExecutionReportView,
  LaborSummary,
  StopTimeEntryRequest,
  TimeEntryView,
  WorkOrderVisitView,
} from '@teknikflow/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { IdempotencyService, type IdempotencyOutcome } from './idempotency.service.js';
import { computeLaborSummary, entryDurationMinutes } from './execution-utils.js';
import { toPartConsumptionView } from '../inventory/inventory-views.js';

/**
 * Faz 08 — saha yürütme servisi: checklist, çalışma süresi kayıtları ve
 * yürütme raporu. GPS varış kayıtları durum makinesi geçişinde
 * (work-orders.service) yazılır; medya media.service'te; imza
 * signature.service'te.
 *
 * Kaynak düzeyi yetki: view_all YA DA atanmış teknisyen (detail
 * görünürlüğü ile aynı kural — "Assigned only", ROLES_PERMISSIONS.md).
 * Tüm erişim kiracı kopsamlı transaction içinde (RLS).
 */

function notFound(message = 'Kayıt bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

@Injectable()
export class ExecutionService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ------------------------- Checklist -------------------------

  /** Checklist maddesi ekle — planlama/ofis ya da sahada yürüten (atanan). */
  async addChecklistItem(
    tenantId: string,
    workOrderId: string,
    input: CreateChecklistItemRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<ChecklistItemView>> {
    return this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/checklist-items',
      async (tx) => {
        const workOrder = await requireExecutableWorkOrder(tx, tenantId, workOrderId);
        await this.assertCanManageChecklist(tx, workOrder, actor);

        const last = await tx.workOrderChecklistItem.findFirst({
          where: { tenantId, workOrderId },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        const position = input.position ?? (last ? last.position + 1 : 0);

        const item = await tx.workOrderChecklistItem.create({
          data: {
            tenantId,
            workOrderId,
            label: input.label,
            detail: input.detail ?? null,
            required: input.required,
            position,
          },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId,
            eventType: 'work_order.checklist_item_added',
            actorId: actor.userId,
            metadataJson: { itemId: item.id, label: item.label, required: item.required },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'work_order.checklist_item_add',
          resourceType: 'work_order',
          resourceId: workOrderId,
          requestId: actor.requestId,
          metadata: { itemId: item.id, required: item.required },
        });
        return toChecklistView(item, null);
      },
    );
  }

  /** Madde tamamlama / geri alma — idempotent (aynı durum → no-op). */
  async completeChecklistItem(
    tenantId: string,
    workOrderId: string,
    itemId: string,
    input: CompleteChecklistItemRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<ChecklistItemView>> {
    return this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'PATCH /work-orders/:id/checklist-items/:itemId',
      async (tx) => {
        const workOrder = await requireExecutableWorkOrder(tx, tenantId, workOrderId);
        await this.assertExecutionAuthority(tx, workOrder, actor);

        const item = await tx.workOrderChecklistItem.findFirst({
          where: { id: itemId, tenantId, workOrderId },
          include: { doneBy: { select: { displayName: true } } },
        });
        if (!item) throw notFound('Checklist maddesi bulunamadı');

        if (item.done === input.done) {
          // Çift gönderim: durum değişmedi → kanonik görünümü döner.
          return toChecklistView(item, item.doneBy?.displayName ?? null);
        }

        const updated = await tx.workOrderChecklistItem.update({
          where: { id: item.id },
          data: {
            done: input.done,
            doneAt: input.done ? new Date() : null,
            doneById: input.done ? actor.userId : null,
            note: input.note ?? (input.done ? item.note : null),
          },
          include: { doneBy: { select: { displayName: true } } },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId,
            eventType: input.done
              ? 'work_order.checklist_completed'
              : 'work_order.checklist_reopened',
            actorId: actor.userId,
            metadataJson: { itemId: item.id, label: item.label, required: item.required },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: input.done ? 'work_order.checklist_complete' : 'work_order.checklist_reopen',
          resourceType: 'work_order',
          resourceId: workOrderId,
          requestId: actor.requestId,
          metadata: { itemId: item.id },
        });
        return toChecklistView(updated, updated.doneBy?.displayName ?? null);
      },
    );
  }

  async listChecklistItems(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<ChecklistItemView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await requireVisibleWorkOrder(tx, tenantId, workOrderId, viewer);
      const items = await tx.workOrderChecklistItem.findMany({
        where: { tenantId, workOrderId: workOrder.id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { doneBy: { select: { displayName: true } } },
      });
      return items.map((item) => toChecklistView(item, item.doneBy?.displayName ?? null));
    });
  }

  // ------------------------- Çalışma süresi -------------------------

  async createTimeEntry(
    tenantId: string,
    workOrderId: string,
    input: CreateTimeEntryRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<TimeEntryView>> {
    return this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/time-entries',
      async (tx) => {
        const workOrder = await requireExecutableWorkOrder(tx, tenantId, workOrderId);
        await this.assertExecutionAuthority(tx, workOrder, actor);

        // Açık kayıt tekliği: çift saat sayacı engeli.
        const open = await tx.timeEntry.findFirst({
          where: { tenantId, workOrderId: workOrder.id, userId: actor.userId, status: 'OPEN' },
          select: { id: true },
        });
        if (open) {
          throw new ConflictException({
            message: 'Bu iş emrinde açık süre kaydınız var — önce durdurun',
            code: 'TIME_ENTRY_ALREADY_OPEN',
            timeEntryId: open.id,
          });
        }

        const entry = await tx.timeEntry.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            userId: actor.userId,
            type: input.type,
            startedAt: new Date(input.startedAt),
            endedAt: input.endedAt ? new Date(input.endedAt) : null,
            note: input.note ?? null,
            status: input.endedAt ? 'CLOSED' : 'OPEN',
          },
          include: { user: { select: { displayName: true } } },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            eventType: 'work_order.time_entry_started',
            actorId: actor.userId,
            metadataJson: { timeEntryId: entry.id, type: entry.type },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'work_order.time_entry_create',
          resourceType: 'work_order',
          resourceId: workOrder.id,
          requestId: actor.requestId,
          metadata: { timeEntryId: entry.id, type: entry.type },
        });
        return toTimeEntryView(entry, entry.user?.displayName ?? null);
      },
    );
  }

  async stopTimeEntry(
    tenantId: string,
    workOrderId: string,
    timeEntryId: string,
    input: StopTimeEntryRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<TimeEntryView>> {
    return this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/time-entries/:entryId/stop',
      async (tx) => {
        const workOrder = await requireExecutableWorkOrder(tx, tenantId, workOrderId);
        await this.assertExecutionAuthority(tx, workOrder, actor);

        const entry = await tx.timeEntry.findFirst({
          where: { id: timeEntryId, tenantId, workOrderId: workOrder.id },
          include: { user: { select: { displayName: true } } },
        });
        if (!entry) throw notFound('Süre kaydı bulunamadı');
        if (entry.status === 'CLOSED') {
          // Çift gönderim: zaten kapalı → kanonik görünüm (idempotent stop).
          return toTimeEntryView(entry, entry.user?.displayName ?? null);
        }
        const startedAt = entry.startedAt;
        const endedAt = new Date(input.endedAt);
        if (endedAt.getTime() <= startedAt.getTime()) {
          throw new BadRequestException({
            message: 'Bitiş zamanı başlangıçtan sonra olmalı',
            code: 'TIME_ENTRY_INVALID',
          });
        }

        const updated = await tx.timeEntry.update({
          where: { id: entry.id },
          data: {
            endedAt,
            status: 'CLOSED',
            note: input.note ?? entry.note,
          },
          include: { user: { select: { displayName: true } } },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            eventType: 'work_order.time_entry_stopped',
            actorId: actor.userId,
            metadataJson: {
              timeEntryId: entry.id,
              type: entry.type,
              durationMinutes: entryDurationMinutes(updated.startedAt, updated.endedAt),
            },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'work_order.time_entry_stop',
          resourceType: 'work_order',
          resourceId: workOrder.id,
          requestId: actor.requestId,
          metadata: { timeEntryId: entry.id },
        });
        return toTimeEntryView(updated, updated.user?.displayName ?? null);
      },
    );
  }

  async listTimeEntries(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<TimeEntryView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await requireVisibleWorkOrder(tx, tenantId, workOrderId, viewer);
      const entries = await tx.timeEntry.findMany({
        where: { tenantId, workOrderId: workOrder.id },
        orderBy: { startedAt: 'asc' },
        include: { user: { select: { displayName: true } } },
      });
      return entries.map((entry) => toTimeEntryView(entry, entry.user?.displayName ?? null));
    });
  }

  // ------------------------- Rapor -------------------------

  /** Yürütme raporu: iş emri özeti + tüm kanıt artefaktları. */
  async getReport(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<ExecutionReportView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        include: {
          customer: { select: { name: true } },
          asset: { select: { assetTag: true } },
          serviceLocation: { select: { name: true, address: true } },
          assignedTo: { select: { displayName: true } },
          visits: {
            orderBy: { recordedAt: 'asc' },
            include: { user: { select: { displayName: true } } },
          },
          checklistItems: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            include: { doneBy: { select: { displayName: true } } },
          },
          timeEntries: {
            orderBy: { startedAt: 'asc' },
            include: { user: { select: { displayName: true } } },
          },
          signatures: {
            orderBy: { createdAt: 'asc' },
            include: { capturedBy: { select: { displayName: true } } },
          },
        },
      });
      if (!workOrder) throw notFound('İş emri bulunamadı');
      if (!viewer.permissions.has('work_orders:view_all')) {
        const assigned = workOrder.assignedToId === viewer.userId;
        if (!assigned) throw forbidden();
      }

      // Medya imzalı URL'leri media servisi gibi burada üretilir (READY olanlar).
      const mediaRows = await tx.fileObject.findMany({
        where: { tenantId, workOrderId: workOrder.id },
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { displayName: true } } },
      });

      // Faz 09 — parça tüketimi: CONSUME defter satırları (referansla) ve
      // lot maliyetinden donan toplam malzeme maliyeti (kuruş).
      const partRows = await tx.stockMovement.findMany({
        where: {
          tenantId,
          movementType: 'CONSUME',
          referenceType: 'work_order',
          referenceId: workOrder.id,
        },
        orderBy: { occurredAt: 'asc' },
        include: {
          stockItem: { select: { sku: true, name: true, unit: true, trackingMode: true } },
          lot: { select: { lotNo: true } },
          fromWarehouse: { select: { id: true, name: true } },
          actor: { select: { displayName: true } },
        },
      });
      const parts = partRows.map(toPartConsumptionView);
      const partsCostMinor = parts.reduce(
        (sum, part) => sum + (part.totalCostMinor ?? 0),
        0,
      );

      const labor: LaborSummary = computeLaborSummary(
        workOrder.timeEntries.map((entry) => ({
          type: entry.type,
          startedAt: entry.startedAt,
          endedAt: entry.endedAt,
          status: entry.status,
        })),
      );

      return {
        workOrderId: workOrder.id,
        workOrderNo: workOrder.workOrderNo,
        subject: workOrder.subject,
        status: workOrder.status,
        priority: workOrder.priority,
        customerName: workOrder.customer.name,
        assetTag: workOrder.asset?.assetTag ?? null,
        locationName: workOrder.serviceLocation?.name ?? workOrder.serviceLocation?.address ?? null,
        assignedToName: workOrder.assignedTo?.displayName ?? null,
        scheduledStart: workOrder.scheduledStart?.toISOString() ?? null,
        scheduledEnd: workOrder.scheduledEnd?.toISOString() ?? null,
        acceptedAt: workOrder.acceptedAt?.toISOString() ?? null,
        startedAt: workOrder.startedAt?.toISOString() ?? null,
        completedAt: workOrder.completedAt?.toISOString() ?? null,
        closedAt: workOrder.closedAt?.toISOString() ?? null,
        labor,
        visits: workOrder.visits.map((visit) =>
          toVisitView(visit, visit.user?.displayName ?? null),
        ),
        checklist: workOrder.checklistItems.map((item) =>
          toChecklistView(item, item.doneBy?.displayName ?? null),
        ),
        timeEntries: workOrder.timeEntries.map((entry) =>
          toTimeEntryView(entry, entry.user?.displayName ?? null),
        ),
        parts,
        partsCostMinor,
        media: mediaRows.map((row) => ({
          mediaId: row.id,
          workOrderId: row.workOrderId,
          kind: row.kind,
          fileName: row.fileName,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
          status: row.status,
          failureCode: row.failureCode,
          uploadedById: row.uploadedById,
          uploadedByName: row.uploadedBy?.displayName ?? null,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          downloadUrl: null, // İmzalı URL list ucuyla dağıtılır (rapor statik kalır)
          downloadUrlExpiresAt: null,
        })),
        signatures: workOrder.signatures.map((signature) =>
          toSignatureViewRow(signature, signature.capturedBy?.displayName ?? null),
        ),
        requiredChecklistRemaining: workOrder.checklistItems.filter(
          (item) => item.required && !item.done,
        ).length,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ------------------------- Yetki -------------------------

  private async assertExecutionAuthority(
    tx: ScopedClient,
    workOrder: { id: string; assignedToId: string | null },
    actor: { userId: string; permissions: Set<string> },
  ): Promise<void> {
    if (actor.permissions.has('work_orders:complete') === false) throw forbidden();
    if (actor.permissions.has('work_orders:view_all')) return;
    if (workOrder.assignedToId === actor.userId) return;
    const active = await tx.workOrderAssignment.findFirst({
      where: { workOrderId: workOrder.id, userId: actor.userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!active) throw forbidden();
  }

  private async assertCanManageChecklist(
    tx: ScopedClient,
    workOrder: { id: string; assignedToId: string | null },
    actor: { userId: string; permissions: Set<string> },
  ): Promise<void> {
    // Planlama/ofis (create|dispatch) YA DA yürüten (atanan teknisyen dahil).
    if (
      actor.permissions.has('work_orders:create') ||
      actor.permissions.has('work_orders:dispatch')
    ) {
      return;
    }
    await this.assertExecutionAuthority(tx, workOrder, actor);
  }
}

// ------------------------- Ortak yardımcılar -------------------------

interface WorkOrderRef {
  id: string;
  tenantId: string;
  status: string;
  assignedToId: string | null;
}

/** Terminal iş emrine kanıt eklenemez (CLOSED/CANCELLED değişmez). */
async function requireExecutableWorkOrder(
  tx: ScopedClient,
  tenantId: string,
  workOrderId: string,
): Promise<WorkOrderRef> {
  const workOrder = await tx.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { id: true, tenantId: true, status: true, assignedToId: true },
  });
  if (!workOrder) throw notFound('İş emri bulunamadı');
  if (workOrder.status === 'CLOSED' || workOrder.status === 'CANCELLED') {
    throw new ConflictException({
      message: 'Kapatılmış veya iptal edilmiş iş emrine kanıt eklenemez',
      code: 'WORK_ORDER_IMMUTABLE',
    });
  }
  return workOrder;
}

/** Görünür iş emri: view_all YA DA atanmış (kaynak düzeyi). */
async function requireVisibleWorkOrder(
  tx: ScopedClient,
  tenantId: string,
  workOrderId: string,
  viewer: { userId: string; permissions: Set<string> },
): Promise<WorkOrderRef> {
  const workOrder = await tx.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { id: true, tenantId: true, status: true, assignedToId: true },
  });
  if (!workOrder) throw notFound('İş emri bulunamadı');
  if (!viewer.permissions.has('work_orders:view_all')) {
    if (workOrder.assignedToId !== viewer.userId) {
      const active = await tx.workOrderAssignment.findFirst({
        where: { workOrderId: workOrder.id, userId: viewer.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!active) throw forbidden();
    }
  }
  return workOrder;
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    message: 'Bu işlem için yetkiniz yok',
    code: 'FORBIDDEN',
  });
}

// ------------------------- Görünüm eşlemeleri -------------------------

type ChecklistRow = {
  id: string;
  workOrderId: string;
  label: string;
  detail: string | null;
  required: boolean;
  position: number;
  done: boolean;
  doneAt: Date | null;
  doneById: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toChecklistView(row: ChecklistRow, doneByName: string | null): ChecklistItemView {
  return {
    itemId: row.id,
    workOrderId: row.workOrderId,
    label: row.label,
    detail: row.detail,
    required: row.required,
    position: row.position,
    done: row.done,
    doneAt: row.doneAt?.toISOString() ?? null,
    doneById: row.doneById,
    doneByName,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type TimeEntryRow = {
  id: string;
  workOrderId: string;
  userId: string;
  type: 'TRAVEL' | 'LABOR' | 'WAITING';
  startedAt: Date;
  endedAt: Date | null;
  note: string | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
};

function toTimeEntryView(row: TimeEntryRow, userName: string | null): TimeEntryView {
  return {
    timeEntryId: row.id,
    workOrderId: row.workOrderId,
    userId: row.userId,
    userName,
    type: row.type,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    durationMinutes: entryDurationMinutes(row.startedAt, row.endedAt),
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type VisitRow = {
  id: string;
  workOrderId: string;
  userId: string;
  milestone: 'ARRIVED' | 'DEPARTED';
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  source: 'GPS' | 'MANUAL';
  manualReason: string | null;
  recordedAt: Date;
};

export function toVisitView(row: VisitRow, userName: string | null): WorkOrderVisitView {
  return {
    visitId: row.id,
    workOrderId: row.workOrderId,
    userId: row.userId,
    userName,
    milestone: row.milestone,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    source: row.source,
    manualReason: row.manualReason,
    recordedAt: row.recordedAt.toISOString(),
  };
}

type SignatureRow = {
  id: string;
  workOrderId: string;
  role: 'CUSTOMER' | 'TECHNICIAN';
  signerName: string;
  strokesJson: unknown;
  note: string | null;
  capturedById: string | null;
  signedAt: Date;
  correctionOfId: string | null;
  supersededById: string | null;
  createdAt: Date;
};

/** İmza görünümü (strokes dahil — render için; görüntüleyici kapsamlı). */
export function toSignatureViewRow(row: SignatureRow, capturedByName: string | null) {
  const strokes = Array.isArray(row.strokesJson)
    ? (row.strokesJson as Array<Array<{ x: number; y: number; t: number }>>)
    : [];
  return {
    signatureId: row.id,
    workOrderId: row.workOrderId,
    role: row.role,
    signerName: row.signerName,
    note: row.note,
    capturedById: row.capturedById,
    capturedByName,
    signedAt: row.signedAt.toISOString(),
    correctionOfId: row.correctionOfId,
    supersededById: row.supersededById,
    strokeCount: strokes.length,
    pointCount: strokes.reduce((total, stroke) => total + stroke.length, 0),
    strokes,
    createdAt: row.createdAt.toISOString(),
  };
}
