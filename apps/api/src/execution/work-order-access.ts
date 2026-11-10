import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 08 — iş emri kaynak düzeyi erişim denetimi.
 *
 * Okuma: work_orders:view_all (tümü) VEYA work_orders:view_assigned
 * (aktif atanmış). Yazma (kanıt): create/dispatch yetkisi olan ofis rolü
 * VEYA work_orders:complete + aktif atama (teknisyen kendi işi).
 *
 * Çapraz-kiracı → 404 (varlık sızıntısı yok; RLS zaten satırı gizler,
 * ama açık denetim katmanı hata mesajlarını tutarlı tutar).
 */

export type WOIncludeRow = Prisma.WorkOrderGetPayload<{
  include: {
    customer: { select: { id: true; name: true } };
    asset: { select: { id: true; assetTag: true } };
    serviceLocation: { select: { id: true; name: true; address: true } };
    branch: { select: { id: true; name: true; code: true } };
    assignedTo: { select: { id: true; displayName: true } };
    request: { select: { id: true; subject: true; status: true } };
  };
}>;

const INCLUDE = {
  customer: { select: { id: true, name: true } },
  asset: { select: { id: true, assetTag: true } },
  serviceLocation: { select: { id: true, name: true, address: true } },
  branch: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, displayName: true } },
  request: { select: { id: true, subject: true, status: true } },
} as const;

export interface ExecutionActor {
  userId: string;
  permissions: Set<string>;
  requestId?: string;
}

async function isActivelyAssigned(
  tx: ScopedClient,
  workOrderId: string,
  userId: string,
): Promise<boolean> {
  const assignment = await tx.workOrderAssignment.findFirst({
    where: { workOrderId, userId, status: 'ACTIVE' },
    select: { id: true },
  });
  return assignment !== null;
}

/** Görünür iş emrini yükle; görünmüyorsa 404. */
export async function assertVisibleWorkOrder(
  tx: ScopedClient,
  tenantId: string,
  workOrderId: string,
  actor: ExecutionActor,
): Promise<WOIncludeRow> {
  const workOrder = await tx.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    include: INCLUDE,
  });
  if (!workOrder) {
    throw new NotFoundException({ message: 'İş emri bulunamadı', code: 'NOT_FOUND' });
  }
  if (actor.permissions.has('work_orders:view_all')) return workOrder as WOIncludeRow;
  if (actor.permissions.has('work_orders:view_assigned')) {
    const assigned = await isActivelyAssigned(tx, workOrderId, actor.userId);
    if (assigned || workOrder.assignedToId === actor.userId) {
      return workOrder as WOIncludeRow;
    }
  }
  // Görme yetkisi yok — varlık sızıntısı olmadan 404.
  throw new NotFoundException({ message: 'İş emri bulunamadı', code: 'NOT_FOUND' });
}

/** Kanıt yazımı (checklist/işçilik/medya/imza) için kaynağa düzeyde denetim. */
export async function assertCanExecuteWorkOrder(
  tx: ScopedClient,
  tenantId: string,
  workOrderId: string,
  actor: ExecutionActor,
): Promise<WOIncludeRow> {
  const workOrder = await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
  const officeWrite =
    actor.permissions.has('work_orders:create') || actor.permissions.has('work_orders:dispatch');
  if (officeWrite) return workOrder;
  if (actor.permissions.has('work_orders:complete')) {
    const assigned = await isActivelyAssigned(tx, workOrderId, actor.userId);
    if (assigned || workOrder.assignedToId === actor.userId) return workOrder;
  }
  throw new ForbiddenException({
    message: 'Bu iş emrine kanıt yazma yetkiniz yok',
    code: 'FORBIDDEN',
  });
}
