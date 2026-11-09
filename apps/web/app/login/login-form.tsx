'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { AuthForm, type AuthFormOutcome } from '@/src/components/auth-form';
import { login } from '@teknikflow/api-client';
import { getClientApiBaseUrl } from '@/src/lib/client-env';

/**
 * Faz 03 — login formu (client).
 * Çerezler API tarafından Set-Cookie ile yazılır; istemci token GÖRMEZ.
 * Çoklu üyelik → seçim listesi → slug ile tekrar login.
 */
export function LoginForm({ preselectedSlug }: { preselectedSlug?: string }) {
  const router = useRouter();
  const apiBaseUrl = getClientApiBaseUrl();
  const [workspaces, setWorkspaces] = useState<
    Array<{ tenantSlug: string; tenantName: string; roleName: string }>
  >([]);
  // Seçim adımında yeniden login için son kimlik (yalnız bilekte).
  const lastCredentials = useRef<{ email: string; password: string }>({ email: '', password: '' });

  async function doLogin(
    email: string,
    password: string,
    tenantSlug?: string,
  ): Promise<AuthFormOutcome> {
    const result = await login({ baseUrl: apiBaseUrl }, { email, password, tenantSlug });
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.error.httpStatus === 429
            ? 'Çok fazla deneme — bir süre sonra tekrar deneyin'
            : result.error.message,
      };
    }
    if ('selectionRequired' in result.data && result.data.selectionRequired) {
      setWorkspaces(
        result.data.workspaces.map((w) => ({
          tenantSlug: w.tenantSlug,
          tenantName: w.tenantName,
          roleName: w.roleName,
        })),
      );
      return { ok: true };
    }
    router.push('/app/overview');
    router.refresh();
    return { ok: true };
  }

  if (workspaces.length > 0) {
    return (
      <AuthForm
        mode="login"
        title="Çalışma alanı seçin"
        submitLabel="Giriş yap"
        workspaces={workspaces}
        onSelectWorkspace={(slug) => {
          void doLogin(lastCredentials.current.email, lastCredentials.current.password, slug);
        }}
        footer={
          <button type="button" className="auth-link" onClick={() => setWorkspaces([])}>
            Farklı hesapla giriş yap
          </button>
        }
      />
    );
  }

  return (
    <AuthForm
      mode="login"
      title="TeknikFlow'a giriş"
      subtitle="Saha servis operasyonlarınızı yönetin."
      submitLabel="Giriş yap"
      onSubmit={async (values) => {
        lastCredentials.current = { email: values.email, password: values.password };
        return doLogin(values.email, values.password, preselectedSlug);
      }}
      footer={
        <span className="auth-footer__text">
          Hesabınız yok mu? <Link href="/signup">Kiracı kaydı oluşturun</Link>
        </span>
      }
    />
  );
}
