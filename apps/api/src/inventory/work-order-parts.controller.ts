import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConsumePartRequestSchema, EXECUTION_IDEMPOTENCY_HEADER } from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { WorkOrderPartsService } from './work-order-parts.service.js';

/**
 * Faz 09 — iş emri parça uçları: /api/v1/work-orders/:id/parts.
 *
 * Tüketim ATOMİKTİR (hareket + bakiye + rezervasyon + iş emri olayı tek
 * transaction) ve x-idempotency-key ile tekrar-güvenlidir — mobil outbox
 * uçak modu kurtarmasında aynı anahtarla TEK tüketim üretir (J2).
 *
 * Kaynak düzeyi yetki servistede: atanmış teknisyen kendi araç stoğundan
 * (stock:issue_own); başka depo ya da adına tüketim stock:manage ister.
 */
@Controller('work-orders')
@UseGuards(AuthGuard, PermissionsGuard)
export class WorkOrderPartsController {
  constructor(private readonly parts: WorkOrderPartsService) {}

  @Post(':id/parts')
  @RequirePermissions('work_orders:complete')
  async consumePart(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = ConsumePartRequestSchema.parse(body ?? {});
    const outcome = await this.parts.consumePart(requireTenant(ctx), id, input, actor(ctx, req), {
      idempotencyKey: idempotencyKey(req),
    });
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Get(':id/parts')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listParts(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const data = await this.parts.listParts(requireTenant(ctx), id, viewer(ctx));
    return { data };
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

/** Faz 08 ile aynı anahtar sözleşmesi: UUID v4 dışı anahtarlar yok sayılır. */
function idempotencyKey(req: Request): string | undefined {
  const value = headerString(req, EXECUTION_IDEMPOTENCY_HEADER);
  if (value === undefined) return undefined;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_RE.test(value) ? value.toLowerCase() : undefined;
}
