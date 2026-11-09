import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateServiceCategoryRequestSchema,
  CreateServiceRequestRequestSchema,
  CancelServiceRequestRequestSchema,
  ConvertServiceRequestRequestSchema,
  ServiceRequestListQuerySchema,
  TriageServiceRequestRequestSchema,
  UpsertSlaPolicyRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { RequestsService } from './requests.service.js';

/**
 * Faz 05 — /api/v1/service-requests uçları: intake gelen kutusu, triyaj,
 * SLA politikaları ve kategoriler, iş emrine dönüşüm/iptal.
 *
 * Okuma ve intake: service_requests:create VEYA work_orders:view_all
 * (owner/admin/dispatcher/service-manager). Teknisyen gelen kutusunu görmez
 * — yalnız atanmış iş emirleri (work-orders uçları).
 */
@Controller('service-requests')
@UseGuards(AuthGuard, PermissionsGuard)
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @RequireAnyPermissions('service_requests:create', 'work_orders:view_all')
  async list(
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = ServiceRequestListQuerySchema.parse(query ?? {});
    const { rows, total } = await this.requests.listRequests(requireTenant(ctx), parsed);
    return {
      data: rows.map((row) => RequestsService.toView(row)),
      pageInfo: { total, page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  @Get('categories')
  @RequireAnyPermissions('service_requests:create', 'work_orders:view_all')
  async categories(@CurrentAuth() ctx: RequestAuthContext) {
    const rows = await this.requests.listCategories(requireTenant(ctx));
    return {
      data: rows.map((c) => ({
        categoryId: c.id,
        key: c.key,
        name: c.name,
        description: c.description,
      })),
    };
  }

  @Post('categories')
  @RequirePermissions('service_requests:create')
  async createCategory(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateServiceCategoryRequestSchema.parse(body);
    const created = await this.requests.createCategory(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return {
      categoryId: created.id,
      key: created.key,
      name: created.name,
      description: created.description,
    };
  }

  @Get('sla-policies')
  @RequireAnyPermissions('service_requests:create', 'work_orders:view_all')
  async slaPolicies(@CurrentAuth() ctx: RequestAuthContext) {
    const rows = await this.requests.listSlaPolicies(requireTenant(ctx));
    return {
      data: rows.map((p) => ({
        priority: p.priority,
        resolveMinutes: p.resolveMinutes,
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  }

  @Put('sla-policies')
  @RequirePermissions('service_requests:create')
  async upsertSlaPolicy(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpsertSlaPolicyRequestSchema.parse(body);
    const saved = await this.requests.upsertSlaPolicy(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return {
      priority: saved.priority,
      resolveMinutes: saved.resolveMinutes,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  @Post()
  @RequirePermissions('service_requests:create')
  async create(@Body() body: unknown, @CurrentAuth() ctx: RequestAuthContext, @Req() req: Request) {
    const input = CreateServiceRequestRequestSchema.parse(body);
    const created = await this.requests.createRequest(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return RequestsService.toView(created);
  }

  @Get(':id')
  @RequireAnyPermissions('service_requests:create', 'work_orders:view_all')
  async get(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const request = await this.requests.getRequest(requireTenant(ctx), id);
    return RequestsService.toView(request);
  }

  /** Talep etkinlik geçmişi (müşteri zaman çizelgesi kayıtları). */
  @Get(':id/events')
  @RequireAnyPermissions('service_requests:create', 'work_orders:view_all')
  async events(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const rows = await this.requests.requestTimeline(requireTenant(ctx), id);
    return {
      data: rows.map((event) => ({
        eventId: event.id,
        eventType: event.eventType,
        actorId: event.actorId,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  @Patch(':id')
  @RequirePermissions('service_requests:create')
  async triage(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = TriageServiceRequestRequestSchema.parse(body);
    const updated = await this.requests.triageRequest(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return RequestsService.toView(updated);
  }

  /** Talebi iş emrine dönüştür — work_orders:create gerekir (yeni iş emri). */
  @Post(':id/convert')
  @RequirePermissions('work_orders:create')
  async convert(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = ConvertServiceRequestRequestSchema.parse(body);
    const result = await this.requests.convertRequest(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { request: RequestsService.toView(result.request), workOrder: result.workOrder };
  }

  @Post(':id/cancel')
  @RequirePermissions('service_requests:create')
  async cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CancelServiceRequestRequestSchema.parse(body);
    const cancelled = await this.requests.cancelRequest(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return RequestsService.toView(cancelled);
  }
}

function requireTenant(ctx: RequestAuthContext): string {
  if (!ctx.tenantId) {
    throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
  }
  return ctx.tenantId;
}

function headerString(req: Request): string | undefined {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' ? value : undefined;
}
