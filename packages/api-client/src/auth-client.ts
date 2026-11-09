import type {
  LoginMobileResponse,
  LoginSelectionResponse,
  LoginWebResponse,
  MeResponse,
  SignupResponse,
} from '@teknikflow/contracts';
import { LoginSelectionResponseSchema, MeResponseSchema } from '@teknikflow/contracts';

/**
 * Faz 03 — kimlik istemcisi.
 *
 * Web (Next.js sunucu bileşenleri): çerezler çağıran tarafından iletilir
 * (`cookieHeader`) — istemci çerez depolamaz. Mutasyonlarda CSRF başlığı
 * gereklidir. Mobil istemci (Faz 07) token tabanlı akışı kendi tarafında
 * yönetecek; buradaki tipler sözleşmeyi paylaşır.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface ApiError {
  kind: 'network-error' | 'timeout' | 'http-error' | 'contract-mismatch';
  message: string;
  httpStatus?: number;
  /** API hata zarfından kod (INVALID_CREDENTIALS, RATE_LIMITED...). */
  code?: string;
}

export interface AuthRequestContext {
  baseUrl: string;
  timeoutMs?: number;
  /** Web: iletilen çerezler ("tf_session=...; tf_csrf=..."). */
  cookieHeader?: string;
  /** Web mutasyonları: x-csrf-token değeri (tf_csrf çereziyle aynı). */
  csrfToken?: string;
  /** Mobil: Authorization: Bearer <token>. */
  bearerToken?: string;
}

/** POST /api/v1/auth/login (web). */
export async function login(
  ctx: AuthRequestContext,
  input: { email: string; password: string; tenantSlug?: string },
): Promise<ApiResult<LoginWebResponse | LoginSelectionResponse>> {
  return authRequest(
    ctx,
    '/api/v1/auth/login',
    {
      email: input.email,
      password: input.password,
      client: 'web',
      ...(input.tenantSlug ? { tenantSlug: input.tenantSlug } : {}),
    },
    unionParser,
  );
}

/** POST /api/v1/auth/signup (web). */
export async function signup(
  ctx: AuthRequestContext,
  input: {
    tenantName: string;
    timezone?: string;
    user: { displayName: string; email: string; password: string };
  },
): Promise<ApiResult<SignupResponse>> {
  // Signup yanıtı login yanıtının alt kümesi — esnek ayrıştırma.
  return authRequest<SignupResponse>(
    ctx,
    '/api/v1/auth/signup',
    { ...input, timezone: input.timezone ?? 'Europe/Istanbul' },
    (data) => ({ success: true as const, data: data as SignupResponse }),
  );
}

/** GET /api/v1/auth/me. */
export async function fetchMe(ctx: AuthRequestContext): Promise<ApiResult<MeResponse>> {
  return authRequest(ctx, '/api/v1/auth/me', undefined, (data) => MeResponseSchema.safeParse(data));
}

/** POST /api/v1/auth/logout. */
export async function logout(ctx: AuthRequestContext): Promise<ApiResult<{ ok: true }>> {
  const result = await authRequest(ctx, '/api/v1/auth/logout', {}, () => ({
    success: true as const,
    data: { ok: true as const },
  }));
  // 204 boş gövde: başarılı say.
  if (!result.ok && result.error.httpStatus === 204) {
    return { ok: true, data: { ok: true as const } };
  }
  return result as ApiResult<{ ok: true }>;
}

function unionParser(data: unknown): ParseOutcome<LoginWebResponse | LoginSelectionResponse> {
  const selection = LoginSelectionResponseSchema.safeParse(data);
  if (selection.success) return { success: true as const, data: selection.data };
  return { success: true as const, data: data as LoginWebResponse };
}

type ParseOutcome<T> = { success: true; data: T } | { success: false };

async function authRequest<T>(
  ctx: AuthRequestContext,
  path: string,
  body: unknown | undefined,
  parse: (data: unknown) => ParseOutcome<T>,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ctx.cookieHeader) headers.cookie = ctx.cookieHeader;
  if (ctx.bearerToken) headers.authorization = `Bearer ${ctx.bearerToken}`;
  if (ctx.csrfToken) headers['x-csrf-token'] = ctx.csrfToken;

  let response: Response;
  try {
    response = await fetch(joinUrl(ctx.baseUrl, path), {
      method: body !== undefined ? 'POST' : 'GET',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers,
      cache: 'no-store',
      // Tarayıcıda Set-Cookie uygulanır (kimlik çerezleri API kökeninden);
      // Node'da (sunucu bileşenleri) cookieHeader elle iletilir.
      credentials: 'include',
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 5000),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      error: {
        kind: isTimeout ? 'timeout' : 'network-error',
        message: isTimeout ? 'İstek zaman aşımına uğradı' : 'Ağa ulaşılamadı',
      },
    };
  }

  if (!response.ok) {
    const envelope = await safeJson(response);
    return {
      ok: false,
      error: {
        kind: 'http-error',
        message: envelope.message ?? `HTTP ${response.status}`,
        httpStatus: response.status,
        code: envelope.code,
      },
    };
  }

  if (response.status === 204) {
    return { ok: false, error: { kind: 'http-error', message: 'No Content', httpStatus: 204 } };
  }

  const jsonBody: unknown = await safeJson(response);
  const parsed = parse(jsonBody);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: 'contract-mismatch', message: 'Yanıt API sözleşmesine uymuyor' },
    };
  }
  return { ok: true, data: parsed.data };
}

async function safeJson(
  response: Response,
): Promise<{ message?: string; code?: string } & Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

export type { LoginMobileResponse };
