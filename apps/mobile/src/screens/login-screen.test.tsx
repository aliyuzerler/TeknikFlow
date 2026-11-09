import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { createMobileApiClient, type MobileApiClient } from '../api/client';
import { createMemoryTokenStore } from '../session/token-store';
import { SessionProvider, useSession } from '../session/session-context';
import { LoginScreen } from './login-screen';
import { act } from 'react';

/**
 * Faz 07 — giriş ekranı RNTL testleri: alanlar, gönderim, hata gösterimi,
 * çalışma alanı seçimi, gönderim sırasında düğme kapalı.
 */

const probeBox: { value: ReturnType<typeof useSession> | null } = { value: null };
function SessionProbe(): null {
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

function makeApi(): MobileApiClient {
  return createMobileApiClient({ baseUrl: 'http://api.test', tokens: createMemoryTokenStore() });
}

function renderLogin() {
  return render(
    <SessionProvider api={makeApi()} tokens={createMemoryTokenStore()}>
      <LoginScreen />
      <SessionProbe />
    </SessionProvider>,
  );
}

describe('LoginScreen', () => {
  it('alanlar ve düğme görünür; boş alanlarla düğme kapalı', () => {
    const utils = renderLogin();
    expect(utils.getByLabelText('E-posta')).toBeTruthy();
    expect(utils.getByLabelText('Parola')).toBeTruthy();
    const submit = utils.getByLabelText('Giriş yap');
    expect(submit.props.accessibilityState?.disabled ?? submit.props.disabled).toBeTruthy();
  });

  it('hatalı giriş → hata kutusu görünür ve genel mesaj sunucudan gelir', async () => {
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
    const utils = renderLogin();
    fireEvent.changeText(utils.getByLabelText('E-posta'), 'tech@atlas.example.test');
    fireEvent.changeText(utils.getByLabelText('Parola'), 'yanlis');
    fireEvent.press(utils.getByLabelText('Giriş yap'));
    await waitFor(() => expect(utils.getByTestId('login-error')).toBeTruthy());
    expect(utils.getByText('Giriş bilgileri hatalı')).toBeTruthy();
  });

  it('başarılı giriş → ekran durumdan signed-in görünür (hata kutusu yok)', async () => {
    stubFetch((url) => {
      if (url.endsWith('/auth/login')) return LOGIN_OK;
      return { status: 404 };
    });
    const utils = renderLogin();
    fireEvent.changeText(utils.getByLabelText('E-posta'), 'tech@atlas.example.test');
    fireEvent.changeText(utils.getByLabelText('Parola'), 'Atlas!2026');
    fireEvent.press(utils.getByLabelText('Giriş yap'));
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-in'));
    expect(utils.queryByTestId('login-error')).toBeNull();
  });

  it('çoklu üyelik → çalışma alanı seçimi listelenir ve seçimle giriş tamamlanır', async () => {
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
                  tenantName: 'Beta Teknik',
                  tenantSlug: 'beta',
                  roleKey: 'technician',
                  roleName: 'Teknisyen',
                },
              ],
            },
          };
        }
        return LOGIN_OK;
      }
      return { status: 404 };
    });
    const utils = renderLogin();
    fireEvent.changeText(utils.getByLabelText('E-posta'), 'tech@atlas.example.test');
    fireEvent.changeText(utils.getByLabelText('Parola'), 'x');
    fireEvent.press(utils.getByLabelText('Giriş yap'));
    await waitFor(() => expect(utils.getByText('Çalışma alanı seçin')).toBeTruthy());
    expect(utils.getByText('Atlas')).toBeTruthy();
    expect(utils.getByText('Beta Teknik')).toBeTruthy();
    await act(async () => {
      fireEvent.press(utils.getByLabelText('Atlas alanına gir'));
    });
    await waitFor(() => expect(probeBox.value?.status).toBe('signed-in'));
  });
});
