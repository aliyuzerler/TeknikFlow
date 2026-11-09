import type { ServicePriority, WorkOrderStatus } from '@teknikflow/contracts';

/**
 * Faz 05 — SLA hesaplama (saf).
 *
 * Kiracı politikaları (sla_policies) öncelik başına çözüm süresi (dakika)
 * verir; politika yoksa varsayılan katalog uygulanır. slaDueAt, talebin
 * OLUŞTURULMA anından itibaren hesaplanır; öncelik değişince kalan iş
 * perspektifiyle değil, sabit referansla (createdAt) yeniden hesaplanır —
 * deterministik ve denetlenebilir.
 */

/** Kiracı politikası yoksa öncelik bazlı varsayılan çözüm süreleri (dakika). */
export const DEFAULT_SLA_RESOLVE_MINUTES: Readonly<Record<ServicePriority, number>> = {
  URGENT: 240, // 4 saat
  HIGH: 480, // 8 saat
  MEDIUM: 1440, // 24 saat
  LOW: 4320, // 72 saat
};

export function defaultResolveMinutes(priority: ServicePriority): number {
  return DEFAULT_SLA_RESOLVE_MINUTES[priority];
}

/** slaDueAt = referans an + süre (dakika). */
export function computeSlaDueAt(reference: Date, resolveMinutes: number): Date {
  return new Date(reference.getTime() + resolveMinutes * 60_000);
}

/** Terminal olmayan talep/İş sürecinde süre aşılmış mı? */
export function isSlaBreached(
  slaDueAt: Date | null,
  status: RequestStatusLike,
  now: Date = new Date(),
): boolean {
  if (!slaDueAt) return false;
  if (isTerminal(status)) return false;
  return slaDueAt.getTime() < now.getTime();
}

type RequestStatusLike = 'NEW' | 'IN_REVIEW' | 'CONVERTED' | 'CANCELLED' | WorkOrderStatus;

function isTerminal(status: RequestStatusLike): boolean {
  return status === 'CONVERTED' || status === 'CANCELLED' || status === 'CLOSED';
}
