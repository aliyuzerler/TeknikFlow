import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { RequestsService } from './requests.service.js';
import { WorkOrdersService } from './work-orders.service.js';
import { ScheduleConflictService } from './schedule-conflict.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';

/** Faz 05 — servis akışı: intake + iş emri yaşam döngüsü.
 * Faz 06 — planlama çakışma koruyucusu (dispatch modülü de kullanır). */
@Module({
  imports: [AuthModule],
  controllers: [RequestsController, WorkOrdersController],
  providers: [RequestsService, WorkOrdersService, ScheduleConflictService, PermissionsGuard],
  exports: [WorkOrdersService, ScheduleConflictService],
})
export class ServiceModule {}
