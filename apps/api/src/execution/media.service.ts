import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Prisma } from '@prisma/client';
import {
  ATTACHMENT_RULES,
  ATTACHMENT_UPLOAD_URL_TTL_SECONDS,
  type AttachmentInit,
  type AttachmentInitResponse,
  type AttachmentView,
} from '@teknikflow/contracts';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { getEnv } from '../config/env.js';
import { isTerminalStatus } from './execution-rules.js';
import { hashRequestBody, idempotencyKeyWhere } from './idempotency.js';
import { S3_CLIENT } from '../storage/storage.module.js';
import {
  detectMagicKind,
  magicMatchesContentType,
  sha256Hex,
  stripJpegMetadata,
} from './media-validation.js';
import {
  assertCanExecuteWorkOrder,
  assertVisibleWorkOrder,
  type ExecutionActor,
} from './work-order-access.js';

/**
 * Faz 08 — medya servisi (ADR-0005 iki adımlı yükleme):
 *
 *   (a) init      → FileObject + WorkOrderAttachment kaydı (PENDING_UPLOAD)
 *                   + kısa ömürlü imzalı PUT URL'si
 *   (b) PUT       → istemci nesneyi doğrudan obje deposuna yükler
 *   (c) complete  → sunucu nesneyi ÇEKER: magic-byte + boyut + checksum
 *                   doğrular; JPEG'de EXIF söker ve temiz kopyayı geri yazar;
 *                   READY ya da REJECTED olarak sonuçlanır (karantina modeli)
 *
 * Erişim: READY nesneler için yalnız yetkili kiracı üyesine kısa ömürlü
 * imzalı GET URL'si (bucket asla herkese açık değil).
 */

type AttachmentRow = Prisma.WorkOrderAttachmentGetPayload<{ include: { fileObject: true } }>;

@Injectable()
export class MediaService {
  private readonly bucket: string;

  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    @Inject(S3_CLIENT) private readonly s3: S3Client,
  ) {
    this.bucket = getEnv().S3_BUCKET;
  }

  async listAttachments(
    tenantId: string,
    workOrderId: string,
    actor: ExecutionActor,
  ): Promise<AttachmentView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await assertVisibleWorkOrder(tx, tenantId, workOrderId, actor);
      const rows = await tx.workOrderAttachment.findMany({
        where: { workOrderId },
        orderBy: { createdAt: 'asc' },
        include: { fileObject: true },
      });
      return Promise.all(rows.map((row) => this.toView(row)));
    });
  }

  async initAttachment(
    tenantId: string,
    workOrderId: string,
    input: AttachmentInit,
    actor: ExecutionActor,
    idempotencyKey?: string,
  ): Promise<{ body: AttachmentInitResponse; replayed: boolean }> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: idempotencyKeyWhere({
            tenantId,
            userId: actor.userId,
            scope: 'attachment.init',
            key: idempotencyKey,
          }),
        });
        if (existing) {
          if (existing.requestHash !== hashRequestBody(input)) {
            throw new ConflictException({
              message: 'Idempotency anahtarı farklı bir gövdeyle daha önce kullanılmış',
              code: 'IDEMPOTENCY_KEY_CONFLICT',
            });
          }
          return { body: existing.responseJson as AttachmentInitResponse, replayed: true };
        }
      }
      const workOrder = await assertCanExecuteWorkOrder(tx, tenantId, workOrderId, actor);
      if (isTerminalStatus(workOrder.status)) {
        throw new ConflictException({
          message: `Terminal durumlu (${workOrder.status}) iş emrine medya eklenemez`,
          code: 'INVALID_STATE',
        });
      }
      // Nesne anahtarı: kiracı prefiksli opak UUID — path traversal yok.
      const objectKey = `${tenantId}/${crypto.randomUUID()}`;
      const fileObject = await tx.fileObject.create({
        data: {
          tenantId,
          objectKey,
          kind: input.kind,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          caption: input.caption ?? null,
          state: 'PENDING_UPLOAD',
          uploadedById: actor.userId,
        },
      });
      const attachment = await tx.workOrderAttachment.create({
        data: {
          tenantId,
          workOrderId,
          fileObjectId: fileObject.id,
        },
      });
      const uploadUrl = await getSignedUrl(
        this.s3,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          ContentType: input.contentType,
        }),
        { expiresIn: ATTACHMENT_UPLOAD_URL_TTL_SECONDS },
      );
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'execution.attachment_initialized',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: actor.requestId,
        metadata: { attachmentId: attachment.id, kind: input.kind, sizeBytes: input.sizeBytes },
      });
      const body: AttachmentInitResponse = {
        attachmentId: attachment.id,
        uploadUrl,
        uploadMethod: 'PUT',
        requiredHeaders: { 'content-type': input.contentType },
        expiresAt: new Date(Date.now() + ATTACHMENT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      };
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            tenantId,
            userId: actor.userId,
            scope: 'attachment.init',
            key: idempotencyKey,
            requestHash: hashRequestBody(input),
            responseJson: body as never,
            statusCode: 201,
          },
        });
      }
      return { body, replayed: false };
    });
  }

  /**
   * Yükleme tamamlama + doğrulama hattı. Nesne henüz yoksa 409 (istemci
   * PUT'u yapmamış); doğrulama başarısızsa kayıt REJECTED olur ve bir daha
   * imzalı URL verilmez.
   */
  async completeAttachment(
    tenantId: string,
    workOrderId: string,
    attachmentId: string,
    actor: ExecutionActor,
    idempotencyKey?: string,
  ): Promise<{ body: AttachmentView; replayed: boolean }> {
    // Aşama 1 — yetki + idempotency araması (S3 G/Ç transaction DIŞINDA).
    const phase1 = await this.scoped.withTenant(tenantId, async (tx) => {
      await assertCanExecuteWorkOrder(tx, tenantId, workOrderId, actor);
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: idempotencyKeyWhere({
            tenantId,
            userId: actor.userId,
            scope: 'attachment.complete',
            key: idempotencyKey,
          }),
        });
        if (existing) {
          if (existing.requestHash !== hashRequestBody({ attachmentId })) {
            throw new ConflictException({
              message: 'Idempotency anahtarı farklı bir gövdeyle daha önce kullanılmış',
              code: 'IDEMPOTENCY_KEY_CONFLICT',
            });
          }
          return { kind: 'replayed' as const, body: existing.responseJson as AttachmentView };
        }
      }
      const row = await tx.workOrderAttachment.findFirst({
        where: { id: attachmentId, workOrderId, tenantId },
        include: { fileObject: true },
      });
      if (!row) {
        throw new NotFoundException({ message: 'Ek bulunamadı', code: 'NOT_FOUND' });
      }
      if (row.fileObject.state === 'READY') {
        return { kind: 'ready' as const, row };
      }
      if (row.fileObject.state === 'REJECTED') {
        throw new ConflictException({
          message: 'Reddedilen ek yeniden tamamlanamaz — yeni init gerekir',
          code: 'ATTACHMENT_REJECTED',
        });
      }
      return { kind: 'pending' as const, row };
    });
    if (phase1.kind === 'replayed') {
      return { body: phase1.body, replayed: true };
    }
    if (phase1.kind === 'ready') {
      return { body: await this.toView(phase1.row), replayed: false };
    }
    const row = phase1.row;

    // --- Depo doğrulaması (transaction DIŞI — ağ G/Ç): ---
    let bytes: Uint8Array;
    let actualSize: number;
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: row.fileObject.objectKey }),
      );
      actualSize = head.ContentLength ?? 0;
      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: row.fileObject.objectKey }),
      );
      bytes = object.Body
        ? Uint8Array.from(await object.Body.transformToByteArray())
        : new Uint8Array();
    } catch {
      throw new ConflictException({
        message: 'Yüklenecek nesne depoda bulunamadı — PUT adımı tamamlanmamış olabilir',
        code: 'UPLOAD_PENDING',
      });
    }

    const kind = detectMagicKind(bytes);
    let rejectionReason: string | null = null;
    if (!magicMatchesContentType(kind, row.fileObject.contentType)) {
      rejectionReason = 'İçerik türü doğrulanamadı (magic byte uyuşmazlığı)';
    } else if (actualSize !== row.fileObject.sizeBytes) {
      rejectionReason = `Boyut uyuşmazlığı: bildirilen ${row.fileObject.sizeBytes}, gerçek ${actualSize}`;
    } else if (actualSize > ATTACHMENT_RULES[row.fileObject.kind].maxBytes) {
      rejectionReason = 'Boyut sınırı aşıldı';
    }

    let checksum = sha256Hex(bytes);
    if (!rejectionReason && row.fileObject.contentType === 'image/jpeg') {
      const sanitized = stripJpegMetadata(bytes);
      if (sanitized.stripped) {
        // Temiz kopya geri yazılır (EXIF GPS sızıntı yüzeyi kapanır).
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: row.fileObject.objectKey,
            ContentType: row.fileObject.contentType,
            Body: sanitized.buffer,
          }),
        );
        checksum = sha256Hex(sanitized.buffer);
      }
    }

    // Aşama 3 — durum güncelleme + idempotency kaydı + denetim.
    const body = await this.scoped.withTenant(tenantId, async (tx) => {
      const updated = await tx.fileObject.update({
        where: { id: row.fileObject.id },
        data: {
          state: rejectionReason ? 'REJECTED' : 'READY',
          rejectionReason,
          checksumSha256: rejectionReason ? null : checksum,
          completedAt: new Date(),
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: rejectionReason ? 'execution.attachment_rejected' : 'execution.attachment_ready',
        resourceType: 'work_order',
        resourceId: workOrderId,
        requestId: actor.requestId,
        metadata: {
          attachmentId,
          objectKey: row.fileObject.objectKey,
          reason: rejectionReason,
        },
      });
      return this.toView({
        ...row,
        fileObject: updated,
      });
    });
    if (idempotencyKey) {
      await this.scoped
        .withTenant(tenantId, async (tx) => {
          await tx.idempotencyKey.create({
            data: {
              tenantId,
              userId: actor.userId,
              scope: 'attachment.complete',
              key: idempotencyKey,
              requestHash: hashRequestBody({ attachmentId }),
              responseJson: body as never,
              statusCode: 200,
            },
          });
        })
        .catch(() => undefined); // anahtar yarışı: tekrar istemciyi idare eder
    }
    return { body, replayed: false };
  }

  /** READY nesne için kısa ömürlü imzali GET URL'si. */
  private async signViewUrl(objectKey: string): Promise<{ url: string; expiresAt: string }> {
    const url = await getSignedUrl(
      this.s3,
      // GET komutu — imzalı indirme.
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: ATTACHMENT_UPLOAD_URL_TTL_SECONDS },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + ATTACHMENT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  private async toView(row: AttachmentRow): Promise<AttachmentView> {
    let viewUrl: string | null = null;
    let viewUrlExpiresAt: string | null = null;
    if (row.fileObject.state === 'READY') {
      const signed = await this.signViewUrl(row.fileObject.objectKey);
      viewUrl = signed.url;
      viewUrlExpiresAt = signed.expiresAt;
    }
    return {
      attachmentId: row.id,
      workOrderId: row.workOrderId,
      kind: row.fileObject.kind,
      fileName: row.fileObject.fileName,
      contentType: row.fileObject.contentType,
      sizeBytes: row.fileObject.sizeBytes,
      caption: row.fileObject.caption,
      state: row.fileObject.state,
      checksumSha256: row.fileObject.checksumSha256,
      rejectionReason: row.fileObject.rejectionReason,
      viewUrl,
      viewUrlExpiresAt,
      uploadedById: row.fileObject.uploadedById,
      uploadedByName: null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.fileObject.completedAt?.toISOString() ?? null,
    };
  }
}
