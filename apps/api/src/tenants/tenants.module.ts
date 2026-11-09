import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { TenantsService } from './tenants.service.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';

@Module({
  imports: [AuthModule, RbacModule, AuditModule, EntitlementsModule],
  controllers: [TenantsController, InvitationsController],
  providers: [TenantsService, PermissionsGuard],
})
export class TenantsModule {}
