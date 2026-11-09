import { cookies } from 'next/headers';
import { fetchMe } from '@teknikflow/api-client';
import type { MeResponse } from '@teknikflow/contracts';
import { getWebEnv } from '../load-env';

/**
 * Faz 03 — sunucu tarafı oturum çözümlemesi.
 *
 * Oturum çerezleri Next.js sunucusundan API'ye iletilir; kimlik/tenant
 * bağlamı DAİMA API tarafından üyelikten türetilir (ADR-0003) — istemciye
 * güvenilmez. 401/403 → null (çağıran /login'e yönlendirir).
 */
export interface WebSession extends MeResponse {
  csrfToken?: string;
}

export async function getSession(): Promise<WebSession | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get('tf_session')?.value;
  if (!session) return null;

  const csrf = cookieStore.get('tf_csrf')?.value;
  const cookieHeader = csrf ? `tf_session=${session}; tf_csrf=${csrf}` : `tf_session=${session}`;

  const { apiBaseUrl } = getWebEnv();
  const result = await fetchMe({
    baseUrl: apiBaseUrl,
    cookieHeader,
    timeoutMs: 10_000,
  });
  if (!result.ok) return null;
  return { ...result.data, csrfToken: csrf };
}

/** API'ye sunucu tarafı istek gönderirken kullanılacak çerez başlığı. */
export async function apiCookieHeader(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const session = cookieStore.get('tf_session')?.value;
  if (!session) return undefined;
  const csrf = cookieStore.get('tf_csrf')?.value;
  return csrf ? `tf_session=${session}; tf_csrf=${csrf}` : `tf_session=${session}`;
}

/** API mutasyonları için CSRF başlık değeri (çift-gönderim). */
export async function apiCsrfToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get('tf_csrf')?.value;
}
