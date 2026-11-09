import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RbacService } from './rbac.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [RbacController],
  providers: [PermissionsGuard, RbacService],
  exports: [PermissionsGuard, RbacService],
})
export class RbacModule {}
