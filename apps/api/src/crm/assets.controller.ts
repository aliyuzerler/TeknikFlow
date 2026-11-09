import {
  Body,
  Controller,
  Delete,
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
  AssetListQuerySchema,
  CreateAssetDocumentRequestSchema,
  CreateAssetRequestSchema,
  UpdateAssetRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { AssetsService } from './assets.service.js';

/**
 * Faz 04 — /api/v1/assets uçları: ekipman envanteri, geçmiş, doküman, QR.
 * Okuma: customers:view_all|view_limited (any). Yazma: assets:manage.
 */
@Controller('assets')
@UseGuards(AuthGuard, PermissionsGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async list(
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = AssetListQuerySchema.parse(query ?? {});
    const { rows, total } = await this.assets.listAssets(requireTenant(ctx), parsed);
    return {
      data: rows.map(toAssetView),
      pageInfo: { total, page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  /** QR kodundan gelen çözümleme: etiketle bul (404 = varlık sızıntısı yok). */
  @Get('by-tag/:tag')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async byTag(@Param('tag') tag: string, @CurrentAuth() ctx: RequestAuthContext) {
    const asset = await this.assets.getAssetByTag(requireTenant(ctx), tag);
    return toAssetView(asset);
  }

  @Get(':id')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async get(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const asset = await this.assets.getAsset(requireTenant(ctx), id);
    return toAssetView(asset);
  }

  @Get(':id/history')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async history(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const events = await this.assets.assetHistory(requireTenant(ctx), id);
    return {
      data: events.map((event) => ({
        eventId: event.id,
        customerId: event.customerId,
        assetId: event.assetId,
        assetTag: null,
        eventType: event.eventType,
        actorId: event.actorId,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  /** Varlık QR kodu — SVG (tarayıcıda açılır, mobil Faz 07'de taranır). */
  @Get(':id/qr')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async qr(
    @Param('id') id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const asset = await this.assets.getAsset(requireTenant(ctx), id);
    const svg = await this.assets.assetQrSvg(asset.assetTag);
    res.setHeader('content-type', 'image/svg+xml');
    res.setHeader('cache-control', 'no-store');
    return svg;
  }

  @Post()
  @RequirePermissions('assets:manage')
  async create(@Body() body: unknown, @CurrentAuth() ctx: RequestAuthContext, @Req() req: Request) {
    const input = CreateAssetRequestSchema.parse(body);
    const asset = await this.assets.createAsset(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toAssetView(asset);
  }

  @Patch(':id')
  @RequirePermissions('assets:manage')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateAssetRequestSchema.parse(body);
    const asset = await this.assets.updateAsset(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toAssetView(asset);
  }

  /** Varlık kayıtları kalıcıdır: silme = emeklilik (RETIRED). */
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('assets:manage')
  async retire(
    @Param('id') id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const asset = await this.assets.retireAsset(requireTenant(ctx), id, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { retired: true, assetId: asset.id, status: asset.status };
  }

  // ------------------------- Dokümanlar -------------------------

  @Get(':id/documents')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async listDocuments(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const documents = await this.assets.listDocuments(requireTenant(ctx), id);
    return { data: documents.map(toDocumentView) };
  }

  @Post(':id/documents')
  @RequirePermissions('assets:manage')
  async createDocument(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateAssetDocumentRequestSchema.parse(body);
    return this.assets.createDocument(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Get(':id/documents/:documentId/url')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async documentUrl(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const url = await this.assets.documentDownloadUrl(requireTenant(ctx), id, documentId);
    return { url, expiresIn: 300 };
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(200)
  @RequirePermissions('assets:manage')
  async deleteDocument(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    return this.assets.deleteDocument(requireTenant(ctx), id, documentId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }
}

function requireTenant(ctx: RequestAuthContext): string {
  if (!ctx.tenantId) {
    throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
  }
  return ctx.tenantId;
}

function headerString(req: Request): string | undefined {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' ? value : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma include kombinasyonlarını tek görünümde kabul et
function toAssetView(asset: any) {
  return {
    assetId: asset.id,
    customerId: asset.customerId,
    customerName: asset.customer.name,
    serviceLocationId: asset.serviceLocationId,
    serviceLocationName: asset.serviceLocation?.name ?? null,
    parentAssetId: asset.parentAssetId,
    assetTag: asset.assetTag,
    serialNumber: asset.serialNumber,
    manufacturer: asset.manufacturer,
    model: asset.model,
    installedAt: asset.installedAt?.toISOString() ?? null,
    warrantyUntil: asset.warrantyUntil?.toISOString() ?? null,
    status: asset.status,
    criticality: asset.criticality,
    documentCount: asset._count?.documents ?? 0,
    createdAt: asset.createdAt.toISOString(),
  };
}

function toDocumentView(document: {
  id: string;
  assetId: string;
  documentType: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}) {
  return {
    documentId: document.id,
    assetId: document.assetId,
    documentType: document.documentType,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    createdAt: document.createdAt.toISOString(),
  };
}
