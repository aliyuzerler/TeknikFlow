import type { MobileApiClient } from '../api/client';
import type { OutboxRepo } from '../cache/outbox-repo';
import type { VanStockCache } from '../cache/van-stock-cache';
import type { WorkOrderCache } from '../cache/work-order-cache';
import { executorFor } from './outbox-executors';

/**
 * Faz 07 — senkron servisi (ADR-0004 §3: sunucu-otoriter çekme + kuyruk
 * boşaltma). Gelen kutusu verisi sunucudan PULL edilir; outbox işlemleri
 * sırada boşaltılır.
 *
 * Faz 08 — yürütücüler bağlı: geçiş/GPS varış/checklist/süre/imza
 * işlemleri idempotency anahtarıyla gönderilir. Ağ hatası → üstel geri
 * ödeme; kalıcı reddi (4xx) → 24 saat dondurma (sunucu kazanır).
 *
 * Faz 09 — araç stoğu: çekme sırasında teknisyenin kendi aracına bağlı
 * bakiyeler cache'e yazılır (best-effort; başarısızlık iş emri çekmesini
 * bozmaz — tüketim formu çevrimiçinde sunucudan güncel alır).
 */

export type SyncOutcome =
  | { ok: true; pulled: number }
  | {
      ok: false;
      reason: 'offline' | 'network' | 'http' | 'contract';
      message: string;
      statusCode?: number;
    };

const MAX_PAGES = 5;
const PAGE_SIZE = 50;

/** Backoff: üstel 5s → 10s → 20s → 40s → 80s → cap 5dk (deterministik). */
export function nextBackoffMs(attempts: number, maxMs = 5 * 60_000): number {
  const base = 5_000;
  return Math.min(base * 2 ** Math.max(0, attempts), maxMs);
}

export interface SyncServiceDeps {
  api: MobileApiClient;
  workOrderCache: WorkOrderCache;
  outbox: OutboxRepo;
  /** Faz 09 — araç stoğu cache (opsiyonel; testler basit kalabilir). */
  vanStock?: VanStockCache;
  /** Çevrimiçi mi? (netinfo) — kapalıysa istek hiç açılmaz. */
  isOnline(): boolean;
  /** Oturum kimliği — cache anahtarları. */
  getIdentity(): Promise<{ userId: string; tenantId: string } | null>;
}

export interface SyncService {
  /** Sunucudan atanmış işleri çek → cache'i tazele (offline-first kaynak). */
  pullWorkOrders(): Promise<SyncOutcome>;
  /** Kuyruktaki işlemleri sırayla gönder (Faz 07: operasyon seti boş). */
  drainOutbox(): Promise<{ sent: number; failed: number }>;
  pendingCount(): Promise<number>;
  clearLocal(): Promise<void>;
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const { api, workOrderCache, outbox, vanStock, isOnline, getIdentity } = deps;

  async function identity(): Promise<{ userId: string; tenantId: string } | null> {
    return getIdentity();
  }

  return {
    async pullWorkOrders(): Promise<SyncOutcome> {
      if (!isOnline()) {
        return { ok: false, reason: 'offline', message: 'Cihaz çevrimdışı' };
      }
      const who = await identity();
      if (!who) return { ok: false, reason: 'http', message: 'Oturum kapalı', statusCode: 401 };

      const collected: Row[] = [];
      let page = 1;
      for (; page <= MAX_PAGES; page += 1) {
        const result = await collectPage(api, page);
        if (!result.ok) return result;
        collected.push(...result.rows);
        if (!result.hasMore) break;
      }
      await workOrderCache.replaceAllForTenant(who.userId, who.tenantId, collected);

      // Faz 09 — araç stoğu (best-effort; stok alınamazsa çekme yine ok).
      if (vanStock) {
        const stock = await api.listVanStock();
        if (stock.ok) await vanStock.put(who.userId, stock.data);
      }
      return { ok: true, pulled: collected.length };
    },

    async drainOutbox() {
      const who = await identity();
      if (!who || !isOnline()) return { sent: 0, failed: 0 };
      const rows = await outbox.pending(who.userId);
      let sent = 0;
      let failed = 0;
      for (const row of rows) {
        await outbox.markSyncing(row.id);
        // Faz 08: işlem yürütücüsü — idempotency anahtarı satırda hazır.
        const execute = executorFor(row.operation);
        if (!execute) {
          // Bilinmeyen işlem türü: kalıcı reddi — 24 saat dondur.
          await outbox.markFailed(
            row.id,
            `Bilinmeyen işlem: ${row.operation}`,
            new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
          );
          failed += 1;
          continue;
        }
        const outcome = await execute(api, row);
        if (outcome.ok) {
          await outbox.markDone(row.id);
          sent += 1;
          continue;
        }
        if (outcome.retryable) {
          // Ağ/zaman aşımı/5xx → üstel geri ödeme (5s → cap 5dk).
          await outbox.markFailed(
            row.id,
            outcome.message ?? 'Ağ hatası',
            new Date(Date.now() + nextBackoffMs(row.attempts)).toISOString(),
          );
        } else {
          // Kalıcı reddi (4xx): sunucu sözleşme/yetki/durum makinesi kazanır.
          // Kuyrukta görünür kalır ama 24 saat yeniden denenmez — çakışma
          // görünümü teknisyene sunulur (OFFLINE_SYNC çatışma politikası).
          await outbox.markFailed(
            row.id,
            outcome.message ?? 'Sunucu reddi',
            new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
          );
        }
        failed += 1;
      }
      return { sent, failed };
    },

    async pendingCount() {
      const who = await identity();
      if (!who) return 0;
      return outbox.countPending(who.userId);
    },

    async clearLocal() {
      await workOrderCache.clear();
      await outbox.clear();
      if (vanStock) await vanStock.clear();
    },
  };
}

type Row = Parameters<WorkOrderCache['replaceAllForTenant']>[2][number];

type PageResult =
  | { ok: false; reason: 'network' | 'http'; message: string; statusCode?: number }
  | { ok: true; rows: Row[]; hasMore: boolean };

async function collectPage(api: MobileApiClient, page: number): Promise<PageResult> {
  const result = await api.listWorkOrders({ page, pageSize: PAGE_SIZE });
  if (!result.ok) {
    return {
      ok: false,
      reason:
        result.error.kind === 'network' || result.error.kind === 'timeout' ? 'network' : 'http',
      message: result.error.message,
      ...(result.error.kind === 'http' ? { statusCode: result.error.statusCode } : {}),
    };
  }
  const hasMore =
    result.data.pageInfo.page * result.data.pageInfo.pageSize < result.data.pageInfo.total;
  return { ok: true, rows: result.data.data, hasMore };
}
