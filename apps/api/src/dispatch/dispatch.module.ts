import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller.js';
import { TeamsController } from './teams.controller.js';
import { DispatchService } from './dispatch.service.js';
import { ServiceModule } from '../service/service.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';

/** Faz 06 — dispatch: pano, müsaitlik, çakışma, planlama, takımlar. */
@Module({
  imports: [AuthModule, ServiceModule],
  controllers: [DispatchController, TeamsController],
  providers: [DispatchService, PermissionsGuard],
})
export class DispatchModule {}
