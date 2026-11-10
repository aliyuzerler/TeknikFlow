import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EVIDENCE_MISSING_CODE,
  type ChecklistItemCreate,
  type ChecklistItemView,
  type ChecklistResponsesUpdate,
  type LaborEntryCreate,
  type LaborEntryView,
  type SignatureCapture,
  type SignatureView,
  type SignatoryRole,
  type WorkOrderReportPreview,
  type WorkOrderVisitView,
} from '@teknikflow/contracts';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import {
  isTerminalStatus,
  laborDurationMinutes,
  validateChecklistResponseValue,
} from './execution-rules.js';
import { withIdempotency } from './idempotency.js';
import {
  assertCanExecuteWorkOrder,
  assertVisibleWorkOrder,
  type ExecutionActor,
} from './work-order-access.js';

/**
 * Faz 08 — saha yürütme servisi: checklist, işçilik, ziyaret okuma,
 * imza (append-only) ve rapor önizlemesi. Medya ayrı serviste
 * (media.service.ts — S3 etkileşimi).
 *
 * Tüm yazmalar kiracı kapsamlı transaction içinde (RLS) + denetim izi.
 */

type ChecklistRow = Prisma.ChecklistItemGetPayload<{
  include: { respondedBy: { select: { id: true; displayName: true } } };
}>;
type LaborRow = Prisma.WorkOrderTimeEntryGetPayload<{
  include: { user: { select: { id: true; displayName: true } } };
}>;
type VisitRow = Prisma.WorkOrderVisitGetPayload<{
  include: { recordedBy: { select: { id: true; displayName: true } } };
}>;
type SignatureRow = Prisma.WorkOrderSignatureGetPayload<{
  include: { capturedBy: { select: { id: true; displayName: true } } };
}>;

const CHECKLIST_MAX_ITEMS = 100;

@Injectable()
export class ExecutionService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------- Checklist -------------------------

  async listChecklist(
    tenantId: string,
    workOrderId: string,
    actor: ExecutionActor,
  ): Promise<ChecklistItemView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
      const items = await tx.checklistItem.findMany({
        where: { workOrderId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: { respondedBy: { select: { id: true, displayName: true } } },
      });
      return items.map(toChecklistView);
    });
  }

  async createChecklistItem(
    tenantId: string,
    workOrderId: string,
    input: ChecklistItemCreate,
    actor: ExecutionActor,
  ): Promise<ChecklistItemView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await assertCanExecuteWorkOrder(tx, tenantId, workOrderId, actor);
      if (isTerminalStatus(workOrder.status)) {
        throw new ConflictException({
          message: `Terminal durumlu (${workOrder.status}) iş emrine checklist eklenemez`,
          code: 'INVALID_STATE',
        });
      }
      const count = await tx.checklistItem.count({ where: { workOrderId } });
      if (count >= CHECKLIST_MAX_ITEMS) {
        throw new BadRequestException({
          message: `Checklist en fazla ${CHECKLIST_MAX_ITEMS} madde içerebilir`,
          code: 'CHECKLIST_LIMIT',
        });
      }
      const item = await tx.checklistItem.create({
        data: {
          tenantId,
          workOrderId,
          label: input.label,
          responseType: input.responseType,
          required: input.required,
          optionsJson: input.options ?? Prisma.JsonNull,
          sortOrder: input.sortOrder ?? count,
        },
        include: { respondedBy: { select: { id: true, displayName: true } } },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'execution.checklist_item_created',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: actor.requestId,
        metadata: { checklistItemId: item.id, responseType: item.responseType },
      });
      return toChecklistView(item);
    });
  }

  async updateChecklistResponses(
    tenantId: string,
    workOrderId: string,
    input: ChecklistResponsesUpdate,
    actor: ExecutionActor,
    idempotencyKey?: string,
  ): Promise<{ body: ChecklistItemView[]; replayed: boolean }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const result = await withIdempotency(tx, {
        tenantId,
        userId: actor.userId,
        scope: 'checklist.responses',
        key: idempotencyKey,
        body: input,
        statusCode: 200,
        run: () => this.applyChecklistResponses(tx, tenantId, workOrderId, input, actor),
      });
      return { body: result.body, replayed: result.replayed };
    });
  }

  private async applyChecklistResponses(
    tx: ScopedClient,
    tenantId: string,
    workOrderId: string,
    input: ChecklistResponsesUpdate,
    actor: ExecutionActor,
  ): Promise<ChecklistItemView[]> {
    const workOrder = await assertCanExecuteWorkOrder(tx, tenantId, workOrderId, actor);
    if (isTerminalStatus(workOrder.status)) {
      throw new ConflictException({
        message: `Terminal durumlu (${workOrder.status}) iş emrinde yanıt güncellenemez`,
        code: 'INVALID_STATE',
      });
    }
    const ids = input.responses.map((response) => response.checklistItemId);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new BadRequestException({
        message: 'Aynı madde iki kez gönderilemez',
        code: 'DUPLICATE_CHECKLIST_ITEM',
      });
    }
    const items = await tx.checklistItem.findMany({
      where: { workOrderId, id: { in: ids } },
    });
    if (items.length !== ids.length) {
      throw new NotFoundException({
        message: 'Yanıt setinde bu iş emrine ait olmayan madde var',
        code: 'NOT_FOUND',
      });
    }
    const byId = new Map(items.map((item) => [item.id, item]));

    // Önce TÜM doğrulamalar (tek tek kısmi yazma yok).
    for (const response of input.responses) {
      const item = byId.get(response.checklistItemId)!;
      const options = Array.isArray(item.optionsJson) ? (item.optionsJson as string[]) : null;
      const error = validateChecklistResponseValue(item.responseType, options, response.value);
      if (error) {
        throw new BadRequestException({
          message: error,
          code: 'INVALID_CHECKLIST_RESPONSE',
          fields: [{ field: `responses.${item.id}`, message: error }],
        });
      }
    }

    for (const response of input.responses) {
      await tx.checklistItem.update({
        where: { id: response.checklistItemId },
        data: {
          responseValue:
            response.value === null || response.value === undefined
              ? Prisma.JsonNull
              : (response.value as Prisma.InputJsonValue),
          respondedAt: new Date(),
          respondedById: actor.userId,
        },
      });
    }
    await this.audit.log({
      tenantId,
      actorId: actor.userId,
      action: 'execution.checklist_responses_updated',
      resourceType: 'work_order',
      resourceId: workOrderId,
      requestId: actor.requestId,
      metadata: { count: input.responses.length },
    });
    const updated = await tx.checklistItem.findMany({
      where: { workOrderId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { respondedBy: { select: { id: true, displayName: true } } },
    });
    return updated.map(toChecklistView);
  }

  // ------------------------- İşçilik (labor) -------------------------

  async listLabor(
    tenantId: string,
    workOrderId: string,
    actor: ExecutionActor,
  ): Promise<LaborEntryView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
      const rows = await tx.workOrderTimeEntry.findMany({
        where: { workOrderId },
        orderBy: { startedAt: 'asc' },
        include: { user: { select: { id: true, displayName: true } } },
      });
      return rows.map(toLaborView);
    });
  }

  async createLaborEntry(
    tenantId: string,
    workOrderId: string,
    input: LaborEntryCreate,
    actor: ExecutionActor,
    idempotencyKey?: string,
  ): Promise<{ body: LaborEntryView; replayed: boolean }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const result = await withIdempotency(tx, {
        tenantId,
        userId: actor.userId,
        scope: 'labor.create',
        key: idempotencyKey,
        body: input,
        statusCode: 201,
        run: () => this.insertLaborEntry(tx, tenantId, workOrderId, input, actor),
      });
      return { body: result.body, replayed: result.replayed };
    });
  }

  private async insertLaborEntry(
    tx: ScopedClient,
    tenantId: string,
    workOrderId: string,
    input: LaborEntryCreate,
    actor: ExecutionActor,
  ): Promise<LaborEntryView> {
    const workOrder = await assertCanExecuteWorkOrder(tx, tenantId, workOrderId, actor);
    if (isTerminalStatus(workOrder.status)) {
      throw new ConflictException({
        message: `Terminal durumlu (${workOrder.status}) iş emrine işçilik eklenemez`,
        code: 'INVALID_STATE',
      });
    }
    const row = await tx.workOrderTimeEntry.create({
      data: {
        tenantId,
        workOrderId,
        userId: actor.userId,
        startedAt: new Date(input.startedAt),
        endedAt: new Date(input.endedAt),
        note: input.note ?? null,
      },
      include: { user: { select: { id: true, displayName: true } } },
    });
    await this.audit.log({
      tenantId,
      actorId: actor.userId,
      action: 'execution.labor_entry_created',
      resourceType: 'work_order',
      resourceId: workOrderId,
      requestId: actor.requestId,
      metadata: { timeEntryId: row.id },
    });
    return toLaborView(row);
  }

  // ------------------------- Ziyaretler (okuma) -------------------------

  async listVisits(
    tenantId: string,
    workOrderId: string,
    actor: ExecutionActor,
  ): Promise<WorkOrderVisitView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
      const rows = await tx.workOrderVisit.findMany({
        where: { workOrderId },
        orderBy: { recordedAt: 'asc' },
        include: { recordedBy: { select: { id: true, displayName: true } } },
      });
      return rows.map(toVisitView);
    });
  }

  // ------------------------- İmza (append-only) -------------------------

  async listSignatures(
    tenantId: string,
    workOrderId: string,
    actor: ExecutionActor,
  ): Promise<SignatureView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
      const rows = await tx.workOrderSignature.findMany({
        where: { workOrderId },
        orderBy: { createdAt: 'asc' },
        include: { capturedBy: { select: { id: true, displayName: true } } },
      });
      return rows.map(toSignatureView);
    });
  }

  /**
   * İmza kaydı — APPEND-ONLY: güncelleme/silme ucu YOK. Düzeltme imzası
   * correctionOfSignatureId ile önceki imzaya bağlanır (üzerine yazma yok).
   */
  async captureSignature(
    tenantId: string,
    workOrderId: string,
    input: SignatureCapture,
    actor: ExecutionActor,
    idempotencyKey?: string,
  ): Promise<{ body: SignatureView; replayed: boolean }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const result = await withIdempotency(tx, {
        tenantId,
        userId: actor.userId,
        scope: 'signature.create',
        key: idempotencyKey,
        body: input,
        statusCode: 201,
        run: () => this.insertSignature(tx, tenantId, workOrderId, input, actor),
      });
      return { body: result.body, replayed: result.replayed };
    });
  }

  private async insertSignature(
    tx: ScopedClient,
    tenantId: string,
    workOrderId: string,
    input: SignatureCapture,
    actor: ExecutionActor,
  ): Promise<SignatureView> {
    {
      const workOrder = await assertCanExecuteWorkOrder(tx, tenantId, workOrderId, actor);
      if (workOrder.status === 'CLOSED' || workOrder.status === 'CANCELLED') {
        throw new ConflictException({
          message: `Terminal durumlu (${workOrder.status}) iş emrine imza alınamaz`,
          code: 'INVALID_STATE',
        });
      }
      if (input.correctionOfSignatureId) {
        const original = await tx.workOrderSignature.findFirst({
          where: { id: input.correctionOfSignatureId, workOrderId, tenantId },
          select: { id: true, signedBy: true },
        });
        if (!original) {
          throw new NotFoundException({
            message: 'Düzeltilecek imza bu iş emrinde bulunamadı',
            code: 'NOT_FOUND',
          });
        }
        if (original.signedBy !== 'CUSTOMER') {
          throw new BadRequestException({
            message: 'Düzeltme yalnız müşteri imzaları için geçerlidir',
            code: 'INVALID_CORRECTION_TARGET',
          });
        }
      }
      if (input.signedBy === 'TECHNICIAN' && !actor.permissions.has('work_orders:complete')) {
        throw new ConflictException({
          message: 'Teknisyen imzası için work_orders:complete yetkisi gerekir',
          code: 'FORBIDDEN',
        });
      }
      const row = await tx.workOrderSignature.create({
        data: {
          tenantId,
          workOrderId,
          signedBy: input.signedBy,
          signerName: input.signerName,
          strokesJson: input.strokes as unknown as Prisma.InputJsonValue,
          capturedAt: new Date(input.capturedAt),
          note: input.note ?? null,
          correctionOfId: input.correctionOfSignatureId ?? null,
          capturedById: actor.userId,
        },
        include: { capturedBy: { select: { id: true, displayName: true } } },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'execution.signature_captured',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: actor.requestId,
        metadata: {
          signatureId: row.id,
          signedBy: row.signedBy,
          correctionOf: row.correctionOfId,
        },
      });
      return toSignatureView(row);
    }
  }

  // ------------------------- Rapor önizlemesi -------------------------

  async buildReportPreview(
    tenantId: string,
    workOrderId: string,
    actor: ExecutionActor,
  ): Promise<WorkOrderReportPreview> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
      const [visits, checklist, labor, attachmentRows, signatures] = await Promise.all([
        tx.workOrderVisit.findMany({
          where: { workOrderId },
          orderBy: { recordedAt: 'asc' },
          include: { recordedBy: { select: { id: true, displayName: true } } },
        }),
        tx.checklistItem.findMany({
          where: { workOrderId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { respondedBy: { select: { id: true, displayName: true } } },
        }),
        tx.workOrderTimeEntry.findMany({
          where: { workOrderId },
          orderBy: { startedAt: 'asc' },
          include: { user: { select: { id: true, displayName: true } } },
        }),
        tx.workOrderAttachment.findMany({
          where: { workOrderId },
          orderBy: { createdAt: 'asc' },
          include: { fileObject: true },
        }),
        tx.workOrderSignature.findMany({
          where: { workOrderId },
          orderBy: { createdAt: 'asc' },
          include: { capturedBy: { select: { id: true, displayName: true } } },
        }),
      ]);
      const totalLaborMinutes = labor.reduce(
        (sum, row) => sum + laborDurationMinutes(row.startedAt, row.endedAt),
        0,
      );
      return {
        workOrderId: workOrder.id,
        workOrderNo: workOrder.workOrderNo,
        subject: workOrder.subject,
        description: workOrder.description,
        status: workOrder.status,
        priority: workOrder.priority,
        customerName: workOrder.customer.name,
        assetTag: workOrder.asset?.assetTag ?? null,
        locationName: workOrder.serviceLocation?.name ?? null,
        branchName: workOrder.branch?.name ?? null,
        assignedToName: workOrder.assignedTo?.displayName ?? null,
        scheduledStart: workOrder.scheduledStart?.toISOString() ?? null,
        scheduledEnd: workOrder.scheduledEnd?.toISOString() ?? null,
        acceptedAt: workOrder.acceptedAt?.toISOString() ?? null,
        startedAt: workOrder.startedAt?.toISOString() ?? null,
        completedAt: workOrder.completedAt?.toISOString() ?? null,
        closedAt: workOrder.closedAt?.toISOString() ?? null,
        slaDueAt: workOrder.slaDueAt?.toISOString() ?? null,
        visits: visits.map(toVisitView),
        checklist: checklist.map(toChecklistView),
        labor: labor.map(toLaborView),
        attachments: attachmentRows.map((row) => ({
          attachmentId: row.id,
          workOrderId: row.workOrderId,
          kind: row.fileObject.kind,
          fileName: row.fileObject.fileName,
          contentType: row.fileObject.contentType,
          sizeBytes: row.fileObject.sizeBytes,
          caption: row.fileObject.caption,
          state: row.fileObject.state,
          checksumSha256: row.fileObject.checksumSha256,
          rejectionReason: row.fileObject.rejectionReason,
          viewUrl: null, // imzalı URL medya servisinde isteğe bağlı üretilir
          viewUrlExpiresAt: null,
          uploadedById: row.fileObject.uploadedById,
          uploadedByName: null,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.fileObject.completedAt?.toISOString() ?? null,
        })),
        signatures: signatures.map(toSignatureView),
        totalLaborMinutes,
        generatedAt: new Date().toISOString(),
      };
    });
  }
}

// ------------------------- Görünüm eşleyicileri -------------------------

export function toChecklistView(row: ChecklistRow): ChecklistItemView {
  return {
    checklistItemId: row.id,
    workOrderId: row.workOrderId,
    label: row.label,
    responseType: row.responseType,
    required: row.required,
    options: Array.isArray(row.optionsJson) ? (row.optionsJson as string[]) : null,
    sortOrder: row.sortOrder,
    responseValue: (row.responseValue ?? null) as ChecklistItemView['responseValue'],
    respondedAt: row.respondedAt?.toISOString() ?? null,
    respondedById: row.respondedById,
    respondedByName: row.respondedBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toLaborView(row: LaborRow): LaborEntryView {
  return {
    timeEntryId: row.id,
    workOrderId: row.workOrderId,
    userId: row.userId,
    userName: row.user.displayName,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    durationMinutes: laborDurationMinutes(row.startedAt, row.endedAt),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

function toVisitView(row: VisitRow): WorkOrderVisitView {
  return {
    visitId: row.id,
    workOrderId: row.workOrderId,
    visitType: row.visitType,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracyMeters,
    source: row.source,
    manualReason: row.manualReason,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    recordedAt: row.recordedAt.toISOString(),
    recordedById: row.recordedById,
    recordedByName: row.recordedBy?.displayName ?? null,
  };
}

function toSignatureView(row: SignatureRow): SignatureView {
  return {
    signatureId: row.id,
    workOrderId: row.workOrderId,
    signedBy: row.signedBy as SignatoryRole,
    signerName: row.signerName,
    strokes: (row.strokesJson ?? []) as SignatureView['strokes'],
    capturedAt: row.capturedAt.toISOString(),
    note: row.note,
    correctionOfSignatureId: row.correctionOfId,
    capturedById: row.capturedById,
    capturedByName: row.capturedBy?.displayName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export { EVIDENCE_MISSING_CODE };
