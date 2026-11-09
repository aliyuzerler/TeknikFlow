import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { S3Client } from '@aws-sdk/client-s3';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { writeEvent } from './customers.service.js';
import { generateAssetTag } from './crm-utils.js';
import { getEnv } from '../config/env.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 04 — varlık (ekipman) servisi: kayıt, arama, hiyerarşi, geçmiş,
 * doküman meta verisi + imzalı URL'ler, QR kod.
 *
 * Kiracı içi ilişki doğrulaması servis katmanında yapılır (customer/location/
 * parent aynı kiracıda olmalı — FK RLS'i atlayabilir).
 */
const ASSET_INCLUDE = {
  customer: { select: { name: true } },
  serviceLocation: { select: { name: true } },
  _count: { select: { documents: true } },
} as const;

@Injectable()
export class AssetsService {
  private readonly s3: S3Client;

  constructor(private readonly scoped: TenantScopedPrismaService) {
    const env = getEnv();
    this.s3 = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  // ------------------------- Liste / arama -------------------------

  async listAssets(
    tenantId: string,
    query: {
      q?: string;
      customerId?: string;
      serviceLocationId?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
      criticality?: 'LOW' | 'MEDIUM' | 'HIGH';
      page: number;
      pageSize: number;
      sort?: string;
    },
  ) {
    const where: Prisma.AssetWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.criticality ? { criticality: query.criticality } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.serviceLocationId ? { serviceLocationId: query.serviceLocationId } : {}),
      ...(query.q
        ? {
            OR: [
              { assetTag: { contains: query.q.trim().toUpperCase() } },
              { serialNumber: { contains: query.q.trim(), mode: 'insensitive' } },
              { manufacturer: { contains: query.q.trim(), mode: 'insensitive' } },
              { model: { contains: query.q.trim(), mode: 'insensitive' } },
              { customer: { nameNormalized: { contains: query.q.trim().toUpperCase() } } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.AssetOrderByWithRelationInput =
      query.sort === 'createdAt'
        ? { createdAt: 'desc' }
        : query.sort === 'manufacturer'
          ? { manufacturer: 'asc' }
          : { assetTag: 'asc' };

    return this.scoped.withTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.asset.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: ASSET_INCLUDE,
        }),
        tx.asset.count({ where }),
      ]);
      return { rows, total };
    });
  }

  async getAsset(tenantId: string, assetId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: assetId, tenantId },
        include: { ...ASSET_INCLUDE, parentAsset: { select: { assetTag: true } } },
      });
      if (!asset) {
        throw new NotFoundException({ message: 'Varlık bulunamadı', code: 'NOT_FOUND' });
      }
      return asset;
    });
  }

  async getAssetByTag(tenantId: string, assetTag: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { tenantId, assetTag: assetTag.toUpperCase() },
        include: ASSET_INCLUDE,
      });
      if (!asset) {
        throw new NotFoundException({ message: 'Varlık bulunamadı', code: 'NOT_FOUND' });
      }
      return asset;
    });
  }

  // ------------------------- Oluşturma / güncelleme -------------------------

  async createAsset(
    tenantId: string,
    input: {
      customerId: string;
      serviceLocationId?: string;
      parentAssetId?: string;
      assetTag?: string;
      serialNumber?: string;
      manufacturer?: string;
      model?: string;
      installedAt?: string;
      warrantyUntil?: string;
      criticality: 'LOW' | 'MEDIUM' | 'HIGH';
      metadata?: Record<string, unknown>;
    },
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      // Kiracı içi ilişki doğrulaması (FK RLS'i atlar — servis şart).
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId } });
      if (!customer) {
        throw new NotFoundException({ message: 'Müşteri bulunamadı', code: 'NOT_FOUND' });
      }
      if (input.serviceLocationId) {
        const location = await tx.serviceLocation.findFirst({
          where: { id: input.serviceLocationId, tenantId },
        });
        if (!location) {
          throw new NotFoundException({ message: 'Lokasyon bulunamadı', code: 'NOT_FOUND' });
        }
      }
      if (input.parentAssetId) {
        const parent = await tx.asset.findFirst({ where: { id: input.parentAssetId, tenantId } });
        if (!parent) {
          throw new NotFoundException({ message: 'Üst varlık bulunamadı', code: 'NOT_FOUND' });
        }
      }

      // Etiket: verildiyse teklik; verilmediyse üretilene kadar dene.
      let assetTag = input.assetTag?.toUpperCase();
      if (!assetTag) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const candidate = generateAssetTag();
          const taken = await tx.asset.findFirst({ where: { tenantId, assetTag: candidate } });
          if (!taken) {
            assetTag = candidate;
            break;
          }
        }
      }
      if (!assetTag) {
        throw new ConflictException({ message: 'Etiket üretilemedi', code: 'ASSET_TAG_TAKEN' });
      }
      const tagDuplicate = await tx.asset.findFirst({ where: { tenantId, assetTag } });
      if (tagDuplicate) {
        throw new ConflictException({
          message: 'Bu varlık etiketi kiracı içinde kullanımda',
          code: 'ASSET_TAG_TAKEN',
          assetId: tagDuplicate.id,
        });
      }
      if (input.serialNumber) {
        const serialDuplicate = await tx.asset.findFirst({
          where: { tenantId, serialNumber: input.serialNumber },
        });
        if (serialDuplicate) {
          throw new ConflictException({
            message: 'Bu seri numarası kiracı içinde kayıtlı',
            code: 'SERIAL_TAKEN',
            assetId: serialDuplicate.id,
          });
        }
      }

      const asset = await tx.asset.create({
        data: {
          tenantId,
          customerId: input.customerId,
          ...(input.serviceLocationId ? { serviceLocationId: input.serviceLocationId } : {}),
          ...(input.parentAssetId ? { parentAssetId: input.parentAssetId } : {}),
          assetTag,
          ...(input.serialNumber ? { serialNumber: input.serialNumber } : {}),
          ...(input.manufacturer ? { manufacturer: input.manufacturer } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.installedAt ? { installedAt: new Date(input.installedAt) } : {}),
          ...(input.warrantyUntil ? { warrantyUntil: new Date(input.warrantyUntil) } : {}),
          criticality: input.criticality,
          ...(input.metadata ? { metadataJson: input.metadata as Prisma.InputJsonValue } : {}),
          createdById: actor.userId,
        },
      });

      await writeEvent(tx, {
        tenantId,
        customerId: input.customerId,
        assetId: asset.id,
        eventType: 'asset.created',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { assetTag, manufacturer: input.manufacturer, model: input.model },
      });
      return tx.asset.findUniqueOrThrow({ where: { id: asset.id }, include: ASSET_INCLUDE });
    });
  }

  async updateAsset(
    tenantId: string,
    assetId: string,
    input: {
      serviceLocationId?: string | null;
      manufacturer?: string | null;
      model?: string | null;
      serialNumber?: string | null;
      installedAt?: string | null;
      warrantyUntil?: string | null;
      status?: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
      criticality?: 'LOW' | 'MEDIUM' | 'HIGH';
    },
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.asset.findFirst({ where: { id: assetId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Varlık bulunamadı', code: 'NOT_FOUND' });
      }
      if (input.serviceLocationId) {
        const location = await tx.serviceLocation.findFirst({
          where: { id: input.serviceLocationId, tenantId },
        });
        if (!location) {
          throw new NotFoundException({ message: 'Lokasyon bulunamadı', code: 'NOT_FOUND' });
        }
      }
      if (input.serialNumber && input.serialNumber !== existing.serialNumber) {
        const serialDuplicate = await tx.asset.findFirst({
          where: { tenantId, serialNumber: input.serialNumber },
        });
        if (serialDuplicate && serialDuplicate.id !== assetId) {
          throw new ConflictException({
            message: 'Bu seri numarası kiracı içinde kayıtlı',
            code: 'SERIAL_TAKEN',
          });
        }
      }

      await tx.asset.update({
        where: { id: assetId },
        data: {
          ...(input.serviceLocationId !== undefined
            ? { serviceLocationId: input.serviceLocationId }
            : {}),
          ...(input.manufacturer !== undefined ? { manufacturer: input.manufacturer } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
          ...(input.installedAt !== undefined
            ? { installedAt: input.installedAt ? new Date(input.installedAt) : null }
            : {}),
          ...(input.warrantyUntil !== undefined
            ? { warrantyUntil: input.warrantyUntil ? new Date(input.warrantyUntil) : null }
            : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.criticality ? { criticality: input.criticality } : {}),
        },
      });

      // Durum/lokasyon değişimleri ayrı olay türleriyle anlatılır.
      const events: string[] = [];
      if (input.status && input.status !== existing.status) {
        events.push(`asset.status_changed:${existing.status}:${input.status}`);
      }
      if (
        input.serviceLocationId !== undefined &&
        input.serviceLocationId !== existing.serviceLocationId
      ) {
        events.push('asset.location_changed');
      }
      if (events.length === 0) events.push('asset.updated');

      for (const eventType of events) {
        await writeEvent(tx, {
          tenantId,
          customerId: existing.customerId,
          assetId,
          eventType,
          actorId: actor.userId,
          requestId: actor.requestId,
          metadata: { fields: Object.keys(input) },
        });
      }
      return tx.asset.findUniqueOrThrow({ where: { id: assetId }, include: ASSET_INCLUDE });
    });
  }

  /** Silme = emeklilik (RETIRED) — geçmiş ve dokümanlar korunur. */
  async retireAsset(
    tenantId: string,
    assetId: string,
    actor: { userId: string; requestId?: string },
  ) {
    return this.updateAsset(tenantId, assetId, { status: 'RETIRED' }, actor);
  }

  // ------------------------- Geçmiş -------------------------

  async assetHistory(tenantId: string, assetId: string, limit = 100) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireAsset(tx, tenantId, assetId);
      return tx.crmEvent.findMany({
        where: { tenantId, assetId },
        orderBy: { occurredAt: 'desc' },
        take: limit,
      });
    });
  }

  // ------------------------- Dokümanlar -------------------------

  async createDocument(
    tenantId: string,
    assetId: string,
    input: { documentType: string; fileName: string; contentType?: string; sizeBytes?: number },
    actor: { userId: string; requestId?: string },
  ): Promise<{ documentId: string; objectKey: string; uploadUrl: string }> {
    const objectKey = `tenants/${tenantId}/assets/${assetId}/${randomUUID()}`;
    const bucket = getEnv().S3_BUCKET;

    const document = await this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireAsset(tx, tenantId, assetId);
      const created = await tx.assetDocument.create({
        data: {
          tenantId,
          assetId,
          objectKey,
          documentType: input.documentType,
          fileName: input.fileName,
          ...(input.contentType ? { contentType: input.contentType } : {}),
          ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
          uploadedById: actor.userId,
        },
      });
      await writeEvent(tx, {
        tenantId,
        assetId,
        eventType: 'asset.document_added',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { documentType: input.documentType, fileName: input.fileName },
      });
      return created;
    });

    // Yükleme için kısa ömürlü imzalı PUT URL'i (dosya doğrudan obje deposuna).
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 900 },
    );
    return { documentId: document.id, objectKey, uploadUrl };
  }

  async listDocuments(tenantId: string, assetId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireAsset(tx, tenantId, assetId);
      return tx.assetDocument.findMany({
        where: { tenantId, assetId },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async documentDownloadUrl(
    tenantId: string,
    assetId: string,
    documentId: string,
  ): Promise<string> {
    const document = await this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireAsset(tx, tenantId, assetId);
      return tx.assetDocument.findFirst({ where: { id: documentId, tenantId, assetId } });
    });
    if (!document) {
      throw new NotFoundException({ message: 'Doküman bulunamadı', code: 'NOT_FOUND' });
    }
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: document.objectKey }),
      { expiresIn: 300 },
    );
  }

  async deleteDocument(
    tenantId: string,
    assetId: string,
    documentId: string,
    actor: { userId: string; requestId?: string },
  ) {
    const document = await this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireAsset(tx, tenantId, assetId);
      const found = await tx.assetDocument.findFirst({
        where: { id: documentId, tenantId, assetId },
      });
      if (!found) {
        throw new NotFoundException({ message: 'Doküman bulunamadı', code: 'NOT_FOUND' });
      }
      await tx.assetDocument.delete({ where: { id: documentId } });
      await writeEvent(tx, {
        tenantId,
        assetId,
        eventType: 'asset.document_removed',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { fileName: found.fileName },
      });
      return found;
    });

    // Obje deposundan da sil (best-effort — kayıt zaten kaldırıldı).
    await this.s3
      .send(new DeleteObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: document.objectKey }))
      .catch(() => undefined);
    return { deleted: true };
  }

  // ------------------------- QR -------------------------

  /** Varlık QR kodu (SVG) — derin bağlantı /a/{assetTag}. */
  async assetQrSvg(assetTag: string): Promise<string> {
    const { default: QRCode } = await import('qrcode');
    const env = getEnv();
    const link = `${env.APP_BASE_URL.replace(/\/+$/, '')}/a/${encodeURIComponent(assetTag)}`;
    return QRCode.toString(link, {
      type: 'svg',
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
    });
  }

  private async requireAsset(tx: ScopedClient, tenantId: string, assetId: string): Promise<void> {
    const asset = await tx.asset.findFirst({ where: { id: assetId, tenantId } });
    if (!asset) {
      throw new NotFoundException({ message: 'Varlık bulunamadı', code: 'NOT_FOUND' });
    }
  }
}
