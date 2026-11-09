import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateTeamRequestSchema,
  TeamMemberAddRequestSchema,
  UpdateTeamRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { DispatchService } from './dispatch.service.js';

/**
 * Faz 06 — /api/v1/teams uçları: ekip organizasyonu ve kapasite kaynağı.
 *
 * Okuma: work_orders:view_all VEYA users:manage (pano + yönetim görünümü).
 * Yönetim (oluşturma/düzenleme/üye): users:manage — planlamacı ekibi
 * KURAMAZ, yalnız planlar (en-az-ayrıcalık; docs/ROLES_PERMISSIONS.md).
 */
@Controller('teams')
@UseGuards(AuthGuard, PermissionsGuard)
export class TeamsController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @RequireAnyPermissions('work_orders:view_all', 'users:manage')
  async list(@CurrentAuth() ctx: RequestAuthContext) {
    return { data: await this.dispatch.listTeams(requireTenant(ctx)) };
  }

  @Post()
  @RequirePermissions('users:manage')
  async create(@Body() body: unknown, @CurrentAuth() ctx: RequestAuthContext, @Req() req: Request) {
    const input = CreateTeamRequestSchema.parse(body);
    return this.dispatch.createTeam(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Patch(':id')
  @RequirePermissions('users:manage')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateTeamRequestSchema.parse(body);
    return this.dispatch.updateTeam(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Delete(':id')
  @RequirePermissions('users:manage')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    await this.dispatch.deleteTeam(requireTenant(ctx), id, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { ok: true };
  }

  @Post(':id/members')
  @RequirePermissions('users:manage')
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = TeamMemberAddRequestSchema.parse(body);
    await this.dispatch.addTeamMember(requireTenant(ctx), id, input.userId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { ok: true };
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('users:manage')
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    await this.dispatch.removeTeamMember(requireTenant(ctx), id, userId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { ok: true };
  }
}

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
