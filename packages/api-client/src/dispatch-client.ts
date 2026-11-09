import type { ApiError, ApiResult, AuthRequestContext } from './auth-client.js';
import {
  AvailabilityQuerySchema,
  AvailabilityResponseSchema,
  CreateSkillRequestSchema,
  CreateTeamRequestSchema,
  DispatchBoardResponseSchema,
  DispatchConflictListResponseSchema,
  OkResponseSchema,
  ScheduleWorkOrderRequestSchema,
  ScheduleWorkOrderResponseSchema,
  SetUserSkillRequestSchema,
  TechnicianListResponseSchema,
  TechnicianProfileUpsertRequestSchema,
  TechnicianProfileViewSchema,
  TimeOffCreateSchema,
  TimeOffViewSchema,
  UpdateTeamRequestSchema,
  UserSkillViewSchema,
  WorkingHoursResponseSchema,
  WorkingHoursUpsertRequestSchema,
  SkillListResponseSchema,
  SkillViewSchema,
  TeamListResponseSchema,
  TeamViewSchema,
  type AvailabilityQuery,
  type AvailabilityResponse,
  type CreateSkillRequest,
  type CreateTeamRequest,
  type DispatchBoardQuery,
  type DispatchBoardResponse,
  type DispatchConflictListResponse,
  type ScheduleWorkOrderRequest,
  type ScheduleWorkOrderResponse,
  type SetUserSkillRequest,
  type SkillView,
  type TeamView,
  type TechnicianListResponse,
  type TechnicianProfileUpsertRequest,
  type TechnicianProfileView,
  type TimeOffCreate,
  type TimeOffView,
  type UpdateTeamRequest,
  type UserSkillView,
  type WorkingHoursResponse,
  type WorkingHourView,
} from '@teknikflow/contracts';

/**
 * Faz 06 — dispatch istemcisi: pano, teknisyenler, planlama, çalışma
 * saatleri, izinler, yetenekler ve takımlar.
 *
 * Web sunucu bileşenleri çerezleri çağırandan alır; mutasyonlar CSRF
 * başlığı ister (AuthRequestContext). Sözleşme uyuşmazlıkları fırlatılmaz
 * — ApiResult zarfıyla döner (service-client deseninin aynısı).
 */

type ParseOutcome<T> = { success: true; data: T } | { success: false };

export { type ApiResult, type ApiError, type AuthRequestContext };

async function dispatchRequest<T>(
  ctx: AuthRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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

// ------------------------- Pano -------------------------

export async function fetchDispatchBoard(
  ctx: AuthRequestContext,
  query: Partial<DispatchBoardQuery> = {},
): Promise<ApiResult<DispatchBoardResponse>> {
  const params = new URLSearchParams();
  if (query.date) params.set('date', query.date);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return dispatchRequest(ctx, 'GET', `/api/v1/dispatch/board${suffix}`, undefined, (data) =>
    parseWith(DispatchBoardResponseSchema, data),
  );
}

export async function fetchDispatchConflicts(
  ctx: AuthRequestContext,
  query: { from?: string; to?: string } = {},
): Promise<ApiResult<DispatchConflictListResponse>> {
  return dispatchRequest(
    ctx,
    'GET',
    `/api/v1/dispatch/conflicts${queryString(query)}`,
    undefined,
    (data) => parseWith(DispatchConflictListResponseSchema, data),
  );
}

function queryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

// ------------------------- Planlama -------------------------

export async function scheduleWorkOrder(
  ctx: AuthRequestContext,
  workOrderId: string,
  input: ScheduleWorkOrderRequest,
): Promise<ApiResult<ScheduleWorkOrderResponse>> {
  const parsedInput = parseInput(ScheduleWorkOrderRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(
    ctx,
    'POST',
    `/api/v1/dispatch/schedule/${workOrderId}`,
    parsedInput.data,
    (data) => parseWith(ScheduleWorkOrderResponseSchema, data),
  );
}

// ------------------------- Teknisyenler -------------------------

export async function listDispatchTechnicians(
  ctx: AuthRequestContext,
): Promise<ApiResult<TechnicianListResponse>> {
  return dispatchRequest(ctx, 'GET', '/api/v1/dispatch/technicians', undefined, (data) =>
    parseWith(TechnicianListResponseSchema, data),
  );
}

export async function fetchTechnicianAvailability(
  ctx: AuthRequestContext,
  userId: string,
  query: AvailabilityQuery,
): Promise<ApiResult<AvailabilityResponse>> {
  const parsedInput = parseInput(AvailabilityQuerySchema, query);
  if (!parsedInput.ok) return parsedInput.result;
  const params = new URLSearchParams({
    from: parsedInput.data.from,
    to: parsedInput.data.to,
  });
  return dispatchRequest(
    ctx,
    'GET',
    `/api/v1/dispatch/technicians/${userId}/availability?${params.toString()}`,
    undefined,
    (data) => parseWith(AvailabilityResponseSchema, data),
  );
}

export async function upsertTechnicianProfile(
  ctx: AuthRequestContext,
  userId: string,
  input: TechnicianProfileUpsertRequest,
): Promise<ApiResult<TechnicianProfileView>> {
  const parsedInput = parseInput(TechnicianProfileUpsertRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(
    ctx,
    'PUT',
    `/api/v1/dispatch/technicians/${userId}/profile`,
    parsedInput.data,
    (data) => parseWith(TechnicianProfileViewSchema, data),
  );
}

export async function upsertWorkingHours(
  ctx: AuthRequestContext,
  userId: string,
  input: { hours: Array<{ weekday: number; startMinute: number; endMinute: number }> },
): Promise<ApiResult<WorkingHoursResponse>> {
  const parsedInput = parseInput(WorkingHoursUpsertRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(
    ctx,
    'PUT',
    `/api/v1/dispatch/technicians/${userId}/working-hours`,
    parsedInput.data,
    (data) => parseWith(WorkingHoursResponseSchema, data),
  );
}

export async function listWorkingHours(
  ctx: AuthRequestContext,
  userId: string,
): Promise<ApiResult<WorkingHoursResponse>> {
  return dispatchRequest(
    ctx,
    'GET',
    `/api/v1/dispatch/technicians/${userId}/working-hours`,
    undefined,
    (data) => parseWith(WorkingHoursResponseSchema, data),
  );
}

// ------------------------- İzinler -------------------------

export async function createTimeOff(
  ctx: AuthRequestContext,
  userId: string,
  input: TimeOffCreate,
): Promise<ApiResult<TimeOffView>> {
  const parsedInput = parseInput(TimeOffCreateSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(
    ctx,
    'POST',
    `/api/v1/dispatch/technicians/${userId}/time-off`,
    parsedInput.data,
    (data) => parseWith(TimeOffViewSchema, data),
  );
}

export async function cancelTimeOff(
  ctx: AuthRequestContext,
  timeOffId: string,
): Promise<ApiResult<TimeOffView>> {
  return dispatchRequest(
    ctx,
    'POST',
    `/api/v1/dispatch/time-offs/${timeOffId}/cancel`,
    {},
    (data) => parseWith(TimeOffViewSchema, data),
  );
}

// ------------------------- Yetenekler -------------------------

export async function listSkills(
  ctx: AuthRequestContext,
): Promise<ApiResult<{ data: SkillView[] }>> {
  return dispatchRequest(ctx, 'GET', '/api/v1/dispatch/skills', undefined, (data) =>
    parseWith(SkillListResponseSchema, data),
  );
}

export async function createSkill(
  ctx: AuthRequestContext,
  input: CreateSkillRequest,
): Promise<ApiResult<SkillView>> {
  const parsedInput = parseInput(CreateSkillRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(ctx, 'POST', '/api/v1/dispatch/skills', parsedInput.data, (data) =>
    parseWith(SkillViewSchema, data),
  );
}

export async function setTechnicianSkill(
  ctx: AuthRequestContext,
  userId: string,
  input: SetUserSkillRequest,
): Promise<ApiResult<UserSkillView>> {
  const parsedInput = parseInput(SetUserSkillRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(
    ctx,
    'POST',
    `/api/v1/dispatch/technicians/${userId}/skills`,
    parsedInput.data,
    (data) => parseWith(UserSkillViewSchema, data),
  );
}

export async function removeTechnicianSkill(
  ctx: AuthRequestContext,
  userId: string,
  skillId: string,
): Promise<ApiResult<{ ok: true }>> {
  return dispatchRequest(
    ctx,
    'DELETE',
    `/api/v1/dispatch/technicians/${userId}/skills/${skillId}`,
    undefined,
    (data) => parseWith(OkResponseSchema, data),
  );
}

export async function addCategorySkill(
  ctx: AuthRequestContext,
  categoryId: string,
  skillId: string,
): Promise<ApiResult<{ ok: true }>> {
  return dispatchRequest(
    ctx,
    'POST',
    `/api/v1/dispatch/category-skills/${categoryId}`,
    { skillId },
    (data) => parseWith(OkResponseSchema, data),
  );
}

export async function removeCategorySkill(
  ctx: AuthRequestContext,
  categoryId: string,
  skillId: string,
): Promise<ApiResult<{ ok: true }>> {
  return dispatchRequest(
    ctx,
    'DELETE',
    `/api/v1/dispatch/category-skills/${categoryId}/${skillId}`,
    undefined,
    (data) => parseWith(OkResponseSchema, data),
  );
}

// ------------------------- Takımlar -------------------------

export async function listTeams(ctx: AuthRequestContext): Promise<ApiResult<{ data: TeamView[] }>> {
  return dispatchRequest(ctx, 'GET', '/api/v1/teams', undefined, (data) =>
    parseWith(TeamListResponseSchema, data),
  );
}

export async function createTeam(
  ctx: AuthRequestContext,
  input: CreateTeamRequest,
): Promise<ApiResult<TeamView>> {
  const parsedInput = parseInput(CreateTeamRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(ctx, 'POST', '/api/v1/teams', parsedInput.data, (data) =>
    parseWith(TeamViewSchema, data),
  );
}

export async function updateTeam(
  ctx: AuthRequestContext,
  teamId: string,
  input: UpdateTeamRequest,
): Promise<ApiResult<TeamView>> {
  const parsedInput = parseInput(UpdateTeamRequestSchema, input);
  if (!parsedInput.ok) return parsedInput.result;
  return dispatchRequest(ctx, 'PATCH', `/api/v1/teams/${teamId}`, parsedInput.data, (data) =>
    parseWith(TeamViewSchema, data),
  );
}

export async function deleteTeam(
  ctx: AuthRequestContext,
  teamId: string,
): Promise<ApiResult<{ ok: true }>> {
  return dispatchRequest(ctx, 'DELETE', `/api/v1/teams/${teamId}`, undefined, (data) =>
    parseWith(OkResponseSchema, data),
  );
}

export async function addTeamMember(
  ctx: AuthRequestContext,
  teamId: string,
  userId: string,
): Promise<ApiResult<{ ok: true }>> {
  return dispatchRequest(ctx, 'POST', `/api/v1/teams/${teamId}/members`, { userId }, (data) =>
    parseWith(OkResponseSchema, data),
  );
}

export async function removeTeamMember(
  ctx: AuthRequestContext,
  teamId: string,
  userId: string,
): Promise<ApiResult<{ ok: true }>> {
  return dispatchRequest(
    ctx,
    'DELETE',
    `/api/v1/teams/${teamId}/members/${userId}`,
    undefined,
    (data) => parseWith(OkResponseSchema, data),
  );
}

export type { WorkingHourView, UserSkillView };
