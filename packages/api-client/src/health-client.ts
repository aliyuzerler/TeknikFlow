import {
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  type HealthLiveResponse,
  type HealthReadyResponse,
} from '@teknikflow/contracts';

export type ApiClientResult<T> = { ok: true; data: T } | { ok: false; error: ApiClientError };

export type ApiClientErrorKind = 'network-error' | 'timeout' | 'http-error' | 'contract-mismatch';

export interface ApiClientError {
  kind: ApiClientErrorKind;
  /** Güvenli, sır içermeyen özet. */
  message: string;
  httpStatus?: number;
}

const DEFAULT_TIMEOUT_MS = 2500;

/** GET /health/live */
export async function fetchHealthLive(
  baseUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ApiClientResult<HealthLiveResponse>> {
  return request(HealthLiveResponseSchema, joinUrl(baseUrl, '/health/live'), timeoutMs);
}

/** GET /health/ready */
export async function fetchHealthReady(
  baseUrl: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ApiClientResult<HealthReadyResponse>> {
  return request(HealthReadyResponseSchema, joinUrl(baseUrl, '/health/ready'), timeoutMs);
}

/** safeParse imzasını taşıyan şema (Zod şemaları buna uyar). */
interface SafeParseable<T> {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

async function request<T>(
  schema: SafeParseable<T>,
  url: string,
  timeoutMs: number,
): Promise<ApiClientResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
      cache: 'no-store',
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
    return {
      ok: false,
      error: {
        kind: 'http-error',
        message: `HTTP ${response.status}`,
        httpStatus: response.status,
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: { kind: 'contract-mismatch', message: 'Yanıt JSON değil' } };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: 'contract-mismatch', message: 'Yanıt API sözleşmesine uymuyor' },
    };
  }
  return { ok: true, data: parsed.data };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}
