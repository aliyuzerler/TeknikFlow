import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AvailabilityQuerySchema,
  CategorySkillSetRequestSchema,
  ConflictListQuerySchema,
  CreateSkillRequestSchema,
  DispatchBoardQuerySchema,
  ScheduleWorkOrderRequestSchema,
  SetUserSkillRequestSchema,
  TechnicianProfileUpsertRequestSchema,
  TimeOffCreateSchema,
  WorkingHoursUpsertRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { DispatchService } from './dispatch.service.js';

function headerString(req: Request): string | undefined {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' ? value : undefined;
}

function requireTenant(ctx: RequestAuthContext): string {
  if (!ctx.tenantId) {
    throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
  }
  return ctx.tenantId;
}

/**
 * Faz 06 — /api/v1/dispatch uçları.
 *
 * Okuma (pano/çakışma): work_orders:view_all. Teknisyen listesi ve
 * planlama kaynakları: work_orders:dispatch. Pano teknisyen rolüne
 * KAPALIdır (kendi gününü mobil gelen kutusu/Faz 07'de görür);
 * yetki denetimi sunucudadır — gizleme UX değildir.
 */
@Controller('dispatch')
@UseGuards(AuthGuard, PermissionsGuard)
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get('board')
  @RequirePermissions('work_orders:view_all')
  async board(
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = DispatchBoardQuerySchema.parse(query ?? {});
    return this.dispatch.getBoard(requireTenant(ctx), parsed, {
      userId: ctx.userId,
      permissions: ctx.permissions,
    });
  }

  @Get('technicians')
  @RequirePermissions('work_orders:dispatch')
  async technicians(@CurrentAuth() ctx: RequestAuthContext) {
    return { data: await this.dispatch.listTechnicians(requireTenant(ctx)) };
  }

  @Get('technicians/:userId/availability')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:dispatch')
  async availability(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = AvailabilityQuerySchema.parse(query ?? {});
    return this.dispatch.getAvailability(requireTenant(ctx), userId, parsed);
  }

  @Put('technicians/:userId/profile')
  @RequirePermissions('work_orders:dispatch')
  async upsertProfile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = TechnicianProfileUpsertRequestSchema.parse(body);
    return this.dispatch.upsertProfile(requireTenant(ctx), userId, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Get('technicians/:userId/working-hours')
  @RequirePermissions('work_orders:dispatch')
  async getWorkingHours(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const hours = await this.dispatch.getWorkingHours(requireTenant(ctx), userId);
    return { userId, hours };
  }

  @Put('technicians/:userId/working-hours')
  @RequirePermissions('work_orders:dispatch')
  async upsertWorkingHours(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = WorkingHoursUpsertRequestSchema.parse(body);
    const hours = await this.dispatch.upsertWorkingHours(requireTenant(ctx), userId, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { userId, hours };
  }

  @Post('technicians/:userId/time-off')
  @RequirePermissions('work_orders:dispatch')
  async createTimeOff(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = TimeOffCreateSchema.parse(body);
    return this.dispatch.createTimeOff(requireTenant(ctx), userId, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Post('time-offs/:id/cancel')
  @RequirePermissions('work_orders:dispatch')
  async cancelTimeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    return this.dispatch.cancelTimeOff(requireTenant(ctx), id, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Get('skills')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:dispatch')
  async skills(@CurrentAuth() ctx: RequestAuthContext) {
    return { data: await this.dispatch.listSkills(requireTenant(ctx)) };
  }

  @Post('skills')
  @RequirePermissions('work_orders:dispatch')
  async createSkill(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateSkillRequestSchema.parse(body);
    return this.dispatch.createSkill(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Post('technicians/:userId/skills')
  @RequirePermissions('work_orders:dispatch')
  async setUserSkill(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = SetUserSkillRequestSchema.parse(body);
    return this.dispatch.setUserSkill(requireTenant(ctx), userId, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Delete('technicians/:userId/skills/:skillId')
  @RequirePermissions('work_orders:dispatch')
  async removeUserSkill(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    await this.dispatch.removeUserSkill(requireTenant(ctx), userId, skillId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { ok: true };
  }

  @Post('category-skills/:categoryId')
  @RequirePermissions('work_orders:dispatch')
  async addCategorySkill(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CategorySkillSetRequestSchema.parse(body);
    await this.dispatch.addCategorySkill(requireTenant(ctx), categoryId, input.skillId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { ok: true };
  }

  @Delete('category-skills/:categoryId/:skillId')
  @RequirePermissions('work_orders:dispatch')
  async removeCategorySkill(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    await this.dispatch.removeCategorySkill(requireTenant(ctx), categoryId, skillId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { ok: true };
  }

  @Get('conflicts')
  @RequirePermissions('work_orders:view_all')
  async conflicts(
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = ConflictListQuerySchema.parse(query ?? {});
    return { data: await this.dispatch.listConflicts(requireTenant(ctx), parsed) };
  }

  /** Tek adımlı planlama: pencere kur + (istendiyse) ata / yeniden ata. */
  @Post('schedule/:workOrderId')
  @RequirePermissions('work_orders:dispatch')
  async schedule(
    @Param('workOrderId', ParseUUIDPipe) workOrderId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = ScheduleWorkOrderRequestSchema.parse(body);
    return this.dispatch.scheduleWorkOrder(requireTenant(ctx), workOrderId, input, {
      userId: ctx.userId,
      requestId: headerString(req),
      permissions: ctx.permissions,
    });
  }
}
