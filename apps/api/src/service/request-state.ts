import type { RequestStatus } from '@teknikflow/contracts';

/**
 * Faz 05 — servis talebi durum makinesi (saf).
 *
 * NEW → IN_REVIEW → CONVERTED; CANCELLED herhangi bir açık durumdan neden
 * koduyla. CONVERTED ve CANCELLED terminaldir; talep başına BİR iş emri
 * (birebir) üretilir — iş emri tarafında requestId tekil indeks garantisi.
 */

export const REQUEST_TRANSITIONS: Readonly<Record<RequestStatus, readonly RequestStatus[]>> = {
  NEW: ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['CANCELLED'],
  CONVERTED: [],
  CANCELLED: [],
};

export const REQUEST_STATES = Object.keys(REQUEST_TRANSITIONS) as RequestStatus[];

export function isRequestTransitionAllowed(from: RequestStatus, to: RequestStatus): boolean {
  if (from === to) return false;
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** Talep dönüşüme açık mı (NEW veya IN_REVIEW)? */
export function isConvertible(status: RequestStatus): boolean {
  return status === 'NEW' || status === 'IN_REVIEW';
}

export function isRequestTerminal(status: RequestStatus): boolean {
  return status === 'CONVERTED' || status === 'CANCELLED';
}
