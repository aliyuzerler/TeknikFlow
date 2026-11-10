import type {
  CaptureSignatureRequest,
  ConsumePartRequest,
  TransitionWorkOrderRequest,
} from '@teknikflow/contracts';
import type { MobileApiClient } from '../api/client';
import type { OutboxOperation } from '../cache/outbox-repo';

/**
 * Faz 08 — outbox işlem yürütücüleri (docs/OFFLINE_SYNC.md §outbox).
 *
 * Her kuyruk işlemi idempotency anahtarıyla (satırda hazır) sunucuya
 * gönderilir; uçak modu kurtarma aynı anahtarla yeniden denemede sunucuda
 * TEK işlem üretir. Sınıflandırma:
 *
 * - ok                       → işlendi (drainOutbox markDone yapar)
 * - retryable                → ağ/zaman aşımı/5xx/429 → üstel geri ödeme
 * - kalıcı reddi (4xx)       → sunucu sözleşme/yetki/durum makinesi kazanır
 *                              (OLAY: kuyrukta kalır ama 24 saat donar —
 *                              teknisyene 'çakışma' görünümü sunulur)
 */

export interface ExecutorOutcome {
  ok: boolean;
  /** Yeniden denenebilir mi (ağ hatası/5xx)? Başarıda tanımsız. */
  retryable?: boolean;
  /** Sunucu yanıtı oynatılmışsa (idempotent replay) — bilgilendirme. */
  replayed?: boolean;
  message?: string;
}

export type OutboxExecutor = (
  api: MobileApiClient,
  op: OutboxOperation,
) => Promise<ExecutorOutcome>;

function httpError(error: { kind: string; statusCode?: number; message?: string }): {
  retryable: boolean;
  message: string;
} {
  const status = error.statusCode ?? 0;
  const retryable =
    error.kind === 'network' ||
    error.kind === 'timeout' ||
    status >= 500 ||
    status === 429 ||
    status === 408;
  return { retryable, message: error.message ?? 'Sunucu reddi' };
}

/** İş emri durum geçişi — payload: TransitionWorkOrderRequest. */
export const transitionExecutor: OutboxExecutor = async (api, op) => {
  const input = op.payload as unknown as TransitionWorkOrderRequest;
  const result = await api.transitionWorkOrder(op.entityId, input, op.idempotencyKey);
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** GPS varışı — payload: { location: GpsLocation }. */
export const arriveExecutor: OutboxExecutor = async (api, op) => {
  const payload = op.payload as unknown as { location: TransitionWorkOrderRequest['location'] };
  const result = await api.arriveOnSite(op.entityId, payload.location!, op.idempotencyKey);
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** Checklist tamamlama — payload: { itemId, done, note? }. */
export const checklistCompleteExecutor: OutboxExecutor = async (api, op) => {
  const payload = op.payload as unknown as { itemId: string; done: boolean; note?: string };
  const result = await api.completeChecklistItem(
    op.entityId,
    payload.itemId,
    { done: payload.done, ...(payload.note ? { note: payload.note } : {}) },
    op.idempotencyKey,
  );
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** Checklist madde ekleme — payload: CreateChecklistItemRequest. */
export const checklistAddExecutor: OutboxExecutor = async (api, op) => {
  const payload = op.payload as unknown as { label: string; detail?: string; required?: boolean };
  const result = await api.addChecklistItem(
    op.entityId,
    {
      label: payload.label,
      ...(payload.detail ? { detail: payload.detail } : {}),
      required: payload.required ?? true,
    },
    op.idempotencyKey,
  );
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** Süre kaydı başlatma — payload: CreateTimeEntryRequest. */
export const timeEntryStartExecutor: OutboxExecutor = async (api, op) => {
  const payload = op.payload as unknown as {
    type: 'TRAVEL' | 'LABOR' | 'WAITING';
    startedAt: string;
    note?: string;
  };
  const result = await api.createTimeEntry(
    op.entityId,
    {
      type: payload.type,
      startedAt: payload.startedAt,
      ...(payload.note ? { note: payload.note } : {}),
    },
    op.idempotencyKey,
  );
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** Süre kaydı durdurma — payload: { timeEntryId, endedAt, note? }. */
export const timeEntryStopExecutor: OutboxExecutor = async (api, op) => {
  const payload = op.payload as unknown as { timeEntryId: string; endedAt: string; note?: string };
  const result = await api.stopTimeEntry(
    op.entityId,
    payload.timeEntryId,
    { endedAt: payload.endedAt, ...(payload.note ? { note: payload.note } : {}) },
    op.idempotencyKey,
  );
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** İmza yakalama — payload: CaptureSignatureRequest. */
export const signatureExecutor: OutboxExecutor = async (api, op) => {
  const payload = op.payload as unknown as CaptureSignatureRequest;
  const result = await api.captureSignature(op.entityId, payload, op.idempotencyKey);
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** İş emri parça tüketimi — payload: ConsumePartRequest. */
export const partsConsumeExecutor: OutboxExecutor = async (api, op) => {
  const input = op.payload as unknown as ConsumePartRequest;
  const result = await api.consumePart(op.entityId, input, op.idempotencyKey);
  if (result.ok) return { ok: true, replayed: result.replayed };
  const classified = httpError(result.error);
  return { ok: false, ...classified, replayed: result.replayed };
};

/** İşlem kataloğu — kuyruktaki operation dizgesi → yürütücü. */
export const OUTBOX_EXECUTORS: Readonly<Record<string, OutboxExecutor>> = {
  'work_order.transition': transitionExecutor,
  'work_order.arrive': arriveExecutor,
  'checklist.complete': checklistCompleteExecutor,
  'checklist.add': checklistAddExecutor,
  'time_entry.start': timeEntryStartExecutor,
  'time_entry.stop': timeEntryStopExecutor,
  'signature.capture': signatureExecutor,
  'parts.consume': partsConsumeExecutor,
};

/** Yürütücüyü bul; bilinmeyen işlem → kalıcı reddi (hata mesajıyla). */
export function executorFor(operation: string): OutboxExecutor | undefined {
  return OUTBOX_EXECUTORS[operation];
}
