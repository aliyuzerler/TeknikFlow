import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { RequestsService } from './requests.service.js';
import { WorkOrdersService } from './work-orders.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';

/** Faz 05 — servis akışı: intake + iş emri yaşam döngüsü. */
@Module({
  imports: [AuthModule],
  controllers: [RequestsController, WorkOrdersController],
  providers: [RequestsService, WorkOrdersService, PermissionsGuard],
})
export class ServiceModule {}
