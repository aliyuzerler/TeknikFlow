import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { act } from 'react';
import { Alert } from 'react-native';
import { createMobileApiClient, type MobileApiClient } from '../api/client';
import { createMemoryTokenStore } from '../session/token-store';
import { SessionProvider, useSession } from '../session/session-context';
import { AccountScreen } from './account-screen';

/**
 * Faz 07 — hesap ekranı RNTL testleri: oturum listesi (WEB + MOBILE),
 * revoke-all onayı → forceSignOut, çıkış onayı → logout.
 */

const probeBox: { value: ReturnType<typeof useSession> | null } = { value: null };
function SessionProbe(): null {
  const value = useSession();
  probeBox.value = value;
  return null;
}

function stubFetch(handler: (url: string) => { status: number; body?: unknown }): void {
  global.fetch = jest.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const response = handler(url);
    return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const LOGIN_OK = {
  status: 200,
  body: {
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
    permissions: [],
    accessToken: 'acc',
    accessTokenExpiresAt: new Date().toISOString(),
    refreshToken: 'ref',
    refreshTokenExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
  },
};

const SESSIONS = {
  status: 200,
  body: {
    data: [
      {
        sessionId: '99999999-9999-4999-8999-999999999999',
        kind: 'MOBILE',
        createdAt: '2026-11-09T08:00:00.000Z',
        lastUsedAt: '2026-11-09T09:00:00.000Z',
        expiresAt: '2026-12-09T08:00:00.000Z',
        revokedAt: null,
        current: true,
        createdIp: '10.0.2.2',
        userAgent: 'TeknikFlow/1.0',
      },
      {
        sessionId: '88888888-8888-4888-8888-888888888888',
        kind: 'WEB',
        createdAt: '2026-11-08T08:00:00.000Z',
        lastUsedAt: '2026-11-08T17:00:00.000Z',
        expiresAt: '2026-11-20T08:00:00.000Z',
        revokedAt: null,
        current: false,
        createdIp: '192.168.1.10',
        userAgent: 'Chrome',
      },
    ],
  },
};

function makeApi(): MobileApiClient {
  return createMobileApiClient({ baseUrl: 'http://api.test', tokens: createMemoryTokenStore() });
}

async function renderAccount(fetchHandler: (url: string) => { status: number; body?: unknown }) {
  stubFetch(fetchHandler);
  const tokensStore = createMemoryTokenStore();
  const utils = render(
    <SessionProvider api={makeApi()} tokens={tokensStore}>
      <AccountScreen api={makeApi()} />
      <SessionProbe />
    </SessionProvider>,
  );
  await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
  await act(async () => {
    await probeBox.value!.actions.login({ email: 'tech@atlas.example.test', password: 'x' });
  });
  await waitFor(() => expect(probeBox.value?.status).toBe('signed-in'));
  return { utils, tokensStore };
}

describe('AccountScreen', () => {
  it('kimlik + oturum listesi (WEB ve MOBILE) görünür; bu cihaz işaretli', async () => {
    const { utils } = await renderAccount((url) => {
      if (url.endsWith('/auth/sessions')) return SESSIONS;
      if (url.endsWith('/auth/login')) return LOGIN_OK;
      return { status: 404 };
    });
    await waitFor(() => expect(utils.getByText('Ahmet')).toBeTruthy());
    expect(utils.getByText('Atlas · technician')).toBeTruthy();
    await waitFor(() => expect(utils.getByTestId('account-session-MOBILE')).toBeTruthy());
    expect(utils.getByTestId('account-session-WEB')).toBeTruthy();
    expect(utils.getByText(/bu cihaz/)).toBeTruthy();
  });

  it('revoke-all onayla → forceSignOut; onayla seçilmezse oturum sürer', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    const revokeCalls: string[] = [];
    const { utils, tokensStore } = await renderAccount((url) => {
      if (url.endsWith('/sessions/revoke-all')) {
        revokeCalls.push(url);
        return { status: 200, body: { revoked: 2 } };
      }
      if (url.endsWith('/auth/sessions')) return SESSIONS;
      if (url.endsWith('/auth/login')) return LOGIN_OK;
      return { status: 404 };
    });
    await waitFor(() => expect(utils.getByTestId('account-revoke-all')).toBeTruthy());
    fireEvent.press(utils.getByTestId('account-revoke-all'));
    await waitFor(() => expect(revokeCalls).toHaveLength(1));
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
    expect(await tokensStore.getRefreshToken()).toBeNull();
    alertSpy.mockRestore();
  });

  it('çıkış onayı → logout ve yerel temizlik', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find((b) => b.style === 'destructive');
      destructive?.onPress?.();
    });
    const logoutBodies: unknown[] = [];
    const { utils, tokensStore } = await renderAccount((url) => {
      if (url.endsWith('/auth/logout')) {
        logoutBodies.push(url);
        return { status: 204 };
      }
      if (url.endsWith('/auth/sessions')) return SESSIONS;
      if (url.endsWith('/auth/login')) return LOGIN_OK;
      return { status: 404 };
    });
    await waitFor(() => expect(utils.getByTestId('account-signout')).toBeTruthy());
    fireEvent.press(utils.getByTestId('account-signout'));
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-out'));
    expect(logoutBodies.length).toBeGreaterThan(0);
    expect(await tokensStore.getRefreshToken()).toBeNull();
    alertSpy.mockRestore();
  });
});
