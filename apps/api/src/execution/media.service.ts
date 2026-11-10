import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type {
  InitMediaUploadRequest,
  InitMediaUploadResponse,
  MediaObjectView,
} from '@teknikflow/contracts';
import { MEDIA_RULES } from '@teknikflow/contracts';
import { AuditService } from '../audit/audit.service.js';
import { getEnv } from '../config/env.js';
import { S3_CLIENT } from '../storage/storage.module.js';
import { Inject } from '@nestjs/common';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { IdempotencyService, type IdempotencyOutcome } from './idempotency.service.js';
import { detectMime, mimeMatches } from './execution-utils.js';

/**
 * Faz 08 — medya servisi: iki adımlı yükleme (ADR-0005).
 *
 * 1) init    : metadata kaydı (PENDING_UPLOAD) + kısa ömürlü imzalı PUT URL.
 * 2) PUT     : istemci ikiliyi DOĞRUDAN obje deposuna yükler (API'den geçmez).
 * 3) complete: sunucu HEAD + ilk 32 bayt GET ile magic-byte/boyut/MIME
 *              doğrular → READY ya da FAILED (sınıflı kod).
 *
 * Nesne anahtarları opak (kiracı önekli UUID); dosya adı YALNIZCA metadata.
 * SVG beyaz listede yok (script payload yüzeyi). EXIF temizleme ve karantina
 * (malware tarama kancası) worker fazında — QUARANTINED durumu hazır.
 */

const UPLOAD_URL_TTL_SECONDS = 600; // 10 dk
const DOWNLOAD_URL_TTL_SECONDS = 300; // 5 dk
const SNIFF_BYTES = 32;

function notFound(message = 'Medya bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

@Injectable()
export class MediaService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {}

  // ------------------------- 1. adım: init -------------------------

  async initUpload(
    tenantId: string,
    workOrderId: string,
    input: InitMediaUploadRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<InitMediaUploadResponse>> {
    // Beyaz liste: tür → izinli MIME'ler + üst limit.
    const rules = MEDIA_RULES[input.kind];
    if (!rules.mimes.includes(input.contentType)) {
      throw new BadRequestException({
        message: `Bu medya türü için izinli MIME'ler: ${rules.mimes.join(', ')}`,
        code: 'MEDIA_MIME_NOT_ALLOWED',
      });
    }
    if (input.sizeBytes > rules.maxBytes) {
      throw new BadRequestException({
        message: `Dosya üst limiti aşıldı (${Math.floor(rules.maxBytes / (1024 * 1024))} MB)`,
        code: 'MEDIA_SIZE_LIMIT',
      });
    }

    const objectKey = `tenants/${tenantId}/work-orders/${workOrderId}/media/${randomUUID()}`;
    const bucket = getEnv().S3_BUCKET;

    const media = await this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/media',
      async (tx) => {
        const workOrder = await requireExecutableWorkOrder(tx, tenantId, workOrderId);
        await assertExecutionAuthority(tx, workOrder, actor);

        const created = await tx.fileObject.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            kind: input.kind,
            objectKey,
            fileName: input.fileName,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            status: 'PENDING_UPLOAD',
            uploadedById: actor.userId,
          },
        });
        await tx.workOrderEvent.create({
          data: {
            tenantId,
            workOrderId: workOrder.id,
            eventType: 'work_order.media_initiated',
            actorId: actor.userId,
            metadataJson: {
              mediaId: created.id,
              kind: created.kind,
              fileName: created.fileName,
              sizeBytes: created.sizeBytes,
            },
          },
        });
        await this.audit.log({
          tenantId,
          actorId: actor.userId,
          action: 'work_order.media_init',
          resourceType: 'work_order',
          resourceId: workOrder.id,
          requestId: actor.requestId,
          metadata: { mediaId: created.id, kind: created.kind },
        });
        return { mediaId: created.id };
      },
    );

    // İmzalı PUT URL'i (yükleme doğrudan obje deposuna — API gövdesinden geçmez).
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: input.contentType,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return {
      body: {
        mediaId: media.body.mediaId,
        uploadUrl,
        uploadMethod: 'PUT' as const,
        expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
        requiredHeaders: { 'content-type': input.contentType },
      },
      replayed: media.replayed,
    };
  }

  // ------------------------- 3. adım: complete -------------------------

  async completeUpload(
    tenantId: string,
    workOrderId: string,
    mediaId: string,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
    opts: { idempotencyKey?: string } = {},
  ): Promise<IdempotencyOutcome<MediaObjectView>> {
    const media = await this.idempotency.withIdempotency(
      tenantId,
      actor.userId,
      opts.idempotencyKey,
      'POST /work-orders/:id/media/:mediaId/complete',
      async (tx) => {
        const workOrder = await requireVisibleWorkOrder(tx, tenantId, workOrderId, actor);
        await assertExecutionAuthority(tx, workOrder, actor);
        const row = await tx.fileObject.findFirst({
          where: { id: mediaId, tenantId, workOrderId: workOrder.id },
          include: { uploadedBy: { select: { displayName: true } } },
        });
        if (!row) throw notFound();

        // Idempotent complete: zaten doğrulanmış → kanonik görünüm.
        if (row.status === 'READY') {
          return toMediaBaseView(row, row.uploadedBy?.displayName ?? null);
        }
        if (row.status === 'FAILED') {
          throw new ConflictException({
            message: 'Bu medya doğrulamadan geçemedi — yeni yükleme başlatın',
            code: 'MEDIA_VALIDATION_FAILED',
            failureCode: row.failureCode,
          });
        }

        // Doğrulama hattı: HEAD (varlık + gerçek boyut) → magic-byte koklama.
        const bucket = getEnv().S3_BUCKET;
        const head = await this.s3
          .send(new HeadObjectCommand({ Bucket: bucket, Key: row.objectKey }))
          .catch(() => null);
        if (!head) {
          throw new ConflictException({
            message: 'Yükleme henüz obje deposuna ulaşmadı — PUT tamamlandı mı?',
            code: 'UPLOAD_NOT_RECEIVED',
          });
        }
        const actualSize = head.ContentLength ?? 0;
        const rules = MEDIA_RULES[row.kind as keyof typeof MEDIA_RULES];

        let updated;
        if (actualSize === 0) {
          updated = await markFailed(tx, row, 'EMPTY_OBJECT');
        } else if (actualSize > rules.maxBytes) {
          updated = await markFailed(tx, row, 'SIZE_LIMIT');
        } else {
          const headBytes = await this.readHeadBytes(bucket, row.objectKey);
          const detected = detectMime(headBytes);
          if (!mimeMatches(row.contentType, detected)) {
            updated = await markFailed(tx, row, 'MAGIC_BYTE_MISMATCH');
          } else {
            updated = await tx.fileObject.update({
              where: { id: row.id },
              data: {
                status: 'READY',
                sizeBytes: actualSize,
                completedAt: new Date(),
                failureCode: null,
              },
            });
            await tx.workOrderEvent.create({
              data: {
                tenantId,
                workOrderId: workOrder.id,
                eventType: 'work_order.media_ready',
                actorId: actor.userId,
                metadataJson: {
                  mediaId: updated.id,
                  kind: updated.kind,
                  sizeBytes: actualSize,
                  detectedMime: detected,
                },
              },
            });
            await this.audit.log({
              tenantId,
              actorId: actor.userId,
              action: 'work_order.media_complete',
              resourceType: 'work_order',
              resourceId: workOrder.id,
              requestId: actor.requestId,
              metadata: { mediaId: updated.id, sizeBytes: actualSize },
            });
          }
        }
        return toMediaBaseView(updated, row.uploadedBy?.displayName ?? null);
      },
    );

    // READY ise kısa ömürlü indirme URL'i üret (her yanıtta TAZE — replay dahil).
    let downloadUrl: string | null = null;
    let downloadUrlExpiresAt: string | null = null;
    if (media.body.status === 'READY') {
      const objectKey = await this.scoped.withTenant(tenantId, (tx) =>
        tx.fileObject
          .findUnique({ where: { id: media.body.mediaId }, select: { objectKey: true } })
          .then((found) => found?.objectKey ?? ''),
      );
      if (objectKey) {
        downloadUrl = await this.presignDownload(objectKey);
        downloadUrlExpiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
      }
    }
    return {
      body: {
        ...media.body,
        downloadUrl,
        downloadUrlExpiresAt,
      },
      replayed: media.replayed,
    };
  }

  // ------------------------- Liste -------------------------

  async listMedia(
    tenantId: string,
    workOrderId: string,
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<MediaObjectView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await requireVisibleWorkOrder(tx, tenantId, workOrderId, viewer);
      const rows = await tx.fileObject.findMany({
        where: { tenantId, workOrderId: workOrder.id },
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { displayName: true } } },
      });
      const views: MediaObjectView[] = [];
      for (const row of rows) {
        const ready = row.status === 'READY';
        views.push({
          mediaId: row.id,
          workOrderId: row.workOrderId,
          kind: row.kind,
          fileName: row.fileName,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
          status: row.status,
          failureCode: row.failureCode,
          uploadedById: row.uploadedById,
          uploadedByName: row.uploadedBy?.displayName ?? null,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          downloadUrl: ready ? await this.presignDownload(row.objectKey) : null,
          downloadUrlExpiresAt: ready
            ? new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString()
            : null,
        });
      }
      return views;
    });
  }

  // ------------------------- Dahili -------------------------

  private async presignDownload(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: getEnv().S3_BUCKET, Key: objectKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }

  /** Objeden ilk N baytı okur (range GET) — magic-byte koklama için. */
  private async readHeadBytes(bucket: string, objectKey: string): Promise<Uint8Array> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey, Range: `bytes=0-${SNIFF_BYTES - 1}` }),
    );
    if (!response.Body) return new Uint8Array();
    const chunks: Buffer[] = [];
    const reader = response.Body as AsyncIterable<Buffer>;
    for await (const chunk of reader) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (chunks.reduce((total, c) => total + c.length, 0) >= SNIFF_BYTES) break;
    }
    return new Uint8Array(Buffer.concat(chunks).subarray(0, SNIFF_BYTES));
  }
}

// ------------------------- Yardımcılar -------------------------

interface WorkOrderRef {
  id: string;
  status: string;
  assignedToId: string | null;
}

async function requireExecutableWorkOrder(
  tx: ScopedClient,
  tenantId: string,
  workOrderId: string,
): Promise<WorkOrderRef> {
  const workOrder = await tx.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { id: true, status: true, assignedToId: true },
  });
  if (!workOrder) throw notFound('İş emri bulunamadı');
  if (workOrder.status === 'CLOSED' || workOrder.status === 'CANCELLED') {
    throw new ConflictException({
      message: 'Kapatılmış veya iptal edilmiş iş emrine medya eklenemez',
      code: 'WORK_ORDER_IMMUTABLE',
    });
  }
  return workOrder;
}

async function requireVisibleWorkOrder(
  tx: ScopedClient,
  tenantId: string,
  workOrderId: string,
  viewer: { userId: string; permissions: Set<string> },
): Promise<WorkOrderRef> {
  const workOrder = await tx.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { id: true, status: true, assignedToId: true },
  });
  if (!workOrder) throw notFound('İş emri bulunamadı');
  if (!viewer.permissions.has('work_orders:view_all')) {
    if (workOrder.assignedToId !== viewer.userId) {
      const active = await tx.workOrderAssignment.findFirst({
        where: { workOrderId: workOrder.id, userId: viewer.userId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!active) {
        throw new NotFoundException({ message: 'İş emri bulunamadı', code: 'NOT_FOUND' });
      }
    }
  }
  return workOrder;
}

async function assertExecutionAuthority(
  tx: ScopedClient,
  workOrder: WorkOrderRef,
  actor: { userId: string; permissions: Set<string> },
): Promise<void> {
  if (!actor.permissions.has('work_orders:complete')) {
    throw new ForbiddenException({ message: 'Bu işlem için yetkiniz yok', code: 'FORBIDDEN' });
  }
  if (actor.permissions.has('work_orders:view_all')) return;
  if (workOrder.assignedToId === actor.userId) return;
  const active = await tx.workOrderAssignment.findFirst({
    where: { workOrderId: workOrder.id, userId: actor.userId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!active) {
    throw new ForbiddenException({ message: 'Bu işlem için yetkiniz yok', code: 'FORBIDDEN' });
  }
}

/** Doğrulama başarısızlığı: FAILED + sınıflı kod (raporlanabilir). */
async function markFailed(
  tx: ScopedClient,
  row: { id: string; workOrderId: string; tenantId: string },
  failureCode: string,
) {
  const updated = await tx.fileObject.update({
    where: { id: row.id },
    data: { status: 'FAILED', failureCode, completedAt: new Date() },
  });
  await tx.workOrderEvent.create({
    data: {
      tenantId: row.tenantId,
      workOrderId: row.workOrderId,
      eventType: 'work_order.media_failed',
      metadataJson: { mediaId: row.id, failureCode },
    },
  });
  return updated;
}

/** JSON-güvenli temel görünüm (idempotency deposu için Date'siz). */
function toMediaBaseView(
  row: {
    id: string;
    workOrderId: string;
    kind: 'PHOTO' | 'VIDEO' | 'DOCUMENT';
    fileName: string;
    contentType: string;
    sizeBytes: number;
    status: 'PENDING_UPLOAD' | 'READY' | 'QUARANTINED' | 'FAILED';
    failureCode: string | null;
    uploadedById: string | null;
    createdAt: Date;
    completedAt: Date | null;
  },
  uploadedByName: string | null,
): Omit<MediaObjectView, 'downloadUrl' | 'downloadUrlExpiresAt'> {
  return {
    mediaId: row.id,
    workOrderId: row.workOrderId,
    kind: row.kind,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    failureCode: row.failureCode,
    uploadedById: row.uploadedById,
    uploadedByName,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
