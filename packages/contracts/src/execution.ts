import { z } from 'zod';

/**
 * Faz 08 — saha yürütme sözleşmeleri (ADR-0004 outbox operasyonları,
 * ADR-0005 medya hattı, ADR-0007 kanıt kapıları):
 *
 * - GPS konum ve kilometre taşları (check-in/check-out — append-only visit)
 * - Checklist (madde ekleme + yanıt toplama)
 * - İşçilik/zaman kayıtları (labor)
 * - Medya ekleri (iki adımlı yükleme: init → imzalı PUT → complete)
 * - İmza (append-only koordinat yolu; düzeltme ayrı olay)
 * - Rapor önizlemesi (JSON; PDF üretimi worker'da sonraki fazlarda)
 *
 * İLKELER:
 * - GPS yalnızca açık teknisyen eyleminde gönderilir (rules/06: check-in/out).
 *   Konum YOKSA geçiş yine mümkündür: kaynak MANUAL + neden ile kaydedilir
 *   (izin verilmedi cihaz fallback'i) ya da hiç konum gönderilmez.
 * - İmza üzerine yazılmaz: düzeltme yeni kayıt + correctionOfSignatureId.
 * - Tekrarlanabilir POST'lar Idempotency-Key başlığıyla tekilleştirilir.
 * - Kanıt kapıları (API tarafında uygulanır, burada hata kodları belgelenir):
 *   COMPLETED ← zorunlu checklist yanıtlanmadıysa 409 EVIDENCE_MISSING;
 *   CLOSED    ← en az bir imza yoksa 409 EVIDENCE_MISSING.
 */

// ------------------------- Sabitler / hata kodları -------------------------

/** Kanıt eksikken tamamlama/kapatma denemesi (HTTP 409). */
export const EVIDENCE_MISSING_CODE = 'EVIDENCE_MISSING';

/** Aynı idempotency anahtarı farklı gövdeyle yeniden kullanıldı (HTTP 409). */
export const IDEMPOTENCY_KEY_CONFLICT_CODE = 'IDEMPOTENCY_KEY_CONFLICT';

/** Medya doğrulaması başarısız (MIME/boyut/magic-byte) (HTTP 422). */
export const ATTACHMENT_REJECTED_CODE = 'ATTACHMENT_REJECTED';

/** Idempotency-Key başlığı adı (Idempotency-Replayed: true ile yanıt). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'idempotency-replayed';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const IdempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    'Idempotency anahtarı 8-128 karakter; harf/rakam/nokta/alt çizgi/tire/iki nokta',
  );
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

// ------------------------- GPS konumu -------------------------

export const GPS_SOURCES = ['GPS', 'MANUAL'] as const;
export const GpsSourceSchema = z.enum(GPS_SOURCES);
export type GpsSource = z.infer<typeof GpsSourceSchema>;

/**
 * Konum yakalama kaydı — geçiş gövdesinde (ARRIVE/COMPLETE) taşınır.
 * GPS kaynağında cihaz doğruluğu ZORUNLUDUR (kabul kriteri: "GPS accuracy
 * metadata"). MANUAL kaynakta neden zorunludur (izin reddi/cihaz fallback).
 */
export const GpsLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    /** Cihaz doğruluğu (metre). GPS kaynağında zorunlu. */
    accuracyMeters: z.number().min(0).max(10_000).optional(),
    /** İstemci yakalama zamanı (UTC ISO). */
    capturedAt: z.string().datetime(),
    source: GpsSourceSchema,
    /** Manuel konum açıklaması — MANUAL kaynağında zorunlu. */
    manualReason: z.string().trim().min(3).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'GPS' && value.accuracyMeters === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['accuracyMeters'],
        message: 'GPS kaynaklı konumda doğruluk (metre) zorunludur',
      });
    }
    if (value.source === 'MANUAL' && !value.manualReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['manualReason'],
        message: 'Manuel konumda neden zorunludur (örn. GPS izni verilmedi)',
      });
    }
  });
export type GpsLocation = z.infer<typeof GpsLocationSchema>;

// ------------------------- Ziyaret kilometre taşları -------------------------

export const VISIT_TYPES = ['CHECK_IN', 'CHECK_OUT'] as const;
export const VisitTypeSchema = z.enum(VISIT_TYPES);
export type VisitType = z.infer<typeof VisitTypeSchema>;

/** Visit kaydı — append-only; geçişle otomatik üretilir. Konum yoksa
 *  kaynak MANUAL'dir (konum paylaşılmadı) ve koordinatlar boştur. */
export const WorkOrderVisitViewSchema = z.object({
  visitId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  visitType: VisitTypeSchema,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyMeters: z.number().nullable(),
  source: GpsSourceSchema,
  manualReason: z.string().nullable(),
  capturedAt: z.string().datetime().nullable(),
  recordedAt: z.string().datetime(),
  recordedById: z.string().nullable(),
  recordedByName: z.string().nullable(),
});
export type WorkOrderVisitView = z.infer<typeof WorkOrderVisitViewSchema>;

export const WorkOrderVisitListResponseSchema = z.object({
  data: z.array(WorkOrderVisitViewSchema),
});
export type WorkOrderVisitListResponse = z.infer<typeof WorkOrderVisitListResponseSchema>;

// ------------------------- Checklist -------------------------

export const CHECKLIST_RESPONSE_TYPES = [
  'BOOLEAN',
  'NUMBER',
  'TEXT',
  'SINGLE_SELECT',
  'MULTI_SELECT',
] as const;
export const ChecklistResponseTypeSchema = z.enum(CHECKLIST_RESPONSE_TYPES);
export type ChecklistResponseType = z.infer<typeof ChecklistResponseTypeSchema>;

/** Yanıt değeri — tip maddenin responseType'ına göre sunucuda doğrulanır. */
export const ChecklistResponseValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string().trim().max(2000),
  z.array(z.string().trim().min(1).max(200)).max(20),
  z.null(),
]);
export type ChecklistResponseValue = z.infer<typeof ChecklistResponseValueSchema>;

export const ChecklistItemCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    responseType: ChecklistResponseTypeSchema,
    required: z.boolean().default(false),
    /** Seçim tiplerinde seçenek listesi (en az 2). */
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(10).optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .superRefine((value, ctx) => {
    const needsOptions =
      value.responseType === 'SINGLE_SELECT' || value.responseType === 'MULTI_SELECT';
    if (needsOptions && !value.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Seçim tipi maddede options zorunludur',
      });
    }
    if (!needsOptions && value.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'options yalnız seçim tiplerinde kabul edilir',
      });
    }
  });
export type ChecklistItemCreate = z.infer<typeof ChecklistItemCreateSchema>;

export const ChecklistItemViewSchema = z.object({
  checklistItemId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  label: z.string(),
  responseType: ChecklistResponseTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).nullable(),
  sortOrder: z.number().int().nonnegative(),
  responseValue: ChecklistResponseValueSchema,
  respondedAt: z.string().datetime().nullable(),
  respondedById: z.string().nullable(),
  respondedByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ChecklistItemView = z.infer<typeof ChecklistItemViewSchema>;

export const ChecklistListResponseSchema = z.object({
  data: z.array(ChecklistItemViewSchema),
});
export type ChecklistListResponse = z.infer<typeof ChecklistListResponseSchema>;

const ChecklistResponseInputSchema = z.object({
  checklistItemId: z.string().uuid(),
  /** null = yanıtı temizle (zorunlu madde tamamlama kapısında reddedilir). */
  value: ChecklistResponseValueSchema,
});
export type ChecklistResponseInput = z.infer<typeof ChecklistResponseInputSchema>;

/** Yanıt toplu güncellemesi — POST /work-orders/:id/checklist/responses. */
export const ChecklistResponsesUpdateSchema = z.object({
  responses: z.array(ChecklistResponseInputSchema).min(1).max(100),
});
export type ChecklistResponsesUpdate = z.infer<typeof ChecklistResponsesUpdateSchema>;

export const ChecklistResponsesResultSchema = z.object({
  data: z.array(ChecklistItemViewSchema),
});
export type ChecklistResponsesResult = z.infer<typeof ChecklistResponsesResultSchema>;

// ------------------------- İşçilik (labor) -------------------------

export const LABOR_ENTRY_MIN_MINUTES = 1;
export const LABOR_ENTRY_MAX_MINUTES = 24 * 60;

export const LaborEntryCreateSchema = z
  .object({
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const start = new Date(value.startedAt).getTime();
    const end = new Date(value.endedAt).getTime();
    if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: 'Bitiş zamanı başlangıçtan sonra olmalı',
      });
      return;
    }
    const minutes = (end - start) / 60_000;
    if (minutes > LABOR_ENTRY_MAX_MINUTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: `Tek kayıt en fazla ${LABOR_ENTRY_MAX_MINUTES} dakika olabilir`,
      });
    }
  });
export type LaborEntryCreate = z.infer<typeof LaborEntryCreateSchema>;

export const LaborEntryViewSchema = z.object({
  timeEntryId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  userId: z.string(),
  userName: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  /** Türetilmiş süre (dk) — sunucu hesaplar, istemci yazamaz. */
  durationMinutes: z.number().int().positive(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type LaborEntryView = z.infer<typeof LaborEntryViewSchema>;

export const LaborEntryListResponseSchema = z.object({
  data: z.array(LaborEntryViewSchema),
});
export type LaborEntryListResponse = z.infer<typeof LaborEntryListResponseSchema>;

// ------------------------- Medya (iki adımlı yükleme) -------------------------

export const ATTACHMENT_KINDS = ['PHOTO', 'VIDEO', 'DOCUMENT'] as const;
export const AttachmentKindSchema = z.enum(ATTACHMENT_KINDS);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

/** ADR-0005 izinli MIME'leri ve boyut sınırlarını tanımlar (magic-byte
 *  doğrulaması sunucuda; bu tablo sözleşme yüzeyi). */
export const ATTACHMENT_RULES: Readonly<
  Record<AttachmentKind, { contentTypes: readonly string[]; maxBytes: number }>
> = {
  PHOTO: {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 15 * 1024 * 1024,
  },
  VIDEO: {
    contentTypes: ['video/mp4', 'video/quicktime'],
    maxBytes: 200 * 1024 * 1024,
  },
  DOCUMENT: {
    contentTypes: ['application/pdf'],
    maxBytes: 25 * 1024 * 1024,
  },
};

/** İmzalı yükleme URL'sinin ömrü (saniye) — ADR-0005: kısa ömürlü. */
export const ATTACHMENT_UPLOAD_URL_TTL_SECONDS = 900;

export const AttachmentInitSchema = z
  .object({
    kind: AttachmentKindSchema,
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(100),
    sizeBytes: z.number().int().positive(),
    caption: z.string().trim().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    const rules = ATTACHMENT_RULES[value.kind];
    if (!rules.contentTypes.includes(value.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: `'${value.kind}' için izinli türler: ${rules.contentTypes.join(', ')}`,
      });
    }
    if (value.sizeBytes > rules.maxBytes) {
      ctx.addIssue({
        code: 'custom',
        path: ['sizeBytes'],
        message: `'${value.kind}' için boyut sınırı ${rules.maxBytes} bayt`,
      });
    }
  });
export type AttachmentInit = z.infer<typeof AttachmentInitSchema>;

export const ATTACHMENT_STATES = ['PENDING_UPLOAD', 'UPLOADED', 'READY', 'REJECTED'] as const;
export const AttachmentStateSchema = z.enum(ATTACHMENT_STATES);
export type AttachmentState = z.infer<typeof AttachmentStateSchema>;

export const ATTACHMENT_STATE_LABELS: Readonly<Record<AttachmentState, string>> = {
  PENDING_UPLOAD: 'Yükleme bekliyor',
  UPLOADED: 'Yüklendi — doğrulanıyor',
  READY: 'Hazır',
  REJECTED: 'Reddedildi',
};

/** POST /work-orders/:id/attachments/init yanıtı. */
export const AttachmentInitResponseSchema = z.object({
  attachmentId: z.string().uuid(),
  uploadUrl: z.string().url(),
  uploadMethod: z.literal('PUT'),
  /** Yükleme isteğinde istemcinin göndermesi ZORUNLU başlıklar. */
  requiredHeaders: z.object({
    'content-type': z.string(),
  }),
  expiresAt: z.string().datetime(),
});
export type AttachmentInitResponse = z.infer<typeof AttachmentInitResponseSchema>;

export const AttachmentViewSchema = z.object({
  attachmentId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  kind: AttachmentKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  caption: z.string().nullable(),
  state: AttachmentStateSchema,
  /** Doğrulama sonrası içerik checksum'u (kayıt bütünlüğü). */
  checksumSha256: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  /** READY ise kısa ömürlü imzalı indirme URL'si. */
  viewUrl: z.string().url().nullable(),
  viewUrlExpiresAt: z.string().datetime().nullable(),
  uploadedById: z.string().nullable(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type AttachmentView = z.infer<typeof AttachmentViewSchema>;

export const AttachmentListResponseSchema = z.object({
  data: z.array(AttachmentViewSchema),
});
export type AttachmentListResponse = z.infer<typeof AttachmentListResponseSchema>;

// ------------------------- İmza (append-only) -------------------------

export const SIGNATORY_ROLES = ['CUSTOMER', 'TECHNICIAN'] as const;
export const SignatoryRoleSchema = z.enum(SIGNATORY_ROLES);
export type SignatoryRole = z.infer<typeof SignatoryRoleSchema>;

/**
 * İmza verisi: koordinat yolları (stroke dizileri). Ham SVG/PNG yerine
 * noktalar saklanır — script/payload enjeksiyon yüzeyi yok, yeniden
 * çizim her yüzeyde deterministik. Düzeltme imzası correctionOfSignatureId
 * ile öncekine BAĞLANIR; hiçbir imza silinmez/üzerine yazılmaz.
 */
export const SignaturePointSchema = z.object({
  x: z.number().min(0).max(4000),
  y: z.number().min(0).max(4000),
});
export const SignatureStrokeSchema = z.array(SignaturePointSchema).min(2).max(2000);

export const SignatureCaptureSchema = z
  .object({
    signedBy: SignatoryRoleSchema,
    signerName: z.string().trim().min(2).max(120),
    strokes: z.array(SignatureStrokeSchema).min(1).max(60),
    capturedAt: z.string().datetime(),
    note: z.string().trim().max(300).optional(),
    /** Düzeltme imzasıysa düzelttiği imzanın kimliği. */
    correctionOfSignatureId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.correctionOfSignatureId && value.signedBy !== 'CUSTOMER') {
      ctx.addIssue({
        code: 'custom',
        path: ['correctionOfSignatureId'],
        message: 'Düzeltme imzası yalnız müşteri imzaları için geçerlidir',
      });
    }
  });
export type SignatureCapture = z.infer<typeof SignatureCaptureSchema>;

export const SignatureViewSchema = z.object({
  signatureId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  signedBy: SignatoryRoleSchema,
  signerName: z.string(),
  strokes: z.array(SignatureStrokeSchema),
  capturedAt: z.string().datetime(),
  note: z.string().nullable(),
  correctionOfSignatureId: z.string().uuid().nullable(),
  capturedById: z.string().nullable(),
  capturedByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type SignatureView = z.infer<typeof SignatureViewSchema>;

export const SignatureListResponseSchema = z.object({
  data: z.array(SignatureViewSchema),
});
export type SignatureListResponse = z.infer<typeof SignatureListResponseSchema>;

// ------------------------- Rapor önizlemesi -------------------------

/**
 * GET /work-orders/:id/report — JSON önizleme (web yazdırma görünümü ve
 * mobil rapor ekranının kaynağı). PDF üretimi worker kuyruğunda sonraki
 * fazlarda; bu fazda içerik ve kanıt bütünlüğü sözleşmesi kurulur.
 */
export const WorkOrderReportPreviewSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderNo: z.string(),
  subject: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  customerName: z.string(),
  assetTag: z.string().nullable(),
  locationName: z.string().nullable(),
  branchName: z.string().nullable(),
  assignedToName: z.string().nullable(),
  scheduledStart: z.string().datetime().nullable(),
  scheduledEnd: z.string().datetime().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  slaDueAt: z.string().datetime().nullable(),
  visits: z.array(WorkOrderVisitViewSchema),
  checklist: z.array(ChecklistItemViewSchema),
  labor: z.array(LaborEntryViewSchema),
  attachments: z.array(AttachmentViewSchema),
  signatures: z.array(SignatureViewSchema),
  totalLaborMinutes: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
export type WorkOrderReportPreview = z.infer<typeof WorkOrderReportPreviewSchema>;

// ------------------------- Mobil outbox operasyon tipleri -------------------------

/**
 * ADR-0004 outbox operasyon adları (Faz 08 yürütücüleri). Mobil istemci
 * kuyruğa bu tipleri yazar; sunucu karşılık gelen REST ucunu çağırır ve
 * Idempotency-Key ile tekilleştirir.
 */
export const OUTBOX_OPERATIONS = [
  'work_order.transition',
  'work_order.checklist_responses',
  'work_order.labor_entry',
  'work_order.attachment_init',
  'work_order.attachment_complete',
  'work_order.signature',
] as const;
export const OutboxOperationSchema = z.enum(OUTBOX_OPERATIONS);
export type OutboxOperation = z.infer<typeof OutboxOperationSchema>;

/** Bir outbox işleminin sunucuya gönderilecek zarfı. */
export const OutboxEnvelopeSchema = z.object({
  operation: OutboxOperationSchema,
  workOrderId: z.string().uuid(),
  idempotencyKey: IdempotencyKeySchema,
  baseVersion: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type OutboxEnvelope = z.infer<typeof OutboxEnvelopeSchema>;

// ------------------------- UI etiketleri -------------------------

export const GPS_SOURCE_LABELS: Readonly<Record<GpsSource, string>> = {
  GPS: 'GPS',
  MANUAL: 'Manuel',
};

export const VISIT_TYPE_LABELS: Readonly<Record<VisitType, string>> = {
  CHECK_IN: 'Varış (check-in)',
  CHECK_OUT: 'Ayrılış (check-out)',
};

export const CHECKLIST_RESPONSE_TYPE_LABELS: Readonly<Record<ChecklistResponseType, string>> = {
  BOOLEAN: 'Evet/Hayır',
  NUMBER: 'Sayı',
  TEXT: 'Metin',
  SINGLE_SELECT: 'Tek seçim',
  MULTI_SELECT: 'Çok seçim',
};

export const ATTACHMENT_KIND_LABELS: Readonly<Record<AttachmentKind, string>> = {
  PHOTO: 'Fotoğraf',
  VIDEO: 'Video',
  DOCUMENT: 'Doküman',
};

export const SIGNATORY_ROLE_LABELS: Readonly<Record<SignatoryRole, string>> = {
  CUSTOMER: 'Müşteri',
  TECHNICIAN: 'Teknisyen',
};
