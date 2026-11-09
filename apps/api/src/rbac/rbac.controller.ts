import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CreateRoleRequestSchema } from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RbacService } from './rbac.service.js';
import type { RequestAuthContext } from '../auth/auth-context.js';

/**
 * Faz 03 — /api/v1/rbac uçları: izin kataloğu ve özel roller.
 */
@Controller('rbac')
@UseGuards(AuthGuard, PermissionsGuard)
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  @RequirePermissions('roles:manage')
  async listPermissions() {
    const rows = await this.rbac.listPermissions();
    return {
      data: rows.map((p) => ({ key: p.key, description: p.description, category: p.category })),
    };
  }

  @Get('roles')
  @RequirePermissions('roles:manage')
  async listRoles(@CurrentAuth() ctx: RequestAuthContext) {
    if (!ctx.tenantId) return { data: [] };
    const rows = await this.rbac.listRolesForTenant(ctx.tenantId);
    return {
      data: rows.map((r) => ({
        roleId: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: r.rolePermissions.map((rp) => rp.permissionKey),
      })),
    };
  }

  @Post('roles')
  @RequirePermissions('roles:manage')
  async createRole(@Body() body: unknown, @CurrentAuth() ctx: RequestAuthContext) {
    if (!ctx.tenantId) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
    }
    const input = CreateRoleRequestSchema.parse(body);
    const role = await this.rbac.createCustomRole(ctx.tenantId, input);
    return {
      roleId: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.rolePermissions.map((rp) => rp.permissionKey),
    };
  }
}
