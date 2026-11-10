import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CaptureSignatureRequest, SignatureView } from '@teknikflow/contracts';
import { AuditService } from '../audit/audit.service.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { IdempotencyService, type IdempotencyOutcome } from './idempotency.service.js';
import { toSignatureViewRow } from './execution.service.js';

/**
 * Faz 08 — imza servisi: müşteri/teknisyen imza yakalama (ADR-0010).
 *
 * EKLE-GÜNCELLE-YOK: imzalar append-only; hatalı imza DÜZELTME satırıyla
 * geçersiz kılınır (correctionOfId) — eski satır asla silinmez/üstüne
 * yazılmaz, yalnız supersededById işaretçisi (tek seferlik) güncellenir.
 * Strokes JSON yol koordinatlarıdır (SVG değil — script enjeksiyonu yok).
 *
 * Yetki: signature:capture izni VE kaynak düzeyi (view_all YA DA atanmış).
 */

function notFound(message = 'İş emri bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

@Injectable()
export class SignatureService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async capture(
    tenantId: string,
    workOrderId: string,
    input: CaptureSignatureRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<SignatureView>> {
    return this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/signatures',
      async (tx) => {
        const workOrder = await tx.workOrder.findFirst({
          where: { id: workOrderId, tenantId },
          select: { id: true, status: true, assignedToId: true },
        });
        if (!workOrder) throw notFound();
        if (workOrder.status === 'CLOSED' || workOrder.status === 'CANCELLED') {
          throw new ConflictException({
            message: 'Kapatılmış veya iptal edilmiş iş emrine imza eklenemez',
            code: 'WORK_ORDER_IMMUTABLE',
          });
        }
        await assertCaptureAuthority(tx, workOrder, actor);

        // Düzeltme hedefi: aynı iş emrinde, henüz geçersiz kılınmamış olmalı.
        let correctionTarget: { id: string; supersededById: string | null } | null = null;
        if (input.correctionOfId) {
          correctionTarget = await tx.workOrderSignature.findFirst({
            where: { id: input.correctionOfId, tenantId, workOrderId: workOrder.id },
            select: { id: true, supersededById: true },
          });
          if (!correctionTarget) throw notFound('Düzeltilmek istenen imza bulunamadı');
          if (correctionTarget.supersededById) {
            throw new ConflictException({
              message: 'Bu imza zaten bir düzeltmeyle geçersiz kılınmış',
              code: 'SIGNATURE_ALREADY_CORRECTED',
              supersededById: correctionTarget.supersededById,
            });
          }
        }

        const signature = await tx.workOrderSignature.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            role: input.role,
            signerName: input.signerName,
            strokesJson: input.strokes as unknown as Prisma.InputJsonValue,
            note: input.note ?? null,
            capturedById: actor.userId,
            signedAt: new Date(input.signedAt),
            correctionOfId: input.correctionOfId ?? null,
          },
        });

        // Tek seferlik işaretçi güncellemesi (append-only istisnası —
        // düzeltme zinciri için gerekli; geçmiş satır içeriği değişmez).
        if (correctionTarget) {
          await tx.workOrderSignature.update({
            where: { id: correctionTarget.id },
            data: { supersededById: signature.id },
          });
        }

        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            eventType: 'work_order.signature_captured',
            actorId: actor.userId,
            metadataJson: {
              signatureId: signature.id,
              role: signature.role,
              signerName: signature.signerName,
              ...(input.correctionOfId ? { correctionOfId: input.correctionOfId } : {}),
            },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'work_order.signature_capture',
          resourceType: 'work_order',
          resourceId: workOrder.id,
          requestId: actor.requestId,
          metadata: { signatureId: signature.id, role: signature.role },
        });
        return toSignatureViewRow(signature, null);
      },
    );
  }

  async list(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<SignatureView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: { id: true, assignedToId: true },
      });
      if (!workOrder) throw notFound();
      if (!viewer.permissions.has('work_orders:view_all')) {
        if (workOrder.assignedToId !== viewer.userId) {
          const active = await tx.workOrderAssignment.findFirst({
            where: { workOrderId: workOrder.id, userId: viewer.userId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!active) throw notFound(); // varlık sızıntısı yok
        }
      }
      const signatures = await tx.workOrderSignature.findMany({
        where: { tenantId, workOrderId: workOrder.id },
        orderBy: { createdAt: 'asc' },
        include: { capturedBy: { select: { displayName: true } } },
      });
      return signatures.map((signature) =>
        toSignatureViewRow(signature, signature.capturedBy?.displayName ?? null),
      );
    });
  }
}

async function assertCaptureAuthority(
  tx: ScopedClient,
  workOrder: { id: string; assignedToId: string | null },
  actor: { userId: string; permissions: Set<string> },
): Promise<void> {
  if (!actor.permissions.has('signature:capture')) {
    throw new ForbiddenException({
      message: 'İmza toplama yetkiniz yok',
      code: 'FORBIDDEN',
    });
  }
  if (actor.permissions.has('work_orders:view_all')) return;
  if (workOrder.assignedToId === actor.userId) return;
  const active = await tx.workOrderAssignment.findFirst({
    where: { workOrderId: workOrder.id, userId: actor.userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!active) {
    throw new ForbiddenException({
      message: 'Bu iş emri için imza yetkiniz yok',
      code: 'FORBIDDEN',
    });
  }
}
