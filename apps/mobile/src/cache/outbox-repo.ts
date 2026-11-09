import type { CacheDriver } from './driver';

/**
 * Faz 07 — senkron outbox (ADR-0004 §2; OFFLINE_SYNC.md).
 *
 * Her kuyruğa alınmış işlem idempotency anahtarı taşır (UUID v4); sunucu
 * tekrarı tekilleştirir. Faz 07: altyapı (kuyruk durum makinesi + backoff
 * zamanlaması) — operasyon tipleri Faz 08'de (saha eylemleri) eklenir.
 */

export type OutboxState = 'queued' | 'syncing' | 'failed' | 'done';

export interface OutboxOperation {
  /** Sıra sıralaması (oluşturma zamanı). */
  createdAt: string;
  /** Sunucu idempotency anahtarı (UUID v4 — üretimde crypto.randomUUID). */
  idempotencyKey: string;
  tenantId: string;
  userId: string;
  entityId: string;
  baseVersion: number;
  operation: string;
  payload: Record<string, unknown>;
}

export interface OutboxRow extends OutboxOperation {
  id: string;
  state: OutboxState;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}

export interface OutboxRepo {
  enqueue(op: OutboxOperation): Promise<OutboxRow>;
  /** Gönderilebilir satırlar: queued ya da (failed ve nextAttemptAt geçmiş). */
  pending(userId: string, now?: Date): Promise<OutboxRow[]>;
  markSyncing(id: string): Promise<void>;
  markDone(id: string): Promise<void>;
  /** Hata: attempts +1; nextAttemptAt backoff ile hesaplanır. */
  markFailed(id: string, error: string, nextAttemptAt: string): Promise<void>;
  countPending(userId: string): Promise<number>;
  clear(userId?: string): Promise<void>;
}

export function createOutboxRepo(driver: CacheDriver): OutboxRepo {
  const store = driver.collection<OutboxRow>('sync_outbox');

  return {
    async enqueue(op) {
      const id = `${op.createdAt}:${op.idempotencyKey}`;
      const row: OutboxRow = {
        ...op,
        id,
        state: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
      };
      await store.put(id, row);
      return row;
    },

    async pending(userId, now = new Date()) {
      const rows = await store.listByPrefix('');
      return rows
        .map((row) => row.value)
        .filter(
          (row) =>
            row.userId === userId &&
            (row.state === 'queued' ||
              (row.state === 'failed' &&
                (row.nextAttemptAt === null || new Date(row.nextAttemptAt) <= now))),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async markSyncing(id) {
      const row = await store.get(id);
      if (row) await store.put(id, { ...row, state: 'syncing' });
    },

    async markDone(id) {
      const row = await store.get(id);
      if (row) await store.put(id, { ...row, state: 'done', lastError: null });
    },

    async markFailed(id, error, nextAttemptAt) {
      const row = await store.get(id);
      if (row)
        await store.put(id, {
          ...row,
          state: 'failed',
          attempts: row.attempts + 1,
          nextAttemptAt,
          lastError: error.slice(0, 200),
        });
    },

    async countPending(userId) {
      const rows = await store.listByPrefix('');
      return rows.filter((row) => row.value.userId === userId && row.value.state !== 'done').length;
    },

    async clear(userId) {
      if (!userId) {
        await store.deleteByPrefix('');
        return;
      }
      const rows = await store.listByPrefix('');
      for (const row of rows) {
        if (row.value.userId === userId) await store.delete(row.key);
      }
    },
  };
}
