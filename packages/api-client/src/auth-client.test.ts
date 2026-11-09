import { afterEach, describe, expect, it, vi } from 'vitest';
import { login, logout, signup } from './auth-client.js';

/**
 * Faz 03 — kimlik istemcisi birim testleri (fetch alaylanır).
 * Gerçek akışlar API entegrasyon testlerinde uçtan uca doğrulanır.
 */

const validLoginBody = {
  user: { userId: 'u1', email: 'owner@atlas.test', displayName: 'Sahip', platformAdmin: false },
  membership: {
    membershipId: 'm1',
    tenantId: 't1',
    tenantName: 'Atlas',
    tenantSlug: 'atlas',
    roleKey: 'owner',
    roleName: 'Firma Sahibi',
    branchScope: 'ALL',
    status: 'ACTIVE',
  },
  permissions: ['users:manage'],
  csrfToken: 'csrf-1',
};

function mockFetch(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

const CTX = { baseUrl: 'http://api.test', cookieHeader: 'tf_session=x', csrfToken: 'c' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('login', () => {
  it('başarılı yanıtı sözleşmeyle döndürür ve çerez/CSRF başlıklarını iletir', async () => {
    const fetchMock = mockFetch(validLoginBody);
    vi.stubGlobal('fetch', fetchMock);

    const result = await login(CTX, { email: 'owner@atlas.test', password: 'SahaServis2026' });
    expect(result.ok).toBe(true);
    if (result.ok && 'permissions' in result.data) {
      expect(result.data.permissions).toContain('users:manage');
    }

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toContain('/api/v1/auth/login');
    expect(call[1]?.credentials).toBe('include');
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers.cookie).toBe('tf_session=x');
    expect(headers['x-csrf-token']).toBe('c');
  });

  it('çoklu üyelik seçim yanıtı çözümlenir', async () => {
    const selectionBody = {
      selectionRequired: true,
      workspaces: [
        {
          tenantId: 't1',
          tenantName: 'Atlas',
          tenantSlug: 'atlas',
          roleKey: 'owner',
          roleName: 'Firma Sahibi',
        },
        {
          tenantId: 't2',
          tenantName: 'Beta',
          tenantSlug: 'beta',
          roleKey: 'dispatcher',
          roleName: 'Planlamacı',
        },
      ],
    };
    vi.stubGlobal('fetch', mockFetch(selectionBody));

    const result = await login(
      { baseUrl: 'http://api.test' },
      { email: 'a@b.test', password: 'x' },
    );
    expect(result.ok).toBe(true);
    if (result.ok && 'selectionRequired' in result.data) {
      expect(result.data.workspaces.length).toBe(2);
    }
  });

  it('API hata zarfı koduyla döner (INVALID_CREDENTIALS)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ code: 'INVALID_CREDENTIALS', message: 'E-posta veya parola hatalı' }, 401),
    );
    const result = await login(
      { baseUrl: 'http://api.test' },
      { email: 'a@b.test', password: 'x' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(401);
      expect(result.error.code).toBe('INVALID_CREDENTIALS');
      expect(result.error.message).toBe('E-posta veya parola hatalı');
    }
  });

  it('429 RATE_LIMITED ile döner', async () => {
    vi.stubGlobal('fetch', mockFetch({ code: 'RATE_LIMITED', message: 'Çok fazla deneme' }, 429));
    const result = await login(
      { baseUrl: 'http://api.test' },
      { email: 'a@b.test', password: 'x' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.httpStatus).toBe(429);
      expect(result.error.code).toBe('RATE_LIMITED');
    }
  });
});

describe('signup', () => {
  it('gövde alanlarını iletir ve yanıtı döndürür', async () => {
    const fetchMock = mockFetch(validLoginBody);
    vi.stubGlobal('fetch', fetchMock);

    const result = await signup(
      { baseUrl: 'http://api.test' },
      {
        tenantName: 'Atlas',
        user: { displayName: 'Sahip', email: 'owner@atlas.test', password: 'SahaServis2026' },
      },
    );
    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.timezone).toBe('Europe/Istanbul');
    expect(body.user.email).toBe('owner@atlas.test');
  });
});

describe('logout', () => {
  it('204 boş gövdeyi başarı sayar', async () => {
    vi.stubGlobal('fetch', mockFetch(null, 204));
    const result = await logout(CTX);
    expect(result.ok).toBe(true);
  });

  it('403 (CSRF) hata olarak döner', async () => {
    vi.stubGlobal('fetch', mockFetch({ code: 'CSRF_INVALID', message: 'x' }, 403));
    const result = await logout(CTX);
    expect(result.ok).toBe(false);
  });
});

describe('ağ hataları', () => {
  it('zaman aşımı ayrıştırılır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }),
    );
    const result = await login(
      { baseUrl: 'http://api.test' },
      { email: 'a@b.test', password: 'x' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
    }
  });

  it('ağ hatası ayrıştırılır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const result = await login(
      { baseUrl: 'http://api.test' },
      { email: 'a@b.test', password: 'x' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network-error');
    }
  });
});
