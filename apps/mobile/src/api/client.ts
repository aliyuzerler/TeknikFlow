import {
  ApiErrorEnvelopeSchema,
  LoginMobileResponseSchema,
  LoginSelectionResponseSchema,
  MeResponseSchema,
  RefreshResponseSchema,
  SessionListResponseSchema,
  WorkOrderListResponseSchema,
  WorkOrderViewSchema,
  type ApiErrorEnvelope,
  type LoginMobileResponse,
  type LoginSelectionResponse,
  type MeResponse,
  type RefreshResponse,
  type SessionListResponse,
  type WorkOrderListQuery,
  type WorkOrderListResponse,
  type WorkOrderView,
} from '@teknikflow/contracts';
import { z } from 'zod';
import type { SecureTokenStore } from '../session/token-store';

/**
 * Faz 07 — mobil API istemcisi.
 *
 * Tek sorumlu: HTTP detaylarını (bearer başlığı, 401 → refresh → tek
 * tekrar, hata zarfı çözümleme) uygulama katmanından soyutlamak.
 * Zaman aşımı AbortController ile; ağ hatası/HTTP/şema ayrımı tip güvenli.
 */

export type ApiError =
  | { kind: 'network'; message: string }
  | { kind: 'timeout'; message: string }
  | {
      kind: 'http';
      message: string;
      statusCode: number;
      code?: string;
      fieldErrors?: ApiErrorEnvelope['fieldErrors'];
    }
  | { kind: 'contract'; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface MobileApiClientOptions {
  baseUrl: string;
  tokens: SecureTokenStore;
  /** Refresh tamamen geçersiz olduğunda çağrılır (oturum kapatabilir). */
  onAuthLost?: () => void;
  timeoutMs?: number;
}

export interface MobileApiClient {
  request<T>(opts: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
    auth?: boolean;
    parser: z.ZodType<T>;
    /** İstek başına yeniden deneme hakkı (401 sonrası refresh için). */
    allowAuthRetry?: boolean;
  }): Promise<ApiResult<T>>;
  login(input: {
    email: string;
    password: string;
    tenantSlug?: string;
  }): Promise<ApiResult<LoginMobileResponse | LoginSelectionResponse>>;
  me(): Promise<ApiResult<MeResponse>>;
  refresh(refreshToken: string): Promise<ApiResult<RefreshResponse>>;
  logout(refreshToken: string): Promise<ApiResult<null>>;
  listSessions(): Promise<ApiResult<SessionListResponse>>;
  revokeSession(id: string): Promise<ApiResult<{ revoked: boolean }>>;
  revokeAllSessions(): Promise<ApiResult<{ revoked: number }>>;
  listWorkOrders(query?: Partial<WorkOrderListQuery>): Promise<ApiResult<WorkOrderListResponse>>;
  getWorkOrder(id: string): Promise<ApiResult<WorkOrderView>>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Mobil mutasyonlar/refresh — kimlik doğrulama sonrası erişim tokenı taşır. */
function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = new URL(`${cleanBase}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function createMobileApiClient(options: MobileApiClientOptions): MobileApiClient {
  const { baseUrl, tokens, onAuthLost, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  async function rawRequest(args: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
    accessToken?: string | null;
  }): Promise<{ httpStatus: number; json: unknown } | { failure: ApiError }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(buildUrl(baseUrl, args.path, args.query), {
        method: args.method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(args.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(args.accessToken ? { Authorization: `Bearer ${args.accessToken}` } : {}),
        },
        body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
      });
      let json: unknown = null;
      const text = await response.text();
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = { raw: text.slice(0, 200) };
        }
      }
      return { httpStatus: response.status, json };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { failure: { kind: 'timeout', message: 'İstek zaman aşımına uğradı' } };
      }
      return {
        failure: {
          kind: 'network',
          message: error instanceof Error ? error.message : 'Ağ hatası',
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function parseHttpFailure(httpStatus: number, json: unknown): ApiError {
    const envelope = ApiErrorEnvelopeSchema.safeParse(json);
    if (envelope.success) {
      return {
        kind: 'http',
        message: envelope.data.message,
        statusCode: httpStatus,
        code: envelope.data.code,
        ...(envelope.data.fieldErrors ? { fieldErrors: envelope.data.fieldErrors } : {}),
      };
    }
    return { kind: 'http', message: 'Beklenmeyen sunucu yanıtı', statusCode: httpStatus };
  }

  async function refreshAccessToken(): Promise<boolean> {
    const refreshToken = await tokens.getRefreshToken();
    if (!refreshToken) return false;
    const response = await rawRequest({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken },
    });
    if ('failure' in response) return false;
    if (response.httpStatus !== 200) return false;
    const parsed = RefreshResponseSchema.safeParse(response.json);
    if (!parsed.success) return false;
    await tokens.saveTokens({
      accessToken: parsed.data.accessToken,
      accessTokenExpiresAt: parsed.data.accessTokenExpiresAt,
      refreshToken: parsed.data.refreshToken,
      refreshTokenExpiresAt: parsed.data.refreshTokenExpiresAt,
    });
    return true;
  }

  const client: MobileApiClient = {
    async request({ method, path, body, query, auth = true, parser, allowAuthRetry = true }) {
      let accessToken = auth ? await tokens.getAccessToken() : null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await rawRequest({ method, path, body, query, accessToken });
        if ('failure' in response) return { ok: false, error: response.failure };

        if (response.httpStatus >= 200 && response.httpStatus < 300) {
          const parsed = parser.safeParse(response.json);
          if (!parsed.success) {
            return {
              ok: false,
              error: { kind: 'contract', message: 'Sunucu yanıtı sözleşmeyle uyuşmuyor' },
            };
          }
          return { ok: true, data: parsed.data };
        }

        if (response.httpStatus === 401 && auth && allowAuthRetry && attempt === 0) {
          const refreshed = await refreshAccessToken();
          if (!refreshed) {
            onAuthLost?.();
            return { ok: false, error: parseHttpFailure(401, response.json) };
          }
          accessToken = await tokens.getAccessToken();
          continue;
        }

        return { ok: false, error: parseHttpFailure(response.httpStatus, response.json) };
      }
      // Ulaşılamaz koruma: döngü her yolda döner.
      return { ok: false, error: { kind: 'network', message: 'İstek tamamlanamadı' } };
    },

    async login(input) {
      const response = await rawRequest({
        method: 'POST',
        path: '/api/v1/auth/login',
        body: {
          email: input.email,
          password: input.password,
          client: 'mobile',
          ...(input.tenantSlug ? { tenantSlug: input.tenantSlug } : {}),
        },
      });
      if ('failure' in response) return { ok: false, error: response.failure };
      if (response.httpStatus !== 200) {
        return { ok: false, error: parseHttpFailure(response.httpStatus, response.json) };
      }
      // Çoklu üyelik seçimi ya da token yanıtı — birlik şemayla ayrıştır.
      const selection = LoginSelectionResponseSchema.safeParse(response.json);
      if (selection.success) return { ok: true, data: selection.data };
      const tokensParsed = LoginMobileResponseSchema.safeParse(response.json);
      if (tokensParsed.success) return { ok: true, data: tokensParsed.data };
      return {
        ok: false,
        error: { kind: 'contract', message: 'Giriş yanıtı sözleşmeyle uyuşmuyor' },
      };
    },

    async me() {
      return client.request({
        method: 'GET',
        path: '/api/v1/auth/me',
        parser: MeResponseSchema,
      });
    },

    async refresh(refreshToken) {
      const response = await rawRequest({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        body: { refreshToken },
      });
      if ('failure' in response) return { ok: false, error: response.failure };
      if (response.httpStatus !== 200) {
        return { ok: false, error: parseHttpFailure(response.httpStatus, response.json) };
      }
      const parsed = RefreshResponseSchema.safeParse(response.json);
      if (!parsed.success) {
        return { ok: false, error: { kind: 'contract', message: 'Yenileme yanıtı geçersiz' } };
      }
      return { ok: true, data: parsed.data };
    },

    async logout(refreshToken) {
      const result = await client.request({
        method: 'POST',
        path: '/api/v1/auth/logout',
        body: { refreshToken },
        auth: true,
        // Logout'ta otomatik refresh döngüsü anlamsız — doğrudan sonucu al.
        allowAuthRetry: false,
        parser: z.null(),
      });
      return result as ApiResult<null>;
    },

    async listSessions() {
      return client.request({
        method: 'GET',
        path: '/api/v1/auth/sessions',
        parser: SessionListResponseSchema,
      });
    },

    async revokeSession(id) {
      return client.request({
        method: 'DELETE',
        path: `/api/v1/auth/sessions/${id}`,
        parser: z.object({ revoked: z.boolean() }),
      });
    },

    async revokeAllSessions() {
      return client.request({
        method: 'POST',
        path: '/api/v1/auth/sessions/revoke-all',
        parser: z.object({ revoked: z.number() }),
      });
    },

    async listWorkOrders(query) {
      const q: Record<string, string | undefined> = {
        ...(query?.status ? { status: query.status } : {}),
        ...(query?.q ? { q: query.q } : {}),
        page: query?.page ? String(query.page) : '1',
        pageSize: query?.pageSize ? String(query.pageSize) : '20',
        // Teknisyen gelen kutusu: YALNIZ atanmış işler (sunucu da rol bazlı
        // kısıtlar — view_all olmayan kullanıcı listede yalnız kendi işini görür).
        mine: 'true',
      };
      return client.request({
        method: 'GET',
        path: '/api/v1/work-orders',
        query: q,
        parser: WorkOrderListResponseSchema,
      });
    },

    async getWorkOrder(id) {
      return client.request({
        method: 'GET',
        path: `/api/v1/work-orders/${id}`,
        parser: WorkOrderViewSchema,
      });
    },
  };

  return client;
}
