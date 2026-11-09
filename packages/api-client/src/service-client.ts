import type { ApiError, ApiResult, AuthRequestContext } from './auth-client.js';
import {
  AssignableUserListResponseSchema,
  ConvertServiceRequestRequestSchema,
  CreateServiceRequestRequestSchema,
  ServiceCategoryListResponseSchema,
  ServiceRequestListResponseSchema,
  ServiceRequestViewSchema,
  SlaPolicyListResponseSchema,
  TransitionWorkOrderRequestSchema,
  WorkOrderListResponseSchema,
  WorkOrderDetailResponseSchema,
  WorkOrderNoteCreateSchema,
  WorkOrderNoteViewSchema,
  WorkOrderViewSchema,
  ConvertServiceRequestResponseSchema,
  type AssignableUserView,
  type CreateServiceRequestRequest,
  type CreateWorkOrderRequest,
  type ServiceCategoryView,
  type ServicePriority,
  type ServiceRequestListQuery,
  type ServiceRequestListResponse,
  type ServiceRequestView,
  type SlaPolicyView,
  type WorkOrderListQuery,
  type WorkOrderListResponse,
  type WorkOrderNoteView,
  type WorkOrderView,
} from '@teknikflow/contracts';

/**
 * Faz 05 — servis akışı istemcisi (talepler + iş emirleri).
 *
 * Web sunucu bileşenleri çerezleri çağırandan alır; mutasyonlar CSRF
 * başlığı ister (AuthRequestContext). Mobil istemci Faz 07'de bearer ile
 * aynı sözleşmeleri kullanır.
 */

type ParseOutcome<T> = { success: true; data: T } | { success: false };

export { type ApiResult, type ApiError, type AuthRequestContext };

import type { WorkOrderDetailResponse, ConvertServiceRequestResponse } from '@teknikflow/contracts';

async function serviceRequest<T>(
  ctx: AuthRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
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

function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

// ------------------------- Servis talepleri -------------------------

export async function listServiceRequests(
  ctx: AuthRequestContext,
  query: Partial<ServiceRequestListQuery> = {},
): Promise<ApiResult<ServiceRequestListResponse>> {
  return serviceRequest(
    ctx,
    'GET',
    `/api/v1/service-requests${queryString({ ...query })}`,
    undefined,
    (data) => parseWith(ServiceRequestListResponseSchema, data),
  );
}

export async function fetchServiceRequest(
  ctx: AuthRequestContext,
  requestId: string,
): Promise<ApiResult<ServiceRequestView>> {
  return serviceRequest(ctx, 'GET', `/api/v1/service-requests/${requestId}`, undefined, (data) =>
    parseWith(ServiceRequestViewSchema, data),
  );
}

export async function createServiceRequest(
  ctx: AuthRequestContext,
  input: CreateServiceRequestRequest,
): Promise<ApiResult<ServiceRequestView>> {
  const parsedInput = parseInput(CreateServiceRequestRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  const body = parsedInput.data;
  return serviceRequest(ctx, 'POST', '/api/v1/service-requests', body, (data) =>
    parseWith(ServiceRequestViewSchema, data),
  );
}

export async function triageServiceRequest(
  ctx: AuthRequestContext,
  requestId: string,
  input: Record<string, unknown>,
): Promise<ApiResult<ServiceRequestView>> {
  return serviceRequest(ctx, 'PATCH', `/api/v1/service-requests/${requestId}`, input, (data) =>
    parseWith(ServiceRequestViewSchema, data),
  );
}

export async function convertServiceRequest(
  ctx: AuthRequestContext,
  requestId: string,
  input: Parameters<(typeof ConvertServiceRequestRequestSchema)['parse']>[0],
): Promise<ApiResult<ConvertServiceRequestResponse>> {
  const parsedInput = parseInput(ConvertServiceRequestRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  const body = parsedInput.data;
  return serviceRequest(
    ctx,
    'POST',
    `/api/v1/service-requests/${requestId}/convert`,
    body,
    (data) => parseWith(ConvertServiceRequestResponseSchema, data),
  );
}

export async function cancelServiceRequest(
  ctx: AuthRequestContext,
  requestId: string,
  input: { reasonCode: string; note?: string },
): Promise<ApiResult<ServiceRequestView>> {
  return serviceRequest(
    ctx,
    'POST',
    `/api/v1/service-requests/${requestId}/cancel`,
    input,
    (data) => parseWith(ServiceRequestViewSchema, data),
  );
}

export async function listServiceCategories(
  ctx: AuthRequestContext,
): Promise<ApiResult<ServiceCategoryView[]>> {
  const result = await serviceRequest(
    ctx,
    'GET',
    '/api/v1/service-requests/categories',
    undefined,
    (data) => parseWith(ServiceCategoryListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

export async function listSlaPolicies(
  ctx: AuthRequestContext,
): Promise<ApiResult<SlaPolicyView[]>> {
  const result = await serviceRequest(
    ctx,
    'GET',
    '/api/v1/service-requests/sla-policies',
    undefined,
    (data) => parseWith(SlaPolicyListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

// ------------------------- İş emirleri -------------------------

export async function listWorkOrders(
  ctx: AuthRequestContext,
  query: Partial<WorkOrderListQuery> = {},
): Promise<ApiResult<WorkOrderListResponse>> {
  return serviceRequest(
    ctx,
    'GET',
    `/api/v1/work-orders${queryString({ ...query })}`,
    undefined,
    (data) => parseWith(WorkOrderListResponseSchema, data),
  );
}

export async function fetchWorkOrder(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<ApiResult<WorkOrderDetailResponse>> {
  return serviceRequest(ctx, 'GET', `/api/v1/work-orders/${workOrderId}`, undefined, (data) =>
    parseWith(WorkOrderDetailResponseSchema, data),
  );
}

export async function createWorkOrder(
  ctx: AuthRequestContext,
  input: CreateWorkOrderRequest,
): Promise<ApiResult<WorkOrderView>> {
  return serviceRequest(ctx, 'POST', '/api/v1/work-orders', input, (data) =>
    parseWith(WorkOrderViewSchema, data),
  );
}

export async function updateWorkOrder(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: Record<string, unknown> & { expectedVersion: number },
): Promise<ApiResult<WorkOrderView>> {
  return serviceRequest(ctx, 'PATCH', `/api/v1/work-orders/${workOrderId}`, input, (data) =>
    parseWith(WorkOrderViewSchema, data),
  );
}

export async function transitionWorkOrder(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: Parameters<(typeof TransitionWorkOrderRequestSchema)['parse']>[0],
): Promise<ApiResult<WorkOrderView>> {
  const parsedInput = parseInput(TransitionWorkOrderRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  const body = parsedInput.data;
  return serviceRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/transition`,
    body,
    (data) => parseWith(WorkOrderViewSchema, data),
  );
}

export async function addWorkOrderNote(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: Parameters<(typeof WorkOrderNoteCreateSchema)['parse']>[0],
): Promise<ApiResult<WorkOrderNoteView>> {
  const parsedInput = parseInput(WorkOrderNoteCreateSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  const body = parsedInput.data;
  return serviceRequest(ctx, 'POST', `/api/v1/work-orders/${workOrderId}/notes`, body, (data) =>
    parseWith(WorkOrderNoteViewSchema, data),
  );
}

export async function listAssignableUsers(
  ctx: AuthRequestContext,
): Promise<ApiResult<AssignableUserView[]>> {
  const result = await serviceRequest(
    ctx,
    'GET',
    '/api/v1/work-orders/assignable-users',
    undefined,
    (data) => parseWith(AssignableUserListResponseSchema, data),
  );
  return result.ok ? { ok: true, data: result.data.data } : result;
}

// ------------------------- Yardımcılar -------------------------

interface SafeParseLike<T> {
  safeParse: (data: unknown) => { success: true; data: T } | { success: false };
}

function parseWith<T>(schema: SafeParseLike<T>, data: unknown): ParseOutcome<T> {
  const result = schema.safeParse(data);
  return result.success ? { success: true as const, data: result.data } : { success: false };
}

/** Girdi gövdesi doğrulaması — başarısızlıkta fırlatmak yerine hata sonucu. */
function parseInput<T>(
  schema: SafeParseLike<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; result: ApiResult<never> } {
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

/** Öncelik etiketleri (UI listeleri — web/mobil ortak). */
export const PRIORITY_LABELS: Record<ServicePriority, string> = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
  URGENT: 'Acil',
};
