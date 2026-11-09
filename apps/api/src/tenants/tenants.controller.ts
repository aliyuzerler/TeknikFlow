import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CreateBranchRequestSchema,
  CreateInvitationRequestSchema,
  UpdateBranchRequestSchema,
  UpdateMemberRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { TenantsService } from './tenants.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Faz 03 — /api/v1/tenants/current/* uçları.
 *
 * "current" = sunucu tarafında oturumdan türetilen kiracı (ADR-0003);
 * istemci kiracı kimliği ASLA göndermez/iddia edemez.
 * Tüm yetkiler PermissionsGuard ile sunucu tarafında denetlenir.
 */
const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('tenants/current')
@UseGuards(AuthGuard, PermissionsGuard)
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get('branches')
  async listBranches(@CurrentAuth() ctx: RequestAuthContext) {
    const tenantId = this.requireTenant(ctx);
    const rows = await this.tenants.listBranches(tenantId);
    return {
      data: rows.map((b) => ({
        branchId: b.id,
        name: b.name,
        code: b.code,
        address: b.address,
        timezone: b.timezone,
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }

  @Post('branches')
  @RequirePermissions('branches:manage')
  async createBranch(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const tenantId = this.requireTenant(ctx);
    const input = CreateBranchRequestSchema.parse(body);
    try {
      const branch = await this.tenants.createBranch(tenantId, input, actorMeta(ctx, req));
      return {
        branchId: branch.id,
        name: branch.name,
        code: branch.code,
        address: branch.address,
        timezone: branch.timezone,
        createdAt: branch.createdAt.toISOString(),
      };
    } catch (error) {
      throw this.mapPlanLimit(error);
    }
  }

  @Patch('branches/:id')
  @RequirePermissions('branches:manage')
  async updateBranch(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const tenantId = this.requireTenant(ctx);
    const input = UpdateBranchRequestSchema.parse(body);
    const branch = await this.tenants.updateBranch(tenantId, id, input, {
      userId: ctx.userId,
      branchScope: ctx.branchScope,
    });
    return {
      branchId: branch.id,
      name: branch.name,
      code: branch.code,
      address: branch.address,
      timezone: branch.timezone,
      createdAt: branch.createdAt.toISOString(),
    };
  }

  @Get('members')
  @RequirePermissions('users:manage')
  async listMembers(@CurrentAuth() ctx: RequestAuthContext) {
    const tenantId = this.requireTenant(ctx);
    const rows = await this.tenants.listMembers(tenantId);
    return {
      data: rows.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        email: m.user.emailNormalized,
        displayName: m.user.displayName,
        userStatus: m.user.status,
        roleKey: m.role.key,
        roleName: m.role.name,
        branchScope: m.branchScope ?? 'ALL',
        membershipStatus: m.status,
        invitedAt: m.invitedAt.toISOString(),
        acceptedAt: m.acceptedAt?.toISOString() ?? null,
      })),
    };
  }

  @Patch('members/:id')
  @RequirePermissions('users:manage')
  async updateMember(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const tenantId = this.requireTenant(ctx);
    const input = UpdateMemberRequestSchema.parse(body);
    if (input.roleKey) {
      await this.rbac.changeMemberRole(tenantId, id, input.roleKey);
    }
    const member = await this.tenants.updateMember(
      tenantId,
      id,
      {
        ...(input.membershipStatus ? { membershipStatus: input.membershipStatus } : {}),
        ...(input.branchScope ? { branchScope: input.branchScope } : {}),
      },
      { userId: ctx.userId, requestId: requestMeta(req).requestId },
    );
    return {
      membershipId: member.id,
      userId: member.user.id,
      email: member.user.emailNormalized,
      displayName: member.user.displayName,
      userStatus: member.user.status,
      roleKey: member.role.key,
      roleName: member.role.name,
      branchScope: member.branchScope ?? 'ALL',
      membershipStatus: member.status,
      invitedAt: member.invitedAt.toISOString(),
      acceptedAt: member.acceptedAt?.toISOString() ?? null,
    };
  }

  @Get('invitations')
  @RequirePermissions('users:manage')
  async listInvitations(@CurrentAuth() ctx: RequestAuthContext) {
    const tenantId = this.requireTenant(ctx);
    return { data: await this.tenants.listInvitations(tenantId) };
  }

  @Post('invitations')
  @RequirePermissions('users:manage')
  async createInvitation(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const tenantId = this.requireTenant(ctx);
    const input = CreateInvitationRequestSchema.parse(body);
    try {
      const created = await this.tenants.createInvitation(tenantId, input, {
        userId: ctx.userId,
        ...requestMeta(req),
      });
      return {
        invitationId: created.invitationId,
        inviteToken: created.inviteToken,
        expiresAt: created.expiresAt.toISOString(),
      };
    } catch (error) {
      throw this.mapPlanLimit(error);
    }
  }

  @Delete('invitations/:id')
  @RequirePermissions('users:manage')
  async revokeInvitation(
    @Param('id') id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const tenantId = this.requireTenant(ctx);
    return this.tenants.revokeInvitation(tenantId, id, {
      userId: ctx.userId,
      requestId: requestMeta(req).requestId,
    });
  }

  @Get('audit-logs')
  @RequirePermissions('audit:view')
  async listAuditLogs(
    @CurrentAuth() ctx: RequestAuthContext,
    @Query() query: Record<string, string | undefined>,
  ) {
    const tenantId = this.requireTenant(ctx);
    const parsed = ListQuerySchema.parse(query ?? {});
    const [rows, total] = await Promise.all([
      this.audit.listForTenant(tenantId, parsed.page, parsed.pageSize),
      this.audit.countForTenant(tenantId),
    ]);
    return {
      data: rows.map((r) => ({
        auditLogId: r.id,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        actorType: r.actorType,
        actorId: r.actorId,
        requestId: r.requestId,
        occurredAt: r.occurredAt.toISOString(),
      })),
      pageInfo: { total, page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  private requireTenant(ctx: RequestAuthContext): string {
    if (!ctx.tenantId) {
      throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
    }
    return ctx.tenantId;
  }

  private mapPlanLimit(error: unknown): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'PlanLimitExceededError'
    ) {
      const e = error as unknown as { key: string; limit: number };
      return new ForbiddenException({
        message: `Plan limiti aşıldı (${e.key === 'max_users' ? 'kullanıcı' : 'şube'} limiti: ${e.limit}) — planınızı yükseltin`,
        code: 'PLAN_LIMIT_EXCEEDED',
      });
    }
    return error;
  }
}

function actorMeta(ctx: RequestAuthContext, req: Request) {
  return {
    userId: ctx.userId,
    requestId:
      typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
    ip: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}

function requestMeta(req: Request) {
  return {
    requestId:
      typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined,
    ip: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}
