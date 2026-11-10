import type { BalanceView } from '@teknikflow/contracts';
import type { CacheDriver } from './driver';

/**
 * Faz 09 — araç (van) stoğu önbelleği. Teknisyenin KENDİ aracına bağlı
 * bakiye satırları (mine=true) senkronizasyonda çekilir; çevrimdışı
 * tüketim formu bu satırlardan çalışır. Kullanıcı bazlı anahtar;
 * logout/kiracı değişiminde temizlenir (iş emri cache'iyle aynı politika).
 */

export interface CachedVanStock {
  userId: string;
  syncedAt: string;
  balances: BalanceView[];
}

export interface VanStockCache {
  /** Senkronizasyonda üstüne yazar (replace-all — bakiye her zaman sunucu otoriter). */
  put(userId: string, balances: BalanceView[]): Promise<void>;
  get(userId: string): Promise<CachedVanStock | null>;
  clear(userId?: string): Promise<void>;
}

export function createVanStockCache(driver: CacheDriver): VanStockCache {
  const store = driver.collection<CachedVanStock>('cached_van_stock');
  return {
    async put(userId, balances) {
      await store.put(userId, { userId, syncedAt: new Date().toISOString(), balances });
    },
    async get(userId) {
      return store.get(userId) ?? null;
    },
    async clear(userId) {
      await store.deleteByPrefix(userId ?? '');
    },
  };
}
