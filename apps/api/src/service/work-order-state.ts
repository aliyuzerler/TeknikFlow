import { ConflictException } from '@nestjs/common';
import type { WorkOrderStatus } from '@teknikflow/contracts';

/**
 * Faz 05 — iş emri durum makinesi (ADR-0007).
 *
 * TEK GERÇEKLİK: izinli geçişler bu modülde tanımlıdır; servis ve testler
 * aynı haritayı kullanır. Geçiş yetkisi sınıfları:
 *
 * - PLANNING  : work_orders:create VEYA work_orders:dispatch (planlama/geri al)
 * - DISPATCH  : work_orders:dispatch (atama / atamayı kaldırma)
 * - EXECUTION : work_orders:complete VE (work_orders:view_all VEYA aktif atanan)
 *               — teknisyen yalnız KENDİ işini yürütür (docs/ROLES_PERMISSIONS.md
 *               "Assigned only"); yönetici rolleri görünür tüm işleri yürütebilir.
 * - CLOSE     : work_orders:complete VE work_orders:view_all (yönetici kapatır)
 * - CANCEL    : work_orders:create VEYA work_orders:dispatch (neden kodu zorunlu)
 *
 * TERMINAL durumlar: CLOSED, CANCELLED. Kendine geçiş (A→A) geçersizdir.
 */

export type TransitionAuthority = 'PLANNING' | 'DISPATCH' | 'EXECUTION' | 'CLOSE' | 'CANCEL';

export type WorkOrderTransitionAction =
  | 'PLAN'
  | 'BACK_TO_DRAFT'
  | 'ASSIGN'
  | 'UNASSIGN'
  | 'ACCEPT'
  | 'START_TRAVEL'
  | 'ARRIVE'
  | 'START_WORK'
  | 'HOLD_PARTS'
  | 'HOLD_CUSTOMER'
  | 'RESUME'
  | 'COMPLETE'
  | 'REOPEN'
  | 'CLOSE'
  | 'CANCEL';

export interface TransitionRule {
  from: WorkOrderStatus;
  to: WorkOrderStatus;
  action: WorkOrderTransitionAction;
  authority: TransitionAuthority;
}

/** İzinli geçiş tablosu (from → kural listesi). */
export const WORK_ORDER_TRANSITIONS: Readonly<Record<WorkOrderStatus, readonly TransitionRule[]>> =
  {
    DRAFT: [
      { from: 'DRAFT', to: 'PLANNED', action: 'PLAN', authority: 'PLANNING' },
      { from: 'DRAFT', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    PLANNED: [
      { from: 'PLANNED', to: 'ASSIGNED', action: 'ASSIGN', authority: 'DISPATCH' },
      { from: 'PLANNED', to: 'DRAFT', action: 'BACK_TO_DRAFT', authority: 'PLANNING' },
      { from: 'PLANNED', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    ASSIGNED: [
      { from: 'ASSIGNED', to: 'ACCEPTED', action: 'ACCEPT', authority: 'EXECUTION' },
      { from: 'ASSIGNED', to: 'PLANNED', action: 'UNASSIGN', authority: 'DISPATCH' },
      { from: 'ASSIGNED', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    ACCEPTED: [
      { from: 'ACCEPTED', to: 'EN_ROUTE', action: 'START_TRAVEL', authority: 'EXECUTION' },
      { from: 'ACCEPTED', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    EN_ROUTE: [
      { from: 'EN_ROUTE', to: 'ON_SITE', action: 'ARRIVE', authority: 'EXECUTION' },
      { from: 'EN_ROUTE', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    ON_SITE: [
      { from: 'ON_SITE', to: 'IN_PROGRESS', action: 'START_WORK', authority: 'EXECUTION' },
      { from: 'ON_SITE', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    IN_PROGRESS: [
      { from: 'IN_PROGRESS', to: 'WAITING_PARTS', action: 'HOLD_PARTS', authority: 'EXECUTION' },
      {
        from: 'IN_PROGRESS',
        to: 'WAITING_CUSTOMER',
        action: 'HOLD_CUSTOMER',
        authority: 'EXECUTION',
      },
      { from: 'IN_PROGRESS', to: 'COMPLETED', action: 'COMPLETE', authority: 'EXECUTION' },
      { from: 'IN_PROGRESS', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    WAITING_PARTS: [
      { from: 'WAITING_PARTS', to: 'IN_PROGRESS', action: 'RESUME', authority: 'EXECUTION' },
      { from: 'WAITING_PARTS', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    WAITING_CUSTOMER: [
      { from: 'WAITING_CUSTOMER', to: 'IN_PROGRESS', action: 'RESUME', authority: 'EXECUTION' },
      { from: 'WAITING_CUSTOMER', to: 'CANCELLED', action: 'CANCEL', authority: 'CANCEL' },
    ],
    COMPLETED: [
      { from: 'COMPLETED', to: 'IN_PROGRESS', action: 'REOPEN', authority: 'EXECUTION' },
      { from: 'COMPLETED', to: 'CLOSED', action: 'CLOSE', authority: 'CLOSE' },
    ],
    CLOSED: [],
    CANCELLED: [],
  };

/** Geçerli tüm durum değerleri (sözleşmeyle birebir). */
export const WORK_ORDER_STATES = Object.keys(WORK_ORDER_TRANSITIONS) as WorkOrderStatus[];

export function findTransitionRule(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): TransitionRule | undefined {
  if (from === to) return undefined;
  return WORK_ORDER_TRANSITIONS[from].find((rule) => rule.to === to);
}

export function isTransitionAllowed(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return findTransitionRule(from, to) !== undefined;
}

/** Bir durumdan izinli hedef durumlar (UI eylem düğmeleri için). */
export function allowedTargets(from: WorkOrderStatus): WorkOrderStatus[] {
  return WORK_ORDER_TRANSITIONS[from].map((rule) => rule.to);
}

/** Geçerli kuralı döner; geçersizse 409 INVALID_TRANSITION fırlatır. */
export function requireTransitionRule(from: WorkOrderStatus, to: WorkOrderStatus): TransitionRule {
  const rule = findTransitionRule(from, to);
  if (!rule) {
    throw new ConflictException({
      message: `'${from}' durumundan '${to}' durumuna geçiş izinli değil`,
      code: 'INVALID_TRANSITION',
      from,
      to,
      allowed: allowedTargets(from),
    });
  }
  return rule;
}

/**
 * Geçişin taraf değişkenleri üzerindeki etkisi (saf — DB'ye servis uygular).
 * Timestamp'ler UTC; yeniden açmada tamamlanma zamanı temizlenir, atama
 * kaldırılınca kabul zamanı sıfırlanır (olay geçmişinde kalır).
 */
export function transitionEffects(to: WorkOrderStatus): {
  acceptedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  closedAt?: Date | null;
  cancelledAt?: Date | null;
  clearAssignee?: boolean;
} {
  switch (to) {
    case 'DRAFT':
      return { acceptedAt: null };
    case 'PLANNED':
      return { acceptedAt: null, clearAssignee: true };
    case 'ACCEPTED':
      return { acceptedAt: new Date() };
    case 'IN_PROGRESS':
      return { startedAt: new Date(), completedAt: null };
    case 'COMPLETED':
      return { completedAt: new Date() };
    case 'CLOSED':
      return { closedAt: new Date() };
    case 'CANCELLED':
      return { cancelledAt: new Date() };
    default:
      return {};
  }
}
