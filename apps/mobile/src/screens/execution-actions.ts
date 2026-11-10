import type {
  CaptureSignatureRequest,
  ChecklistItemView,
  SignatureStroke,
  WorkOrderStatus,
} from '@teknikflow/contracts';
import type { MobileApiClient } from '../api/client';
import type { OutboxRepo } from '../cache/outbox-repo';
import type { LocationProvider } from '../location/gps';
import { captureCurrentLocation, manualFallback } from '../location/gps';

/**
 * Faz 08 — saha eylemleri: her mutasyon ÖNCE outbox'a girer (offline-first
 * tek yol — çift gönderim yok), sonra çevrimiçiyse kuyruk boşaltılır.
 * Her işleme UUID idempotency anahtarı üretilir; sunucu tekrarı tekilleştirir.
 */

export type ActionOutcome =
  | { ok: true; queued: boolean; sent: boolean }
  | { ok: false; message: string; needsManualArrival?: boolean };

export interface ExecutionActionsDeps {
  api: MobileApiClient;
  outbox: OutboxRepo;
  identity: () => Promise<{ userId: string; tenantId: string } | null>;
  isOnline: () => boolean;
  drain: () => Promise<{ sent: number; failed: number }>;
  captureLocation: LocationProvider;
  /** Testler için saat enjeksiyonu. */
  now?: () => Date;
}

/** UUID v4 — crypto.randomUUID yoksa deterministik olmayan yedek. */
export function newIdempotencyKey(): string {
  const cryptoGlobal = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoGlobal?.randomUUID) {
    return cryptoGlobal.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export interface ExecutionActions {
  transition(workOrderId: string, to: WorkOrderStatus): Promise<ActionOutcome>;
  arrive(workOrderId: string, manualReason?: string): Promise<ActionOutcome>;
  toggleChecklistItem(workOrderId: string, item: ChecklistItemView): Promise<ActionOutcome>;
  startLabor(workOrderId: string, type?: 'TRAVEL' | 'LABOR'): Promise<ActionOutcome>;
  stopLabor(workOrderId: string, timeEntryId: string): Promise<ActionOutcome>;
  captureSignature(workOrderId: string, input: CaptureSignatureRequest): Promise<ActionOutcome>;
}

export function createExecutionActions(deps: ExecutionActionsDeps): ExecutionActions {
  const { outbox, identity, isOnline, drain, captureLocation } = deps;
  const now = deps.now ?? (() => new Date());

  async function enqueue(
    workOrderId: string,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<ActionOutcome> {
    const who = await identity();
    if (!who) return { ok: false, message: 'Oturum kapalı — eylem kaydedilemedi' };
    await outbox.enqueue({
      createdAt: now().toISOString(),
      idempotencyKey: newIdempotencyKey(),
      tenantId: who.tenantId,
      userId: who.userId,
      entityId: workOrderId,
      baseVersion: 0,
      operation,
      payload,
    });
    if (!isOnline()) {
      return { ok: true, queued: true, sent: false };
    }
    const result = await drain();
    return { ok: true, queued: true, sent: result.sent > 0 };
  }

  async function arrive(workOrderId: string, manualReason?: string): Promise<ActionOutcome> {
    if (manualReason !== undefined && manualReason.trim().length > 0) {
      const location = manualFallback(manualReason, now());
      return enqueue(workOrderId, 'work_order.arrive', { location });
    }
    const outcome = await captureCurrentLocation(captureLocation);
    if (outcome.kind === 'denied') {
      return {
        ok: false,
        needsManualArrival: true,
        message: 'Konum izni reddedildi — manuel onayla devam edin',
      };
    }
    if (outcome.kind === 'unavailable') {
      return {
        ok: false,
        needsManualArrival: true,
        message: outcome.message,
      };
    }
    return enqueue(workOrderId, 'work_order.arrive', { location: outcome.location });
  }

  return {
    async transition(workOrderId, to) {
      return enqueue(workOrderId, 'work_order.transition', { to });
    },

    arrive,

    async toggleChecklistItem(workOrderId, item) {
      return enqueue(workOrderId, 'checklist.complete', {
        itemId: item.itemId,
        done: !item.done,
      });
    },

    async startLabor(workOrderId, type = 'LABOR') {
      return enqueue(workOrderId, 'time_entry.start', {
        type,
        startedAt: now().toISOString(),
      });
    },

    async stopLabor(workOrderId, timeEntryId) {
      return enqueue(workOrderId, 'time_entry.stop', {
        timeEntryId,
        endedAt: now().toISOString(),
      });
    },

    async captureSignature(workOrderId, input) {
      return enqueue(workOrderId, 'signature.capture', input satisfies CaptureSignatureRequest);
    },
  };
}

/** İmza strokes'unu sözleşme biçimine çevirir (nokta alt sınırı kontrolü). */
export function strokesFromPoints(strokes: SignatureStroke[]): SignatureStroke[] {
  return strokes.filter((stroke) => stroke.length >= 2);
}
