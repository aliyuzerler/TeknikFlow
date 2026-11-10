import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { ExecutionController } from './execution.controller.js';
import { ExecutionService } from './execution.service.js';
import { MediaService } from './media.service.js';

/**
 * Faz 08 — saha yürütme: checklist, işçilik, GPS ziyaretleri, medya
 * (iki adımlı yükleme), imza ve rapor önizlemesi. S3 istemcisi global
 * StorageModule'dan enjekte edilir.
 */
@Module({
  imports: [AuthModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, MediaService, PermissionsGuard],
  exports: [ExecutionService],
})
export class ExecutionModule {}
