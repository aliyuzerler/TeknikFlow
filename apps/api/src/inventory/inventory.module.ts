import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { WorkOrderPartsController } from './work-order-parts.controller.js';
import { WorkOrderPartsService } from './work-order-parts.service.js';
import { IdempotencyService } from '../execution/idempotency.service.js';

/**
 * Faz 09 — stok modülü: katalog, depolar/raflar, append-only hareketler,
 * bakiye, rezervasyonlar, sayım ve iş emri parça tüketimi (ADR-0011).
 *
 * IdempotencyService Faz 08 altyapısının aynısıdır (aynı tablo); burada
 * da sağlanır — ExecutionModule'a modül bağımlılığı kurulmaz (döngü yok).
 * AuthModule: guard zincirinin JwtService bağımlılığı için zorunlu.
 */
@Module({
  imports: [AuthModule],
  controllers: [InventoryController, WorkOrderPartsController],
  providers: [InventoryService, WorkOrderPartsService, IdempotencyService, PermissionsGuard],
  exports: [InventoryService, WorkOrderPartsService],
})
export class InventoryModule {}
