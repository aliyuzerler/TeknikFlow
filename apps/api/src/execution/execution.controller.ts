import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NotFoundException } from '@nestjs/common';
import {
  AttachmentInitSchema,
  ChecklistItemCreateSchema,
  ChecklistResponsesUpdateSchema,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  IdempotencyKeySchema,
  LaborEntryCreateSchema,
  SignatureCaptureSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { ExecutionService } from './execution.service.js';
import { MediaService } from './media.service.js';

/**
 * Faz 08 — /api/v1/work-orders/:id/* yürütme uçları: checklist, işçilik,
 * ziyaretler, medya (init/complete), imza ve rapor önizlemesi.
 *
 * Okuma: view_all VEYA view_assigned (kaynak düzeyi denetim servislerde).
 * Yazma: create/dispatch (ofis) VEYA complete + aktif atama (teknisyen).
 * Tekrarlanabilir POST'lar Idempotency-Key başlığıyla servis transaction'ı
 * içinde tekilleştirilir; tekrarda Idempotency-Replayed: true döner
 * (mobil outbox "duplicate sync" kabul kriteri).
 */
@Controller('work-orders')
@UseGuards(AuthGuard, PermissionsGuard)
export class ExecutionController {
  constructor(
    private readonly execution: ExecutionService,
    private readonly media: MediaService,
  ) {}

  // ------------------------- Ziyaretler -------------------------

  @Get(':id/visits')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listVisits(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return {
      data: await this.execution.listVisits(requireTenant(ctx), id, {
        userId: ctx.userId,
        permissions: ctx.permissions,
      }),
    };
  }

  // ------------------------- Checklist -------------------------

  @Get(':id/checklist')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listChecklist(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return {
      data: await this.execution.listChecklist(requireTenant(ctx), id, {
        userId: ctx.userId,
        permissions: ctx.permissions,
      }),
    };
  }

  @Post(':id/checklist/items')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch', 'work_orders:complete')
  async createChecklistItem(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const input = ChecklistItemCreateSchema.parse(body);
    return this.execution.createChecklistItem(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      permissions: ctx.permissions,
    });
  }

  @Post(':id/checklist/responses')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch', 'work_orders:complete')
  async updateChecklistResponses(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = ChecklistResponsesUpdateSchema.parse(body);
    const { body: view, replayed } = await this.execution.updateChecklistResponses(
      requireTenant(ctx),
      id,
      input,
      {
        userId: ctx.userId,
        permissions: ctx.permissions,
        requestId: headerString(req),
      },
      idempotencyKey(req),
    );
    markReplayed(res, replayed);
    return { data: view };
  }

  // ------------------------- İşçilik -------------------------

  @Get(':id/labor')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listLabor(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return {
      data: await this.execution.listLabor(requireTenant(ctx), id, {
        userId: ctx.userId,
        permissions: ctx.permissions,
      }),
    };
  }

  @Post(':id/labor')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch', 'work_orders:complete')
  async createLaborEntry(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = LaborEntryCreateSchema.parse(body);
    const { body: view, replayed } = await this.execution.createLaborEntry(
      requireTenant(ctx),
      id,
      input,
      {
        userId: ctx.userId,
        permissions: ctx.permissions,
        requestId: headerString(req),
      },
      idempotencyKey(req),
    );
    markReplayed(res, replayed);
    return view;
  }

  // ------------------------- Medya -------------------------

  @Get(':id/attachments')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listAttachments(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return {
      data: await this.media.listAttachments(requireTenant(ctx), id, {
        userId: ctx.userId,
        permissions: ctx.permissions,
      }),
    };
  }

  @Post(':id/attachments/init')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch', 'work_orders:complete')
  async initAttachment(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = AttachmentInitSchema.parse(body);
    const { body: view, replayed } = await this.media.initAttachment(
      requireTenant(ctx),
      id,
      input,
      {
        userId: ctx.userId,
        permissions: ctx.permissions,
        requestId: headerString(req),
      },
      idempotencyKey(req),
    );
    markReplayed(res, replayed);
    return view;
  }

  @Post(':id/attachments/:attachmentId/complete')
  @RequireAnyPermissions('work_orders:create', 'work_orders:dispatch', 'work_orders:complete')
  async completeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body: view, replayed } = await this.media.completeAttachment(
      requireTenant(ctx),
      id,
      attachmentId,
      {
        userId: ctx.userId,
        permissions: ctx.permissions,
        requestId: headerString(req),
      },
      idempotencyKey(req),
    );
    markReplayed(res, replayed);
    return view;
  }

  // ------------------------- İmza -------------------------

  @Get(':id/signatures')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async listSignatures(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return {
      data: await this.execution.listSignatures(requireTenant(ctx), id, {
        userId: ctx.userId,
        permissions: ctx.permissions,
      }),
    };
  }

  @Post(':id/signatures')
  @RequireAnyPermissions('signature:capture', 'work_orders:complete')
  async captureSignature(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = SignatureCaptureSchema.parse(body);
    const { body: view, replayed } = await this.execution.captureSignature(
      requireTenant(ctx),
      id,
      input,
      {
        userId: ctx.userId,
        permissions: ctx.permissions,
        requestId: headerString(req),
      },
      idempotencyKey(req),
    );
    markReplayed(res, replayed);
    return view;
  }

  // ------------------------- Rapor -------------------------

  @Get(':id/report')
  @RequireAnyPermissions('work_orders:view_all', 'work_orders:view_assigned')
  async reportPreview(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    return this.execution.buildReportPreview(requireTenant(ctx), id, {
      userId: ctx.userId,
      permissions: ctx.permissions,
    });
  }
}

function requireTenant(ctx: RequestAuthContext): string {
  if (!ctx.tenantId) {
    throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
  }
  return ctx.tenantId;
}

function idempotencyKey(req: Request): string | undefined {
  const raw = headerString(req, IDEMPOTENCY_KEY_HEADER);
  if (raw === undefined) return undefined;
  return IdempotencyKeySchema.parse(raw);
}

function markReplayed(res: Response, replayed: boolean): void {
  if (replayed) res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
}

function headerString(req: Request, name = 'x-request-id'): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}
