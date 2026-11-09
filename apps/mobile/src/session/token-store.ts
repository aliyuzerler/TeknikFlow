import * as SecureStore from 'expo-secure-store';

/**
 * Faz 07 — token deposu (ADR-0004 §7: tokenlar OS güvenli depoda —
 * iOS Keychain / Android Keystore; SQLite/plain preferences YASAK).
 *
 * Depolananlar: erişim + refresh token ve son oturum meta'sı (çevrimdışı
 * açılışta kimlik gösterimi). Hassas olmayan meta da SecureStore'da tutulur —
 * cihazda düz metin hassas veri ilkesi tek çukura indirgenir.
 */

const ACCESS_KEY = 'tf.access';
const REFRESH_KEY = 'tf.refresh';
const META_KEY = 'tf.meta';

export interface StoredTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SessionMeta {
  /** Cache anahtarları için kimlik (Faz 07: offline açılışta da bilinir). */
  userId: string;
  tenantId: string;
  displayName: string;
  email: string;
  tenantName: string;
  roleKey: string;
}

export interface SecureTokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  getMeta(): Promise<SessionMeta | null>;
  getAccessExpiresAt(): Promise<string | null>;
  saveTokens(tokens: StoredTokens): Promise<void>;
  saveMeta(meta: SessionMeta): Promise<void>;
  clear(): Promise<void>;
}

/** Üretim: expo-secure-store (Keychain/Keystore). */
export function createSecureStoreTokenStore(): SecureTokenStore {
  async function get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      // Keychain okunamazsa (cihaz kilidi sıfırlandı vb.) anahtar yok sayılır —
      // oturum bootstrap'i yeniden giriş isteyerek düzelir.
      return null;
    }
  }

  return {
    async getAccessToken() {
      return get(ACCESS_KEY);
    },
    async getRefreshToken() {
      return get(REFRESH_KEY);
    },
    async getMeta() {
      const raw = await get(META_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as SessionMeta;
        if (
          typeof parsed.userId === 'string' &&
          typeof parsed.tenantId === 'string' &&
          typeof parsed.displayName === 'string' &&
          typeof parsed.email === 'string' &&
          typeof parsed.tenantName === 'string' &&
          typeof parsed.roleKey === 'string'
        ) {
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    },
    async getAccessExpiresAt() {
      return get(`${ACCESS_KEY}:exp`);
    },
    async saveTokens(stored) {
      await SecureStore.setItemAsync(ACCESS_KEY, stored.accessToken);
      await SecureStore.setItemAsync(REFRESH_KEY, stored.refreshToken);
      await SecureStore.setItemAsync(`${ACCESS_KEY}:exp`, stored.accessTokenExpiresAt);
    },
    async saveMeta(meta) {
      await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta));
    },
    async clear() {
      for (const key of [ACCESS_KEY, REFRESH_KEY, `${ACCESS_KEY}:exp`, META_KEY]) {
        try {
          await SecureStore.deleteItemAsync(key);
        } catch {
          // Silinemez anahtar (var olmayan) sorun değil.
        }
      }
    },
  };
}

/** Testler: bellek-içi depo (aynı arayüz; jest setup'taki SecureStore mock'una ihtiyaç duymaz). */
export function createMemoryTokenStore(): SecureTokenStore & { dump(): Map<string, string> } {
  const store = new Map<string, string>();
  const impl: SecureTokenStore = {
    async getAccessToken() {
      return store.get(ACCESS_KEY) ?? null;
    },
    async getRefreshToken() {
      return store.get(REFRESH_KEY) ?? null;
    },
    async getMeta() {
      const raw = store.get(META_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SessionMeta;
      } catch {
        return null;
      }
    },
    async getAccessExpiresAt() {
      return store.get(`${ACCESS_KEY}:exp`) ?? null;
    },
    async saveTokens(stored) {
      store.set(ACCESS_KEY, stored.accessToken);
      store.set(REFRESH_KEY, stored.refreshToken);
      store.set(`${ACCESS_KEY}:exp`, stored.accessTokenExpiresAt);
    },
    async saveMeta(meta) {
      store.set(META_KEY, JSON.stringify(meta));
    },
    async clear() {
      store.clear();
    },
  };
  return { ...impl, dump: () => store };
}
