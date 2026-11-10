import type { ApiError, ApiResult, AuthRequestContext } from './auth-client.js';
import {
  CaptureSignatureRequestSchema,
  ChecklistItemViewSchema,
  ChecklistListResponseSchema,
  CompleteChecklistItemRequestSchema,
  CreateChecklistItemRequestSchema,
  CreateTimeEntryRequestSchema,
  EXECUTION_IDEMPOTENCY_HEADER,
  ExecutionReportViewSchema,
  InitMediaUploadRequestSchema,
  InitMediaUploadResponseSchema,
  MediaListResponseSchema,
  MediaObjectViewSchema,
  SignatureListResponseSchema,
  SignatureViewSchema,
  StopTimeEntryRequestSchema,
  TimeEntryListResponseSchema,
  TimeEntryViewSchema,
  type CaptureSignatureRequest,
  type ChecklistItemView,
  type CompleteChecklistItemRequest,
  type CreateChecklistItemRequest,
  type CreateTimeEntryRequest,
  type ExecutionReportView,
  type InitMediaUploadRequest,
  type InitMediaUploadResponse,
  type MediaObjectView,
  type SignatureView,
  type StopTimeEntryRequest,
  type TimeEntryView,
} from '@teknikflow/contracts';

/**
 * Faz 08 — saha yürütme istemcisi: checklist, süre kayıtları, medya (iki
 * adımlı), imza ve yürütme raporu.
 *
 * Mutasyonlar opsiyonel idempotency anahtarı taşır (mobil outbox'tan
 * UUID): sunucu tekrarı saklanan kanonik yanıtı oynatır. Yanıt başlığı
 * x-idempotent-replay sonuç üzerine replayed olarak iletilir.
 */

type ParseOutcome<T> = { success: true; data: T } | { success: false };

export { type ApiResult, type ApiError, type AuthRequestContext };

/** Faz 08 hata zarfı: kanıt eksikliği ve kapı bağlamı alanları. */
export interface ExecutionApiError extends ApiError {
  /** 409 EVIDENCE_MISSING — eksik zorunlu checklist maddeleri. */
  missing?: Array<{ itemId: string; label: string }>;
  /** Kapı bağlamı (gate/signatureCount) ve diğer güvenli ayrıntılar. */
  details?: Record<string, string | number>;
}

export type ExecutionMutationResult<T> =
  | { ok: true; data: T; replayed?: boolean }
  | { ok: false; error: ExecutionApiError; replayed?: boolean };

async function executionRequest<T>(
  ctx: AuthRequestContext,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown | undefined,
  parse: (data: unknown) => ParseOutcome<T>,
  extraHeaders?: Record<string, string>,
): Promise<ExecutionMutationResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ctx.cookieHeader) headers.cookie = ctx.cookieHeader;
  if (ctx.bearerToken) headers.authorization = `Bearer ${ctx.bearerToken}`;
  if (ctx.csrfToken) headers['x-csrf-token'] = ctx.csrfToken;
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    headers[key] = value;
  }

  let response: Response;
  try {
    response = await fetch(joinUrl(ctx.baseUrl, path), {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers,
      cache: 'no-store',
      credentials: 'include',
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 8000),
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

  const replayed = response.headers.get('x-idempotent-replay') === 'true';

  if (!response.ok) {
    const envelope = await safeJson(response);
    const missing = Array.isArray(envelope.missing)
      ? (envelope.missing as Array<{ itemId: string; label: string }>)
      : undefined;
    return {
      ok: false,
      replayed,
      error: {
        kind: 'http-error',
        message: envelope.message ?? `HTTP ${response.status}`,
        httpStatus: response.status,
        code: envelope.code,
        ...(missing ? { missing } : {}),
        ...(envelope.details
          ? { details: envelope.details as Record<string, string | number> }
          : {}),
      },
    };
  }

  const jsonBody: unknown = await safeJson(response);
  const parsed = parse(jsonBody);
  if (!parsed.success) {
    return {
      ok: false,
      replayed,
      error: { kind: 'contract-mismatch', message: 'Yanıt API sözleşmesine uymuyor' },
    };
  }
  return { ok: true, replayed, data: parsed.data };
}

async function safeJson(
  response: Response,
): Promise<
  { message?: string; code?: string; missing?: unknown; details?: unknown } & Record<
    string,
    unknown
  >
> {
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

interface SafeParseLike<T> {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

function parseWith<T>(schema: SafeParseLike<T>, data: unknown): ParseOutcome<T> {
  const result = schema.safeParse(data);
  return result.success ? { success: true as const, data: result.data } : { success: false };
}

function parseInput<T>(
  schema: SafeParseLike<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; result: ExecutionMutationResult<never> } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    result: {
      ok: false,
      error: { kind: 'contract-mismatch', message: 'İstek gövdesi doğrulamadan geçemedi' },
    },
  };
}

function idempotencyHeader(idempotencyKey?: string): Record<string, string> | undefined {
  return idempotencyKey ? { [EXECUTION_IDEMPOTENCY_HEADER]: idempotencyKey } : undefined;
}

// ------------------------- Checklist -------------------------

export async function addChecklistItem(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: CreateChecklistItemRequest,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<ChecklistItemView>> {
  const parsedInput = parseInput(CreateChecklistItemRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return executionRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/checklist-items`,
    parsedInput.data,
    (data) => parseWith(ChecklistItemViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function completeChecklistItem(
  ctx: AuthRequestContext,
  workOrderId: string,
  itemId: string,
  input: CompleteChecklistItemRequest,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<ChecklistItemView>> {
  const parsedInput = parseInput(CompleteChecklistItemRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return executionRequest(
    ctx,
    'PATCH',
    `/api/v1/work-orders/${workOrderId}/checklist-items/${itemId}`,
    parsedInput.data,
    (data) => parseWith(ChecklistItemViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listChecklistItems(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<ApiResult<ChecklistItemView[]>> {
  const result = await executionRequest(
    ctx,
    'GET',
    `/api/v1/work-orders/${workOrderId}/checklist-items`,
    undefined,
    (data) => parseWith(ChecklistListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

// ------------------------- Süre kayıtları -------------------------

export async function createTimeEntry(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: CreateTimeEntryRequest,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<TimeEntryView>> {
  const parsedInput = parseInput(CreateTimeEntryRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return executionRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/time-entries`,
    parsedInput.data,
    (data) => parseWith(TimeEntryViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function stopTimeEntry(
  ctx: AuthRequestContext,
  workOrderId: string,
  timeEntryId: string,
  input: StopTimeEntryRequest,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<TimeEntryView>> {
  const parsedInput = parseInput(StopTimeEntryRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return executionRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/time-entries/${timeEntryId}/stop`,
    parsedInput.data,
    (data) => parseWith(TimeEntryViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listTimeEntries(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<ApiResult<TimeEntryView[]>> {
  const result = await executionRequest(
    ctx,
    'GET',
    `/api/v1/work-orders/${workOrderId}/time-entries`,
    undefined,
    (data) => parseWith(TimeEntryListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

// ------------------------- Medya (ADR-0005) -------------------------

export async function initMediaUpload(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: InitMediaUploadRequest,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<InitMediaUploadResponse>> {
  const parsedInput = parseInput(InitMediaUploadRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return executionRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/media`,
    parsedInput.data,
    (data) => parseWith(InitMediaUploadResponseSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

/** İkili yükleme — imzalı PUT URL'sine doğrudan (API gövdesinden geçmez). */
export async function uploadMediaBytes(
  uploadUrl: string,
  contentType: string,
  bytes: Blob | ArrayBuffer | Uint8Array,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    let body: Blob | ArrayBuffer;
    if (bytes instanceof Blob) {
      body = bytes;
    } else if (bytes instanceof ArrayBuffer) {
      body = bytes;
    } else {
      // Uint8Array → saf ArrayBuffer kopyası (SharedArrayBuffer riski yok).
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      body = copy;
    }
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body,
    });
    if (!response.ok) {
      return { ok: false, message: `Yükleme başarısız (HTTP ${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Yükleme başarısız',
    };
  }
}

export async function completeMediaUpload(
  ctx: AuthRequestContext,
  workOrderId: string,
  mediaId: string,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<MediaObjectView>> {
  return executionRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/media/${mediaId}/complete`,
    {},
    (data) => parseWith(MediaObjectViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listWorkOrderMedia(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<ApiResult<MediaObjectView[]>> {
  const result = await executionRequest(
    ctx,
    'GET',
    `/api/v1/work-orders/${workOrderId}/media`,
    undefined,
    (data) => parseWith(MediaListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

// ------------------------- İmza -------------------------

export async function captureSignature(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: CaptureSignatureRequest,
  idempotencyKey?: string,
): Promise<ExecutionMutationResult<SignatureView>> {
  const parsedInput = parseInput(CaptureSignatureRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return executionRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/signatures`,
    parsedInput.data,
    (data) => parseWith(SignatureViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listWorkOrderSignatures(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<ApiResult<SignatureView[]>> {
  const result = await executionRequest(
    ctx,
    'GET',
    `/api/v1/work-orders/${workOrderId}/signatures`,
    undefined,
    (data) => parseWith(SignatureListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

// ------------------------- Rapor -------------------------

export async function fetchExecutionReport(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<ApiResult<ExecutionReportView>> {
  return executionRequest(
    ctx,
    'GET',
    `/api/v1/work-orders/${workOrderId}/report`,
    undefined,
    (data) => parseWith(ExecutionReportViewSchema, data),
  );
}
