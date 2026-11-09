import type { WorkOrderView } from '@teknikflow/contracts';
import type { CacheDriver } from './driver';

/**
 * Faz 07 — atanmış iş emri önbelleği (çevrimdışı gelen kutusunun veri
 * kaynağı). Teknisyen bazlı anahtarlar: kullanıcı logout'ta temizlenir;
 * kiracı değişimi (aynı kullanıcı başka kiracıya girdiğinde) kolonlarda
 * tenant_id ile görülür ve liste kiracı filtresiyle döner.
 */

export interface CachedWorkOrder {
  workOrderId: string;
  tenantId: string;
  status: WorkOrderView['status'];
  scheduledStart: string | null;
  syncedAt: string;
  payload: WorkOrderView;
}

export interface WorkOrderCache {
  replaceAllForTenant(userId: string, tenantId: string, orders: WorkOrderView[]): Promise<void>;
  list(userId: string, tenantId: string): Promise<CachedWorkOrder[]>;
  get(userId: string, id: string): Promise<CachedWorkOrder | null>;
  clear(userId?: string): Promise<void>;
  lastSyncAt(userId: string, tenantId: string): Promise<string | null>;
}

function keyOf(userId: string, workOrderId: string): string {
  return `${userId}:${workOrderId}`;
}

export function createWorkOrderCache(driver: CacheDriver): WorkOrderCache {
  const store = driver.collection<CachedWorkOrder>('cached_work_order');

  return {
    async replaceAllForTenant(userId, tenantId, orders) {
      const syncedAt = new Date().toISOString();
      const stale = (await store.listByPrefix(`${userId}:`)).filter(
        (row) => row.value.tenantId !== tenantId,
      );
      for (const row of stale) await store.delete(row.key);
      // Kiracı değişimi: eski kiracının lastSyncAt'ı da düşer (sızıntı/karışıklık yok).
      const meta = driver.collection<string>('sync_meta');
      for (const entry of await meta.listByPrefix(`lastSyncAt:${userId}:`)) {
        if (entry.key !== `lastSyncAt:${userId}:${tenantId}`) await meta.delete(entry.key);
      }
      for (const order of orders) {
        await store.put(keyOf(userId, order.workOrderId), {
          workOrderId: order.workOrderId,
          tenantId,
          status: order.status,
          scheduledStart: order.scheduledStart,
          syncedAt,
          payload: order,
        });
      }
      await meta.put(`lastSyncAt:${userId}:${tenantId}`, syncedAt);
    },

    async list(userId, tenantId) {
      const rows = await store.listByPrefix(`${userId}:`);
      return rows.map((row) => row.value).filter((row) => row.tenantId === tenantId);
    },

    async get(userId, id) {
      return store.get(keyOf(userId, id));
    },

    async clear(userId) {
      await store.deleteByPrefix(userId ? `${userId}:` : '');
    },

    async lastSyncAt(userId, tenantId) {
      const meta = driver.collection<string>('sync_meta');
      return meta.get(`lastSyncAt:${userId}:${tenantId}`) ?? null;
    },
  };
}
