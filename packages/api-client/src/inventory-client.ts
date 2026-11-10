import type { ApiError, AuthRequestContext } from './auth-client.js';
import {
  BalanceListQuerySchema,
  BalanceListResponseSchema,
  BinListResponseSchema,
  BinViewSchema,
  CloseStockCountRequestSchema,
  ConsumePartRequestSchema,
  CountLineListResponseSchema,
  CountLineViewSchema,
  CreateBinRequestSchema,
  CreateMovementRequestSchema,
  CreateReservationRequestSchema,
  CreateStockCountRequestSchema,
  CreateStockItemRequestSchema,
  CreateWarehouseRequestSchema,
  MovementListQuerySchema,
  MovementPageResponseSchema,
  MovementViewSchema,
  PartConsumptionListResponseSchema,
  PartConsumptionViewSchema,
  ReleaseReservationRequestSchema,
  ReservationListResponseSchema,
  ReservationViewSchema,
  StockCountListResponseSchema,
  StockCountViewSchema,
  StockItemListQuerySchema,
  StockItemPageResponseSchema,
  StockItemViewSchema,
  SubmitCountLineRequestSchema,
  UpdateStockItemRequestSchema,
  WarehouseListResponseSchema,
  WarehouseViewSchema,
  type BalanceListQuery,
  type BalanceView,
  type BinView,
  type CloseStockCountRequest,
  type ConsumePartRequest,
  type CountLineView,
  type CreateBinRequest,
  type CreateMovementRequest,
  type CreateReservationRequest,
  type CreateStockCountRequest,
  type CreateStockItemRequest,
  type CreateWarehouseRequest,
  type MovementListQuery,
  type MovementView,
  type PartConsumptionView,
  type ReservationView,
  type StockCountView,
  type StockItemListQuery,
  type StockItemView,
  type SubmitCountLineRequest,
  type UpdateStockItemRequest,
  type WarehouseView,
} from '@teknikflow/contracts';

/**
 * Faz 09 — stok istemcisi: katalog, depolar, hareketler, bakiye,
 * rezervasyonlar, sayım ve iş emri parça tüketimi.
 *
 * Mutasyonlar opsiyonel idempotency anahtarı taşır (mobil outbox UUID):
 * sunucu tekrarını saklanan kanonik yanıtla oynatır; hareket defteri
 * ayrıca movementKey tekil kısıtıyla korunur. Yanıt başlığı
 * x-idempotent-replay sonuç üzerinde replayed olarak iletilir.
 */

type ParseOutcome<T> = { success: true; data: T } | { success: false };

export type InventoryMutationResult<T> =
  { ok: true; data: T; replayed?: boolean } | { ok: false; error: ApiError; replayed?: boolean };

async function inventoryRequest<T>(
  ctx: AuthRequestContext,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown | undefined,
  query?: Record<string, string | undefined>,
  parse?: (data: unknown) => ParseOutcome<T>,
  extraHeaders?: Record<string, string>,
): Promise<InventoryMutationResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (ctx.cookieHeader) headers.cookie = ctx.cookieHeader;
  if (ctx.bearerToken) headers.authorization = `Bearer ${ctx.bearerToken}`;
  if (ctx.csrfToken) headers['x-csrf-token'] = ctx.csrfToken;
  for (const [key, value] of Object.entries(extraHeaders ?? {})) {
    headers[key] = value;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') searchParams.set(key, value);
  }
  const qs = searchParams.toString();
  const url = `${joinUrl(ctx.baseUrl, path)}${qs ? `?${qs}` : ''}`;

  let response: Response;
  try {
    response = await fetch(url, {
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
    return {
      ok: false,
      replayed,
      error: {
        kind: 'http-error',
        message: envelope.message ?? `HTTP ${response.status}`,
        httpStatus: response.status,
        code: envelope.code,
        ...(envelope.details
          ? { details: envelope.details as Record<string, string | number> }
          : {}),
      },
    };
  }

  const jsonBody: unknown = await safeJson(response);
  if (!parse) return { ok: true, replayed, data: jsonBody as T };
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
): Promise<{ message?: string; code?: string; details?: unknown } & Record<string, unknown>> {
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
): { ok: true; data: T } | { ok: false; result: InventoryMutationResult<never> } {
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

function idempotencyHeader(key?: string): Record<string, string> | undefined {
  return key ? { 'x-idempotency-key': key } : undefined;
}

// ------------------------- Katalog (SKU) -------------------------

export async function createStockItem(
  ctx: AuthRequestContext,
  input: CreateStockItemRequest,
): Promise<InventoryMutationResult<StockItemView>> {
  const parsedInput = parseInput(CreateStockItemRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    '/api/v1/inventory/items',
    parsedInput.data,
    undefined,
    (data) => parseWith(StockItemViewSchema, data),
  );
}

export async function listStockItems(
  ctx: AuthRequestContext,
  query: StockItemListQuery = { page: 1, pageSize: 50 },
): Promise<
  InventoryMutationResult<{ data: StockItemView[]; total: number; page: number; pageSize: number }>
> {
  const parsedQuery = StockItemListQuerySchema.safeParse(query);
  if (!parsedQuery.success) {
    return {
      ok: false,
      error: { kind: 'contract-mismatch', message: 'Sorgu doğrulamadan geçemedi' },
    };
  }
  return inventoryRequest(
    ctx,
    'GET',
    '/api/v1/inventory/items',
    undefined,
    {
      q: parsedQuery.data.q,
      active: parsedQuery.data.active,
      trackingMode: parsedQuery.data.trackingMode,
      lowStock: parsedQuery.data.lowStock,
      page: String(parsedQuery.data.page),
      pageSize: String(parsedQuery.data.pageSize),
    },
    (data) => parseWith(StockItemPageResponseSchema, data),
  );
}

export async function updateStockItem(
  ctx: AuthRequestContext,
  itemId: string,
  input: UpdateStockItemRequest,
): Promise<InventoryMutationResult<StockItemView>> {
  const parsedInput = parseInput(UpdateStockItemRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'PATCH',
    `/api/v1/inventory/items/${itemId}`,
    parsedInput.data,
    undefined,
    (data) => parseWith(StockItemViewSchema, data),
  );
}

// ------------------------- Depo / raf -------------------------

export async function createWarehouse(
  ctx: AuthRequestContext,
  input: CreateWarehouseRequest,
): Promise<InventoryMutationResult<WarehouseView>> {
  const parsedInput = parseInput(CreateWarehouseRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    '/api/v1/inventory/warehouses',
    parsedInput.data,
    undefined,
    (data) => parseWith(WarehouseViewSchema, data),
  );
}

export async function listWarehouses(
  ctx: AuthRequestContext,
): Promise<InventoryMutationResult<{ data: WarehouseView[] }>> {
  return inventoryRequest(
    ctx,
    'GET',
    '/api/v1/inventory/warehouses',
    undefined,
    undefined,
    (data) => parseWith(WarehouseListResponseSchema, data),
  );
}

export async function createBin(
  ctx: AuthRequestContext,
  warehouseId: string,
  input: CreateBinRequest,
): Promise<InventoryMutationResult<BinView>> {
  const parsedInput = parseInput(CreateBinRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    `/api/v1/inventory/warehouses/${warehouseId}/bins`,
    parsedInput.data,
    undefined,
    (data) => parseWith(BinViewSchema, data),
  );
}

export async function listBins(
  ctx: AuthRequestContext,
  warehouseId: string,
): Promise<InventoryMutationResult<{ data: BinView[] }>> {
  return inventoryRequest(
    ctx,
    'GET',
    `/api/v1/inventory/warehouses/${warehouseId}/bins`,
    undefined,
    undefined,
    (data) => parseWith(BinListResponseSchema, data),
  );
}

// ------------------------- Hareketler / bakiye -------------------------

export async function createMovement(
  ctx: AuthRequestContext,
  input: CreateMovementRequest,
  idempotencyKey?: string,
): Promise<InventoryMutationResult<MovementView>> {
  const parsedInput = parseInput(CreateMovementRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    '/api/v1/inventory/movements',
    parsedInput.data,
    undefined,
    (data) => parseWith(MovementViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listMovements(
  ctx: AuthRequestContext,
  query: MovementListQuery = { page: 1, pageSize: 100 },
): Promise<
  InventoryMutationResult<{ data: MovementView[]; total: number; page: number; pageSize: number }>
> {
  const parsedQuery = MovementListQuerySchema.safeParse(query);
  if (!parsedQuery.success) {
    return {
      ok: false,
      error: { kind: 'contract-mismatch', message: 'Sorgu doğrulamadan geçemedi' },
    };
  }
  return inventoryRequest(
    ctx,
    'GET',
    '/api/v1/inventory/movements',
    undefined,
    {
      itemId: parsedQuery.data.itemId,
      warehouseId: parsedQuery.data.warehouseId,
      type: parsedQuery.data.type,
      referenceId: parsedQuery.data.referenceId,
      page: String(parsedQuery.data.page),
      pageSize: String(parsedQuery.data.pageSize),
    },
    (data) => parseWith(MovementPageResponseSchema, data),
  );
}

export async function listBalances(
  ctx: AuthRequestContext,
  query: BalanceListQuery = { page: 1, pageSize: 100 },
): Promise<InventoryMutationResult<{ data: BalanceView[] }>> {
  const parsedQuery = BalanceListQuerySchema.safeParse(query);
  if (!parsedQuery.success) {
    return {
      ok: false,
      error: { kind: 'contract-mismatch', message: 'Sorgu doğrulamadan geçemedi' },
    };
  }
  return inventoryRequest(
    ctx,
    'GET',
    '/api/v1/inventory/balances',
    undefined,
    {
      warehouseId: parsedQuery.data.warehouseId,
      itemId: parsedQuery.data.itemId,
      warehouseType: parsedQuery.data.warehouseType,
      mine: parsedQuery.data.mine,
      lowStock: parsedQuery.data.lowStock,
    },
    (data) => parseWith(BalanceListResponseSchema, data),
  );
}

// ------------------------- Rezervasyon -------------------------

export async function createReservation(
  ctx: AuthRequestContext,
  input: CreateReservationRequest,
  idempotencyKey?: string,
): Promise<InventoryMutationResult<ReservationView>> {
  const parsedInput = parseInput(CreateReservationRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    '/api/v1/inventory/reservations',
    parsedInput.data,
    undefined,
    (data) => parseWith(ReservationViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listReservations(
  ctx: AuthRequestContext,
  workOrderId?: string,
): Promise<InventoryMutationResult<{ data: ReservationView[] }>> {
  return inventoryRequest(
    ctx,
    'GET',
    '/api/v1/inventory/reservations',
    undefined,
    { workOrderId },
    (data) => parseWith(ReservationListResponseSchema, data),
  );
}

export async function releaseReservation(
  ctx: AuthRequestContext,
  reservationId: string,
  idempotencyKey?: string,
): Promise<InventoryMutationResult<ReservationView>> {
  const parsedInput = parseInput(ReleaseReservationRequestSchema, {});
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    `/api/v1/inventory/reservations/${reservationId}/release`,
    parsedInput.data,
    undefined,
    (data) => parseWith(ReservationViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

// ------------------------- İş emri parça tüketimi -------------------------

export async function consumePart(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: ConsumePartRequest,
  idempotencyKey?: string,
): Promise<InventoryMutationResult<PartConsumptionView>> {
  const parsedInput = parseInput(ConsumePartRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    `/api/v1/work-orders/${workOrderId}/parts`,
    parsedInput.data,
    undefined,
    (data) => parseWith(PartConsumptionViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listWorkOrderParts(
  ctx: AuthRequestContext,
  workOrderId: string,
): Promise<InventoryMutationResult<{ data: PartConsumptionView[] }>> {
  return inventoryRequest(
    ctx,
    'GET',
    `/api/v1/work-orders/${workOrderId}/parts`,
    undefined,
    undefined,
    (data) => parseWith(PartConsumptionListResponseSchema, data),
  );
}

// ------------------------- Sayım (cycle count) -------------------------

export async function createStockCount(
  ctx: AuthRequestContext,
  input: CreateStockCountRequest,
  idempotencyKey?: string,
): Promise<InventoryMutationResult<StockCountView>> {
  const parsedInput = parseInput(CreateStockCountRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    '/api/v1/inventory/counts',
    parsedInput.data,
    undefined,
    (data) => parseWith(StockCountViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function listStockCounts(
  ctx: AuthRequestContext,
): Promise<InventoryMutationResult<{ data: StockCountView[] }>> {
  return inventoryRequest(ctx, 'GET', '/api/v1/inventory/counts', undefined, undefined, (data) =>
    parseWith(StockCountListResponseSchema, data),
  );
}

export async function listCountLines(
  ctx: AuthRequestContext,
  countId: string,
): Promise<InventoryMutationResult<{ data: CountLineView[] }>> {
  return inventoryRequest(
    ctx,
    'GET',
    `/api/v1/inventory/counts/${countId}/lines`,
    undefined,
    undefined,
    (data) => parseWith(CountLineListResponseSchema, data),
  );
}

export async function submitCountLine(
  ctx: AuthRequestContext,
  countId: string,
  input: SubmitCountLineRequest,
  idempotencyKey?: string,
): Promise<InventoryMutationResult<CountLineView>> {
  const parsedInput = parseInput(SubmitCountLineRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    `/api/v1/inventory/counts/${countId}/lines`,
    parsedInput.data,
    undefined,
    (data) => parseWith(CountLineViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}

export async function closeStockCount(
  ctx: AuthRequestContext,
  countId: string,
  input: CloseStockCountRequest = {},
  idempotencyKey?: string,
): Promise<InventoryMutationResult<StockCountView>> {
  const parsedInput = parseInput(CloseStockCountRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return inventoryRequest(
    ctx,
    'POST',
    `/api/v1/inventory/counts/${countId}/close`,
    parsedInput.data,
    undefined,
    (data) => parseWith(StockCountViewSchema, data),
    idempotencyHeader(idempotencyKey),
  );
}
