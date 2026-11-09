import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { AssetsController } from './assets.controller.js';
import { CustomersService } from './customers.service.js';
import { AssetsService } from './assets.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, AssetsController],
  providers: [CustomersService, AssetsService, PermissionsGuard],
})
export class CrmModule {}
