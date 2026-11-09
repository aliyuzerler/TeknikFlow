import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateWorkOrderRequestSchema,
  TransitionWorkOrderRequestSchema,
  UpdateWorkOrderRequestSchema,
  WorkOrderListQuerySchema,
  WorkOrderNoteCreateSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { WorkOrdersService } from './work-orders.service.js';

/**
 * Faz 05 — /api/v1/work-orders uçları: yaşam döngüsü, atama, notlar,
 * zaman çizelgesi.
 *
 * Okuma: work_orders:view_all (tümü) VEYA work_orders:view_assigned
 * (teknisyen — yalnız atanmış işler, kaynak düzeyi denetim).
 * Oluşturma: work_orders:create. Atama: work_orders:dispatch.
 * Geçiş yetkisi sınıfları work-order-state.ts'de belgelenmiştir.
 */
@Controller('work-orders')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Get()
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async list(
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = WorkOrderListQuerySchema.parse(query ?? {});
    const { rows, total } = await this.workOrders.listWorkOrders(
      requireTenant(ctx),
      { userId: ctx.userId, permissions: ctx.permissions },
      parsed,
    );
    return {
      data: rows.map((row) => WorkOrdersService.toView(row)),
      pageInfo: { total, page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  /** Atama çekmecesi: atanabilir üyeler (dispatch yetkisi gerekir). */
  @Get('assignable-users')
  @RequirePermissions('work_orders:dispatch')
  async assignableUsers(@CurrentAuth() ctx: RequestAuthContext) {
    const users = await this.workOrders.listAssignableUsers(requireTenant(ctx));
    return { data: users };
  }

  @Post()
  @RequirePermissions('work_orders:create')
  async create(@Body() body: unknown, @CurrentAuth() ctx: RequestAuthContext, @Req() req: Request) {
    const input = CreateWorkOrderRequestSchema.parse(body);
    const created = await this.workOrders.createWorkOrder(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return WorkOrdersService.toView(created);
  }

  @Get(':id')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async get(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const detail = await this.workOrders.getWorkOrderDetail(requireTenant(ctx), id, {
      userId: ctx.userId,
      permissions: ctx.permissions,
    });
    return {
      ...WorkOrdersService.toView(detail),
      events: detail.events.map((event) => WorkOrdersService.toEventView(event)),
      notes: detail.notes.map((note) => WorkOrdersService.toNoteView(note)),
      assignments: detail.assignments.map((a) => WorkOrdersService.toAssignmentView(a)),
    };
  }

  @Patch(':id')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateWorkOrderRequestSchema.parse(body);
    const updated = await this.workOrders.updateWorkOrder(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return WorkOrdersService.toView(updated);
  }

  /**
   * Birleşik durum geçişi — durum makinesinin tek giriş kapısı.
   * Yetki sınıfı geçiş kuralından (work-order-state.ts) türetilir.
   */
  @Post(':id/transition')
  async transition(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = TransitionWorkOrderRequestSchema.parse(body);
    const updated = await this.workOrders.transitionWorkOrder(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
      permissions: ctx.permissions,
    });
    return WorkOrdersService.toView(updated);
  }

  @Post(':id/notes')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async addNote(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const input = WorkOrderNoteCreateSchema.parse(body);
    return this.workOrders.addNote(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      permissions: ctx.permissions,
    });
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
