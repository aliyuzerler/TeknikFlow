import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BalanceListQuerySchema,
  CreateBinRequestSchema,
  CreateMovementRequestSchema,
  CreateReservationRequestSchema,
  CreateStockCountRequestSchema,
  CreateStockItemRequestSchema,
  CreateWarehouseRequestSchema,
  MovementListQuerySchema,
  ReleaseReservationRequestSchema,
  StockItemListQuerySchema,
  SubmitCountLineRequestSchema,
  UpdateStockItemRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  CurrentAuth,
  RequireAnyPermissions,
  RequirePermissions,
} from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { InventoryService } from './inventory.service.js';

/**
 * Faz 09 — /api/v1/inventory uçları: SKU kataloğu, depolar/raflar,
 * append-only stok hareketleri, bakiye, rezervasyonlar ve sayım.
 *
 * Yetki matrisi (ROLES_PERMISSIONS.md):
 *  - Okuma: stock:view
 *  - Katalog/depo/hareket/rezervasyon/sayım yazma: stock:manage
 *  - stock:manage_limited (planlamacı): RECEIVE/TRANSFER/ISSUE/RETURN —
 *    ADJUSTMENT ayrıca serviste stock:manage ister (Limited satırı).
 *  - CONSUME burada YASAK — yalnız /work-orders/:id/parts (atomik).
 *
 * Mutasyonlar x-idempotency-key taşır; hareket satırı ayrıca
 * movementKey tekil kısıtıyla çift-yazma emniyetine sahiptir.
 */
@Controller('inventory')
@UseGuards(AuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // ------------------------- Katalog -------------------------

  @Post('items')
  @RequirePermissions('stock:manage')
  async createItem(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateStockItemRequestSchema.parse(body ?? {});
    return this.inventory.createItem(requireTenant(ctx), input, actor(ctx, req));
  }

  @Get('items')
  @RequirePermissions('stock:view')
  async listItems(@Query() query: unknown, @CurrentAuth() ctx: RequestAuthContext) {
    const parsed = StockItemListQuerySchema.parse(query ?? {});
    return this.inventory.listItems(requireTenant(ctx), parsed);
  }

  @Get('items/:itemId')
  @RequirePermissions('stock:view')
  async getItem(@Param('itemId') itemId: string, @CurrentAuth() ctx: RequestAuthContext) {
    return this.inventory.listItem(requireTenant(ctx), itemId);
  }

  @Patch('items/:itemId')
  @RequirePermissions('stock:manage')
  async updateItem(
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateStockItemRequestSchema.parse(body ?? {});
    return this.inventory.updateItem(requireTenant(ctx), itemId, input, actor(ctx, req));
  }

  // ------------------------- Depo / raf -------------------------

  @Post('warehouses')
  @RequirePermissions('stock:manage')
  async createWarehouse(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateWarehouseRequestSchema.parse(body ?? {});
    return this.inventory.createWarehouse(requireTenant(ctx), input, actor(ctx, req));
  }

  @Get('warehouses')
  @RequirePermissions('stock:view')
  async listWarehouses(@CurrentAuth() ctx: RequestAuthContext) {
    return this.inventory.listWarehouses(requireTenant(ctx));
  }

  @Post('warehouses/:warehouseId/bins')
  @RequirePermissions('stock:manage')
  async createBin(
    @Param('warehouseId') warehouseId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateBinRequestSchema.parse(body ?? {});
    return this.inventory.createBin(requireTenant(ctx), warehouseId, input, actor(ctx, req));
  }

  @Get('warehouses/:warehouseId/bins')
  @RequirePermissions('stock:view')
  async listBins(
    @Param('warehouseId') warehouseId: string,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    return this.inventory.listBins(requireTenant(ctx), warehouseId);
  }

  // ------------------------- Hareketler -------------------------

  @Post('movements')
  @RequireAnyPermissions('stock:manage', 'stock:manage_limited')
  async createMovement(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = CreateMovementRequestSchema.parse(body ?? {});
    const outcome = await this.inventory.createMovement(
      requireTenant(ctx),
      input,
      actor(ctx, req),
    );
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Get('movements')
  @RequirePermissions('stock:view')
  async listMovements(@Query() query: unknown, @CurrentAuth() ctx: RequestAuthContext) {
    const parsed = MovementListQuerySchema.parse(query ?? {});
    return this.inventory.listMovements(requireTenant(ctx), parsed);
  }

  @Get('movements/:movementId')
  @RequirePermissions('stock:view')
  async getMovement(
    @Param('movementId') movementId: string,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    return this.inventory.getMovement(requireTenant(ctx), movementId);
  }

  @Get('balances')
  @RequirePermissions('stock:view')
  async listBalances(@Query() query: unknown, @CurrentAuth() ctx: RequestAuthContext) {
    const parsed = BalanceListQuerySchema.parse(query ?? {});
    return this.inventory.listBalances(requireTenant(ctx), parsed, viewer(ctx));
  }

  // ------------------------- Rezervasyon -------------------------

  @Post('reservations')
  @RequireAnyPermissions('stock:manage', 'stock:manage_limited')
  async createReservation(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateReservationRequestSchema.parse(body ?? {});
    return this.inventory.createReservation(requireTenant(ctx), input, actor(ctx, req));
  }

  @Get('reservations')
  @RequirePermissions('stock:view')
  async listReservations(
    @Query('workOrderId') workOrderId: string | undefined,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    return this.inventory.listReservations(requireTenant(ctx), workOrderId);
  }

  @Post('reservations/:reservationId/release')
  @RequireAnyPermissions('stock:manage', 'stock:manage_limited')
  @HttpCode(200)
  async releaseReservation(
    @Param('reservationId') reservationId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    ReleaseReservationRequestSchema.parse(body ?? {});
    return this.inventory.releaseReservation(requireTenant(ctx), reservationId, actor(ctx, req));
  }

  // ------------------------- Sayım -------------------------

  @Post('counts')
  @RequirePermissions('stock:manage')
  async createCount(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateStockCountRequestSchema.parse(body ?? {});
    return this.inventory.createCount(requireTenant(ctx), input, actor(ctx, req));
  }

  @Get('counts')
  @RequirePermissions('stock:view')
  async listCounts(@CurrentAuth() ctx: RequestAuthContext) {
    return this.inventory.listCounts(requireTenant(ctx));
  }

  @Get('counts/:countId/lines')
  @RequirePermissions('stock:view')
  async listCountLines(
    @Param('countId') countId: string,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    return this.inventory.listCountLines(requireTenant(ctx), countId);
  }

  @Post('counts/:countId/lines')
  @RequirePermissions('stock:manage')
  async submitCountLine(
    @Param('countId') countId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = SubmitCountLineRequestSchema.parse(body ?? {});
    return this.inventory.submitCountLine(requireTenant(ctx), countId, input, actor(ctx, req));
  }

  @Post('counts/:countId/close')
  @RequirePermissions('stock:manage')
  @HttpCode(200)
  async closeCount(
    @Param('countId') countId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    void body; // gövdesiz eylem ucu
    return this.inventory.closeCount(requireTenant(ctx), countId, actor(ctx, req));
  }
}

// ------------------------- Yardımcılar -------------------------

function requireTenant(ctx: RequestAuthContext): string {
  if (!ctx.tenantId) {
    throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
  }
  return ctx.tenantId;
}

function actor(ctx: RequestAuthContext, req: Request) {
  return {
    userId: ctx.userId,
    requestId: headerString(req, 'x-request-id'),
    permissions: ctx.permissions,
  };
}

function viewer(ctx: RequestAuthContext) {
  return { userId: ctx.userId, permissions: ctx.permissions };
}

function headerString(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}
