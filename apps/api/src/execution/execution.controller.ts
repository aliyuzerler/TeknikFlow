import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CompleteChecklistItemRequestSchema,
  CreateChecklistItemRequestSchema,
  CreateTimeEntryRequestSchema,
  EXECUTION_IDEMPOTENCY_HEADER,
  InitMediaUploadRequestSchema,
  StopTimeEntryRequestSchema,
  CaptureSignatureRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { ExecutionService } from './execution.service.js';
import { MediaService } from './media.service.js';
import { SignatureService } from './signature.service.js';

/**
 * Faz 08 — /api/v1/work-orders/:id yürütme uçları: checklist, süre
 * kayıtları, medya (iki adımlı), imza ve yürütme raporu.
 *
 * Mutasyonlar x-idempotency-key başlığıyla tekrar-güvenli: sunucu aynı
 * (kiracı, kullanıcı, anahtar) üçlüsü için saklanan kanonik yanıtı oynatır
 * (yanıt başlığı: x-idempotent-replay: true). Mobil outbox her işlem için
 * UUID anahtar üretir (uçak modu kurtarma, çift dokunuş).
 */
@Controller('work-orders')
@UseGuards(AuthGuard, PermissionsGuard)
export class ExecutionController {
  constructor(
    private readonly execution: ExecutionService,
    private readonly media: MediaService,
    private readonly signatures: SignatureService,
  ) {}

  // ------------------------- Checklist -------------------------

  @Post(':id/checklist-items')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch', 'work_orders:complete')
  async addChecklistItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = CreateChecklistItemRequestSchema.parse(body ?? {});
    const outcome = await this.execution.addChecklistItem(
      requireTenant(ctx),
      id,
      input,
      actor(ctx, req),
      { idempotencyKey: idempotencyKey(req) },
    );
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Get(':id/checklist-items')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listChecklistItems(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const data = await this.execution.listChecklistItems(requireTenant(ctx), id, viewer(ctx));
    return { data };
  }

  @Patch(':id/checklist-items/:itemId')
  @RequirePermissions('work_orders:complete')
  async completeChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = CompleteChecklistItemRequestSchema.parse(body ?? {});
    const outcome = await this.execution.completeChecklistItem(
      requireTenant(ctx),
      id,
      itemId,
      input,
      actor(ctx, req),
      { idempotencyKey: idempotencyKey(req) },
    );
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  // ------------------------- Süre kayıtları -------------------------

  @Post(':id/time-entries')
  @RequirePermissions('work_orders:complete')
  async createTimeEntry(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = CreateTimeEntryRequestSchema.parse(body ?? {});
    const outcome = await this.execution.createTimeEntry(
      requireTenant(ctx),
      id,
      input,
      actor(ctx, req),
      { idempotencyKey: idempotencyKey(req) },
    );
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Post(':id/time-entries/:entryId/stop')
  @RequirePermissions('work_orders:complete')
  async stopTimeEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = StopTimeEntryRequestSchema.parse(body ?? {});
    const outcome = await this.execution.stopTimeEntry(
      requireTenant(ctx),
      id,
      entryId,
      input,
      actor(ctx, req),
      { idempotencyKey: idempotencyKey(req) },
    );
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Get(':id/time-entries')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listTimeEntries(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const data = await this.execution.listTimeEntries(requireTenant(ctx), id, viewer(ctx));
    return { data };
  }

  // ------------------------- Medya (ADR-0005) -------------------------

  @Post(':id/media')
  @RequirePermissions('work_orders:complete')
  async initMediaUpload(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = InitMediaUploadRequestSchema.parse(body ?? {});
    const outcome = await this.media.initUpload(requireTenant(ctx), id, input, actor(ctx, req), {
      idempotencyKey: idempotencyKey(req),
    });
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Post(':id/media/:mediaId/complete')
  @RequirePermissions('work_orders:complete')
  async completeMediaUpload(
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.media.completeUpload(
      requireTenant(ctx),
      id,
      mediaId,
      actor(ctx, req),
      { idempotencyKey: idempotencyKey(req) },
    );
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Get(':id/media')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listMedia(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const data = await this.media.listMedia(requireTenant(ctx), id, viewer(ctx));
    return { data };
  }

  // ------------------------- İmza -------------------------

  @Post(':id/signatures')
  @RequirePermissions('signature:capture')
  async captureSignature(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = CaptureSignatureRequestSchema.parse(body ?? {});
    const outcome = await this.signatures.capture(requireTenant(ctx), id, input, actor(ctx, req), {
      idempotencyKey: idempotencyKey(req),
    });
    if (outcome.replayed) res.setHeader('x-idempotent-replay', 'true');
    return outcome.body;
  }

  @Get(':id/signatures')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listSignatures(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const data = await this.signatures.list(requireTenant(ctx), id, viewer(ctx));
    return { data };
  }

  // ------------------------- Rapor -------------------------

  @Get(':id/report')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async report(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return this.execution.getReport(requireTenant(ctx), id, viewer(ctx));
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

function idempotencyKey(req: Request): string | undefined {
  const value = headerString(req, EXECUTION_IDEMPOTENCY_HEADER);
  if (value === undefined) return undefined;
  // UUID biçimi dışı anahtarlar yok sayılır (sözleşme: UUID v4).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_RE.test(value) ? value.toLowerCase() : undefined;
}
