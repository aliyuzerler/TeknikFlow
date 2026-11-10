import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { ExecutionController } from './execution.controller.js';
import { ExecutionService } from './execution.service.js';
import { MediaService } from './media.service.js';
import { SignatureService } from './signature.service.js';
import { IdempotencyService } from './idempotency.service.js';

/**
 * Faz 08 — saha yürütme: checklist, GPS kilometre taşları (geçiş ucunda),
 * süre kayıtları, medya (ADR-0005 iki adımlı), imza (ekle-güncelle-yok),
 * idempotency ve yürütme raporu.
 *
 * Depolama (S3Client) global StorageModule'dan; audit global AuditModule'dan.
 */
@Module({
  imports: [AuthModule],
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    MediaService,
    SignatureService,
    IdempotencyService,
    PermissionsGuard,
  ],
  exports: [ExecutionService, IdempotencyService],
})
export class ExecutionModule {}
