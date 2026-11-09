import { createMemoryTokenStore, type SessionMeta } from './token-store';

/**
 * Faz 07 — token deposu sözleşmesi. Memory deposu; SecureStore üretim
 * yoludur (jest setup'ta mock'lanır, davranış aynı arayüzle kanıtlanır).
 */

const meta: SessionMeta = {
  userId: 'u1',
  tenantId: 't1',
  displayName: 'Ahmet',
  email: 'ahmet@atlas.example.test',
  tenantName: 'Atlas',
  roleKey: 'technician',
};

describe('token-store', () => {
  it('token ve meta yazımı/okuma/tuzaksız temizleme', async () => {
    const store = createMemoryTokenStore();
    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
    expect(await store.getMeta()).toBeNull();

    await store.saveTokens({
      accessToken: 'acc',
      accessTokenExpiresAt: '2026-11-09T12:00:00.000Z',
      refreshToken: 'ref',
      refreshTokenExpiresAt: '2026-12-09T12:00:00.000Z',
    });
    await store.saveMeta(meta);

    expect(await store.getAccessToken()).toBe('acc');
    expect(await store.getRefreshToken()).toBe('ref');
    expect(await store.getAccessExpiresAt()).toBe('2026-11-09T12:00:00.000Z');
    expect(await store.getMeta()).toEqual(meta);

    await store.clear();
    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
    expect(await store.getMeta()).toBeNull();
    expect(store.dump().size).toBe(0);
  });

  it('bozuk meta JSON güvenli null döner (çökmez)', async () => {
    const store = createMemoryTokenStore();
    store.dump().set('tf.meta', '{bozuk');
    expect(await store.getMeta()).toBeNull();
  });
});
