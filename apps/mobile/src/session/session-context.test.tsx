import { act, render, waitFor } from '@testing-library/react-native';
import { createMobileApiClient, type MobileApiClient } from '../api/client';
import { createMemoryTokenStore } from '../session/token-store';
import { SessionProvider, useSession, type SessionContextValue } from './session-context';

/**
 * Faz 07 — oturum bağlamı testleri: bootstrap yolları (token yok / me ok /
 * ağ hatası → çevrimdışı oturum / auth kaybı → temiz çıkış), login (token +
 * seçim), logout temizliği. Acceptance: login, refresh, revoke, relaunch.
 */

const probeBox: { value: SessionContextValue | null } = { value: null };
function Probe(): null {
  const value = useSession();
  probeBox.value = value;
  return null;
}

function stubFetch(
  handler: (url: string, init: RequestInit) => { status: number; body?: unknown },
): void {
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = handler(url, init ?? {});
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const ME_OK = {
  status: 200,
  body: {
    user: {
      userId: '11111111-1111-4111-8111-000000000001',
      email: 'ahmet@atlas.example.test',
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
  },
};

function makeApi(
  tokensStore: ReturnType<typeof createMemoryTokenStore>,
  onAuthLost?: () => void,
): MobileApiClient {
  return createMobileApiClient({ baseUrl: 'http://api.test', tokens: tokensStore, onAuthLost });
}

const STORED_TOKENS = {
  accessToken: 'acc',
  accessTokenExpiresAt: new Date().toISOString(),
  refreshToken: 'ref',
  refreshTokenExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
};

describe('SessionProvider bootstrap', () => {
  it('token yok → signed-out', async () => {
    stubFetch(() => ({ status: 500 }));
    const tokensStore = createMemoryTokenStore();
    const utils = render(
      <SessionProvider api={makeApi(tokensStore)} tokens={tokensStore}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
    utils.unmount();
  });

  it('token var + me ok → signed-in, meta saklanır (relaunch kalıcılığı)', async () => {
    stubFetch((url) => (url.endsWith('/auth/me') ? ME_OK : { status: 404 }));
    const tokensStore = createMemoryTokenStore();
    await tokensStore.saveTokens(STORED_TOKENS);
    const utils = render(
      <SessionProvider api={makeApi(tokensStore)} tokens={tokensStore}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-in'));
    expect(probeBox.value?.meta).toMatchObject({
      userId: '11111111-1111-4111-8111-000000000001',
      tenantName: 'Atlas',
    });
    expect(await tokensStore.getMeta()).not.toBeNull();
    utils.unmount();
  });

  it('ağ hatası + kayıtlı meta → çevrimdışı oturum sürer (dürüst offline açılış)', async () => {
    stubFetch(() => {
      throw new Error('ağ yok');
    });
    const tokensStore = createMemoryTokenStore();
    await tokensStore.saveTokens(STORED_TOKENS);
    await tokensStore.saveMeta({
      userId: '11111111-1111-4111-8111-000000000001',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      displayName: 'Ahmet',
      email: 'ahmet@atlas.example.test',
      tenantName: 'Atlas',
      roleKey: 'technician',
    });
    const utils = render(
      <SessionProvider api={makeApi(tokensStore)} tokens={tokensStore}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-in'));
    expect(probeBox.value?.meta?.displayName).toBe('Ahmet');
    utils.unmount();
  });

  it('me 401 + refresh başarısız → temiz çıkış (tokenlar silinir)', async () => {
    stubFetch((url) => {
      if (url.endsWith('/auth/me'))
        return {
          status: 401,
          body: { code: 'AUTH_INVALID', message: 'x', requestId: 'r', statusCode: 401 },
        };
      if (url.endsWith('/auth/refresh'))
        return {
          status: 401,
          body: { code: 'AUTH_INVALID', message: 'x', requestId: 'r', statusCode: 401 },
        };
      return { status: 404 };
    });
    const tokensStore = createMemoryTokenStore();
    await tokensStore.saveTokens({
      ...STORED_TOKENS,
      refreshToken: 'ref-dead',
    });
    let signedOutCleared = false;
    const utils = render(
      <SessionProvider
        api={makeApi(tokensStore)}
        tokens={tokensStore}
        onSignedOut={() => {
          signedOutCleared = true;
        }}
      >
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
    expect(await tokensStore.getRefreshToken()).toBeNull();
    expect(signedOutCleared).toBe(true);
    utils.unmount();
  });
});

describe('SessionProvider login/logout', () => {
  const LOGIN_OK = {
    status: 200,
    body: {
      user: {
        userId: '11111111-1111-4111-8111-000000000001',
        email: 'ahmet@atlas.example.test',
        displayName: 'Ahmet',
        platformAdmin: false,
      },
      membership: ME_OK.body.membership,
      permissions: [],
      accessToken: 'acc1',
      accessTokenExpiresAt: new Date().toISOString(),
      refreshToken: 'ref1',
      refreshTokenExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
    },
  };

  it('login: tokenları saklar, signed-in olur; gövde client:mobile taşır', async () => {
    const bodies: Array<{ client?: string }> = [];
    stubFetch((url, init) => {
      if (url.endsWith('/auth/login')) {
        bodies.push(JSON.parse(init.body as string));
        return LOGIN_OK;
      }
      return { status: 404 };
    });
    const tokensStore = createMemoryTokenStore();
    const utils = render(
      <SessionProvider api={makeApi(tokensStore)} tokens={tokensStore}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));

    let ok = false;
    await act(async () => {
      ok = await probeBox.value!.actions.login({
        email: 'ahmet@atlas.example.test',
        password: 'x',
      });
    });
    expect(ok).toBe(true);
    expect(probeBox.value?.status).toBe('signed-in');
    expect(await tokensStore.getAccessToken()).toBe('acc1');
    expect(await tokensStore.getRefreshToken()).toBe('ref1');
    expect(bodies[0]?.client).toBe('mobile');
    utils.unmount();
  });

  it('login: çoklu üyelik → workspaces listesi; seçimle giriş tamamlanır', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/auth/login')) {
        const body = JSON.parse(init.body as string) as { tenantSlug?: string };
        if (!body.tenantSlug) {
          return {
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
                {
                  tenantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  tenantName: 'Beta',
                  tenantSlug: 'beta',
                  roleKey: 'technician',
                  roleName: 'Teknisyen',
                },
              ],
            },
          };
        }
        return {
          ...LOGIN_OK,
          body: { ...LOGIN_OK.body, accessToken: 'acc2', refreshToken: 'ref2' },
        };
      }
      return { status: 404 };
    });
    const tokensStore = createMemoryTokenStore();
    const utils = render(
      <SessionProvider api={makeApi(tokensStore)} tokens={tokensStore}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));

    let ok = false;
    await act(async () => {
      ok = await probeBox.value!.actions.login({ email: 'a@b.c', password: 'x' });
    });
    expect(ok).toBe(false);
    expect(probeBox.value?.workspaces).toHaveLength(2);

    await act(async () => {
      ok = await probeBox.value!.actions.login({
        email: 'a@b.c',
        password: 'x',
        tenantSlug: 'atlas',
      });
    });
    expect(ok).toBe(true);
    expect(probeBox.value?.status).toBe('signed-in');
    expect(await tokensStore.getRefreshToken()).toBe('ref2');
    utils.unmount();
  });

  it('login hatası → lastError kullanıcı-dostu, signed-out', async () => {
    stubFetch((url) => {
      if (url.endsWith('/auth/login')) {
        return {
          status: 401,
          body: {
            code: 'INVALID_CREDENTIALS',
            message: 'Giriş bilgileri hatalı',
            requestId: 'r',
            statusCode: 401,
          },
        };
      }
      return { status: 404 };
    });
    const tokensStore = createMemoryTokenStore();
    const utils = render(
      <SessionProvider api={makeApi(tokensStore)} tokens={tokensStore}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
    await act(async () => {
      await probeBox.value!.actions.login({ email: 'a@b.c', password: 'x' });
    });
    expect(probeBox.value?.lastError).toBe('Giriş bilgileri hatalı');
    utils.unmount();
  });

  it('logout: refresh token sunucuya iletilir ve yerel temizlenir (cache temizliği onSignedOut)', async () => {
    const logoutBodies: unknown[] = [];
    stubFetch((url, init) => {
      if (url.endsWith('/auth/logout')) {
        logoutBodies.push(JSON.parse(init.body as string));
        return { status: 204 };
      }
      if (url.endsWith('/auth/login')) return LOGIN_OK;
      return { status: 404 };
    });
    const tokensStore = createMemoryTokenStore();
    const cacheCleared = { value: false };
    const utils = render(
      <SessionProvider
        api={makeApi(tokensStore)}
        tokens={tokensStore}
        onSignedOut={() => {
          cacheCleared.value = true;
        }}
      >
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
    await act(async () => {
      await probeBox.value!.actions.login({ email: 'a@b.c', password: 'x' });
    });
    expect(probeBox.value?.status).toBe('signed-in');
    await act(async () => {
      await probeBox.value!.actions.logout();
    });
    expect(probeBox.value?.status).toBe('signed-out');
    expect(logoutBodies).toEqual([{ refreshToken: 'ref1' }]);
    expect(await tokensStore.getRefreshToken()).toBeNull();
    expect(cacheCleared.value).toBe(true);
    utils.unmount();
  });
});
