/**
 * Faz 07 — yerel önbellek sürücüsü arayüzü (ADR-0004 §1).
 *
 * Depo mantığı (depolar + senkron servisi) sürücüden bağımsızdır; sürücü
 * yalnız anahtar/değer toplulukları sunar. Üretimde expo-sqlite, testlerde
 * bellek-içi sürücü çalışır — SQL testte koşmaz, MANTIK koşar (dürüst test
 * ayrımı: sqlite sürücü yalnız tipler + DDL ile sınırlı tutulur).
 */

export interface CacheCollection<T> {
  /** Tüm kayıtları verir (sıralama sürücüye göre tanımsız; repo sıralar). */
  all(): Promise<T[]>;
  get(key: string): Promise<T | null>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Anahtar önekiyle sil (logout temizliği). */
  deleteByPrefix(prefix: string): Promise<void>;
  /** Anahtar önekiyle sıralı liste. */
  listByPrefix(prefix: string): Promise<Array<{ key: string; value: T }>>;
}

export interface CacheDriver {
  collection<T>(name: string): CacheCollection<T>;
  clear(): Promise<void>;
}

/** Bellek-içi sürücü — testler ve (ilkece) sqlite kullanılamazsa emniyet. */
export function createMemoryCacheDriver(): CacheDriver {
  const stores = new Map<string, Map<string, unknown>>();
  function storeFor(name: string): Map<string, unknown> {
    let store = stores.get(name);
    if (!store) {
      store = new Map<string, unknown>();
      stores.set(name, store);
    }
    return store;
  }
  return {
    collection<T>(name: string): CacheCollection<T> {
      const store = storeFor(name);
      return {
        async all() {
          return [...store.values()] as T[];
        },
        async get(key) {
          return (store.get(key) as T | undefined) ?? null;
        },
        async put(key, value) {
          store.set(key, value);
        },
        async delete(key) {
          store.delete(key);
        },
        async deleteByPrefix(prefix) {
          for (const key of [...store.keys()]) {
            if (key.startsWith(prefix)) store.delete(key);
          }
        },
        async listByPrefix(prefix) {
          const rows: Array<{ key: string; value: T }> = [];
          for (const [key, value] of [...store.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            if (key.startsWith(prefix)) rows.push({ key, value: value as T });
          }
          return rows;
        },
      };
    },
    async clear() {
      stores.clear();
    },
  };
}
