import { createMobileApiClient, type MobileApiClient } from './client';
import { createMemoryTokenStore } from '../session/token-store';
import { LoginMobileResponseSchema } from '@teknikflow/contracts';

/**
 * Faz 07 — mobil API istemcisi testleri. fetch sahte; gerçek HTTP yok —
 * istemci mantığı (bearer, 401→refresh→tekrar, zarf/şema ayrımı) kanıtlanır.
 */

function validLoginPayload(): unknown {
  const now = new Date().toISOString();
  return {
    user: {
      userId: '11111111-1111-4111-8111-000000000001',
      email: 'tech@atlas.example.test',
      displayName: 'Ahmet',
      platformAdmin: false,
    },
    membership: {
      membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenantName: 'Atlas',
      tenantSlug: 'atlas',
      roleKey: 'technician',
      roleName: 'Teknisyen',
      branchScope: 'ALL',
      status: 'ACTIVE',
    },
    permissions: ['work_orders:view_assigned'],
    accessToken: 'acc.1.sig',
    accessTokenExpiresAt: now,
    refreshToken: 'ref-1',
    refreshTokenExpiresAt: now,
  };
}

type FetchHandler = (url: string, init: RequestInit) => { status: number; body?: unknown };

function makeClient(handler: FetchHandler, onAuthLost?: () => void): MobileApiClient {
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = handler(url, init ?? {});
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return createMobileApiClient({
    baseUrl: 'http://api.test',
    tokens: tokens,
    onAuthLost,
  });
}

const tokens = createMemoryTokenStore();

beforeEach(async () => {
  await tokens.clear();
});

describe('login (client: mobile)', () => {
  it('token yanıtını ayrıştırır ve gövdeye client:mobile yazar', async () => {
    let captured: unknown;
    const client = makeClient((url, init) => {
      captured = JSON.parse(init.body as string);
      return { status: 200, body: validLoginPayload() };
    });
    const result = await client.login({ email: 'tech@atlas.example.test', password: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok && !('selectionRequired' in result.data)) {
      expect(result.data.accessToken).toBe('acc.1.sig');
    } else {
      throw new Error('token yanıtı beklenirdi');
    }
    expect(captured).toMatchObject({ client: 'mobile', email: 'tech@atlas.example.test' });
  });

  it('çoklu üyelikte seçim yanıtını döner', async () => {
    const client = makeClient(() => ({
      status: 200,
      body: {
        selectionRequired: true,
        workspaces: [
          {
            tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            tenantName: 'Atlas',
            tenantSlug: 'atlas',
            roleKey: 'technician',
            roleName: 'Teknisyen',
          },
        ],
      },
    }));
    const result = await client.login({ email: 'a@b.c', password: 'x' });
    expect(result.ok).toBe(true);
    if (result.ok && 'selectionRequired' in result.data) {
      expect(result.data.workspaces).toHaveLength(1);
    } else {
      throw new Error('seçim yanıtı beklenirdi');
    }
  });

  it('401 zarfını kodla taşır (INVALID_CREDENTIALS)', async () => {
    const client = makeClient(() => ({
      status: 401,
      body: {
        code: 'INVALID_CREDENTIALS',
        message: 'Giriş bilgileri hatalı',
        requestId: 'r1',
        statusCode: 401,
      },
    }));
    const result = await client.login({ email: 'a@b.c', password: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        kind: 'http',
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }
  });
});

describe('request: 401 → refresh → tek tekrar', () => {
  it("401'de refresh eder ve yeni tokenla tekrar dener", async () => {
    await tokens.saveTokens({
      accessToken: 'stale',
      accessTokenExpiresAt: new Date().toISOString(),
      refreshToken: 'ref-1',
      refreshTokenExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    const bearerSeen: string[] = [];
    let refreshCalls = 0;
    const client = makeClient((url, init) => {
      if (url.includes('/api/v1/work-orders')) {
        bearerSeen.push((init.headers as Record<string, string>).Authorization ?? '');
        if (bearerSeen.length === 1)
          return {
            status: 401,
            body: { code: 'AUTH_INVALID', message: 'x', requestId: 'r', statusCode: 401 },
          };
        return { status: 200, body: { data: [], pageInfo: { total: 0, page: 1, pageSize: 50 } } };
      }
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        const body = JSON.parse(init.body as string) as { refreshToken: string };
        expect(body.refreshToken).toBe('ref-1');
        const now = new Date().toISOString();
        return {
          status: 200,
          body: {
            accessToken: 'fresh',
            accessTokenExpiresAt: now,
            refreshToken: 'ref-2',
            refreshTokenExpiresAt: now,
          },
        };
      }
      return { status: 404 };
    });
    const result = await client.listWorkOrders();
    expect(result.ok).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(bearerSeen).toEqual(['Bearer stale', 'Bearer fresh']);
    // Yeni tokenlar saklanır.
    expect(await tokens.getAccessToken()).toBe('fresh');
    expect(await tokens.getRefreshToken()).toBe('ref-2');
  });

  it('refresh başarısızsa onAuthLost çağrılır ve hata döner', async () => {
    await tokens.saveTokens({
      accessToken: 'stale',
      accessTokenExpiresAt: new Date().toISOString(),
      refreshToken: 'ref-dead',
      refreshTokenExpiresAt: new Date().toISOString(),
    });
    const onAuthLost = jest.fn();
    const client = makeClient((url) => {
      if (url.endsWith('/auth/refresh'))
        return {
          status: 401,
          body: { code: 'AUTH_INVALID', message: 'x', requestId: 'r', statusCode: 401 },
        };
      return {
        status: 401,
        body: { code: 'AUTH_INVALID', message: 'x', requestId: 'r', statusCode: 401 },
      };
    }, onAuthLost);
    const result = await client.listWorkOrders();
    expect(result.ok).toBe(false);
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });
});

describe('hata sınıfları', () => {
  it('ağ hatası network tipiyle döner (dürüst hata)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('bağlantı reddedildi');
    }) as unknown as typeof fetch;
    const client = createMobileApiClient({ baseUrl: 'http://api.test', tokens });
    const result = await client.me();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });

  it('zaman aşımı timeout tipiyle döner', async () => {
    global.fetch = jest.fn((_input: string | URL | Request, init?: RequestInit) => {
      // AbortController sinyalini dinle: iptal edilince gerçek AbortError fırlat.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    }) as unknown as typeof fetch;
    const client = createMobileApiClient({ baseUrl: 'http://api.test', tokens, timeoutMs: 20 });
    const result = await client.me();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('timeout');
  });

  it('sözleşme dışı yanıt contract tipiyle döner', async () => {
    const client = makeClient(() => ({ status: 200, body: { garbled: true } }));
    const result = await client.listSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('contract');
  });
});

describe('logout / sessions / work-orders yolları', () => {
  it('logout refresh tokenı gövdeye yazar', async () => {
    let captured: unknown;
    const client = makeClient((url, init) => {
      captured = JSON.parse(init.body as string);
      return { status: 204 };
    });
    const result = await client.logout('ref-9');
    expect(result.ok).toBe(true);
    expect(captured).toEqual({ refreshToken: 'ref-9' });
  });

  it('listWorkOrders her zaman mine=true taşır (atanmış-filtre kabulü)', async () => {
    let query = '';
    const client = makeClient((url) => {
      query = url;
      return { status: 200, body: { data: [], pageInfo: { total: 0, page: 1, pageSize: 20 } } };
    });
    await client.listWorkOrders();
    expect(query).toContain('mine=true');
    expect(query).toContain('page=1');
  });

  it('getWorkOrder iş emrini ayrıştırır', async () => {
    const client = makeClient(() => ({
      status: 200,
      body: {
        workOrderId: '11111111-1111-4111-8111-111111111111',
        workOrderNo: 'WO-2026-0001',
        requestId: null,
        customerId: '22222222-2222-4222-8222-222222222222',
        customerName: 'Mega Otel',
        assetId: null,
        assetTag: null,
        serviceLocationId: null,
        locationName: null,
        branchId: null,
        branchName: null,
        type: 'CORRECTIVE',
        priority: 'HIGH',
        status: 'ASSIGNED',
        subject: 'Klima arıza',
        description: null,
        scheduledStart: null,
        scheduledEnd: null,
        assignedToId: '11111111-1111-4111-8111-000000000001',
        assignedToName: 'Ahmet',
        acceptedAt: null,
        startedAt: null,
        completedAt: null,
        closedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        slaDueAt: null,
        slaBreached: false,
        slaAtRisk: false,
        scheduleOverrideReason: null,
        version: 1,
        createdById: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));
    const result = await client.getWorkOrder('11111111-1111-4111-8111-111111111111');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.workOrderNo).toBe('WO-2026-0001');
  });

  it('LoginMobileResponseSchema demo gövdeyi kabul eder (sözleşme birebirliği)', () => {
    const parsed = LoginMobileResponseSchema.safeParse(validLoginPayload());
    expect(parsed.success).toBe(true);
  });
});
