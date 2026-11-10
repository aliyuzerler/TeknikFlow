import { z } from 'zod';
import { ServicePrioritySchema, WorkOrderStatusSchema } from './service.js';
import { PartConsumptionViewSchema } from './inventory.js';

/**
 * Faz 08 — saha yürütme sözleşmeleri: GPS kilometre taşları (varış kaydı),
 * iş emri checklist'i, çalışma süresi kayıtları (seyahat/iş/bekleme),
 * iki adımlı medya yükleme (ADR-0005), müşteri imzası (ekle-güncelle-yok,
 * yalnız düzeltme) ve yürütme raporu.
 *
 * Mutasyonlarda mobil taraf kuyruk (outbox) + idempotency anahtarı
 * (x-idempotency-key başlığı) kullanır; sunucu tekrarı tekilleştirir ve
 * kanonik durumu döner (docs/OFFLINE_SYNC.md).
 *
 * İmza YOL KOORDİNATLARI olarak JSON'da saklanır (SVG değil — script
 * enjeksiyon yüzeyi yok, bağımlılık yok). Koordinatlar 0..1 normalize
 * edilmiş tuval ölçeğidir; render tarafı çerçeveye ölçekler.
 */

// ------------------------- GPS -------------------------

/** GPS kaynağı: cihaz konumu ya da izin reddi sonrası manuel onay. */
export const GPS_SOURCES = ['GPS', 'MANUAL'] as const;
export const GpsSourceSchema = z.enum(GPS_SOURCES);
export type GpsSource = z.infer<typeof GpsSourceSchema>;

// ------------------------- Varış / ziyaret -------------------------

/** Ziyaret kilometre taşı: iş yerine varış ve sahanın terki. */
export const VISIT_MILESTONES = ['ARRIVED', 'DEPARTED'] as const;
export const VisitMilestoneSchema = z.enum(VISIT_MILESTONES);
export type VisitMilestone = z.infer<typeof VisitMilestoneSchema>;

export const VISIT_MILESTONE_LABELS: Readonly<Record<VisitMilestone, string>> = {
  ARRIVED: 'Varış',
  DEPARTED: 'Ayrılış',
};

/** Varış kaydı görünümü (append-only work_order_visits satırı). */
export const WorkOrderVisitViewSchema = z.object({
  visitId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  milestone: VisitMilestoneSchema,
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracyMeters: z.number().nonnegative().nullable(),
  source: GpsSourceSchema,
  manualReason: z.string().nullable(),
  recordedAt: z.string().datetime(),
});
export type WorkOrderVisitView = z.infer<typeof WorkOrderVisitViewSchema>;

// ------------------------- Checklist -------------------------

/** Checklist maddesi oluşturma — planlama/ofis ya da sahada teknisyen ekler. */
export const CreateChecklistItemRequestSchema = z.object({
  label: z.string().trim().min(2).max(200),
  detail: z.string().trim().max(1000).optional(),
  /** Tamamlama ZORUNLU mu? Zorunlu maddeler eksikken COMPLETED geçilemez. */
  required: z.boolean().default(true),
  position: z.number().int().min(0).max(999).optional(),
});
export type CreateChecklistItemRequest = z.infer<typeof CreateChecklistItemRequestSchema>;

/** Madde tamamlama / geri alma — idempotent (aynı durum ikinci gönderimde no-op). */
export const CompleteChecklistItemRequestSchema = z.object({
  done: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});
export type CompleteChecklistItemRequest = z.infer<typeof CompleteChecklistItemRequestSchema>;

export const ChecklistItemViewSchema = z.object({
  itemId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  label: z.string(),
  detail: z.string().nullable(),
  required: z.boolean(),
  position: z.number().int().nonnegative(),
  done: z.boolean(),
  doneAt: z.string().datetime().nullable(),
  doneById: z.string().uuid().nullable(),
  doneByName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChecklistItemView = z.infer<typeof ChecklistItemViewSchema>;

export const ChecklistListResponseSchema = z.object({
  data: z.array(ChecklistItemViewSchema),
});
export type ChecklistListResponse = z.infer<typeof ChecklistListResponseSchema>;

// ------------------------- Çalışma süresi -------------------------

/** Süre kaydı türü: yol, sahada iş, bekleme (parça/müşteri). */
export const TIME_ENTRY_TYPES = ['TRAVEL', 'LABOR', 'WAITING'] as const;
export const TimeEntryTypeSchema = z.enum(TIME_ENTRY_TYPES);
export type TimeEntryType = z.infer<typeof TimeEntryTypeSchema>;

export const TIME_ENTRY_TYPE_LABELS: Readonly<Record<TimeEntryType, string>> = {
  TRAVEL: 'Seyahat',
  LABOR: 'Saha işi',
  WAITING: 'Bekleme',
};

export const TIME_ENTRY_STATUSES = ['OPEN', 'CLOSED'] as const;
export const TimeEntryStatusSchema = z.enum(TIME_ENTRY_STATUSES);
export type TimeEntryStatus = z.infer<typeof TimeEntryStatusSchema>;

/**
 * Süre kaydı başlatma — açık kayıt tekliği: bir kullanıcı bir iş emrinde
 * en fazla bir AÇIK kayıt tutabilir (çift saat sayacı engeli).
 */
export const CreateTimeEntryRequestSchema = z
  .object({
    type: TimeEntryTypeSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) =>
      !value.endedAt || new Date(value.endedAt).getTime() > new Date(value.startedAt).getTime(),
    { message: 'Bitiş zamanı başlangıçtan sonra olmalı' },
  );
export type CreateTimeEntryRequest = z.infer<typeof CreateTimeEntryRequestSchema>;

/** Açık kaydı durdurma — endedAt > startedAt sözleşmede doğrulanır. */
export const StopTimeEntryRequestSchema = z.object({
  endedAt: z.string().datetime(),
  note: z.string().trim().max(500).optional(),
});
export type StopTimeEntryRequest = z.infer<typeof StopTimeEntryRequestSchema>;

export const TimeEntryViewSchema = z.object({
  timeEntryId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  type: TimeEntryTypeSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationMinutes: z.number().int().nonnegative().nullable(),
  note: z.string().nullable(),
  status: TimeEntryStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TimeEntryView = z.infer<typeof TimeEntryViewSchema>;

export const TimeEntryListResponseSchema = z.object({
  data: z.array(TimeEntryViewSchema),
});
export type TimeEntryListResponse = z.infer<typeof TimeEntryListResponseSchema>;

/** Toplam işgücü özeti (rapor + kapasite gerçekliği — Faz 06 sınırını aşar). */
export const LaborSummarySchema = z.object({
  travelMinutes: z.number().int().nonnegative(),
  laborMinutes: z.number().int().nonnegative(),
  waitingMinutes: z.number().int().nonnegative(),
  totalMinutes: z.number().int().nonnegative(),
  openEntry: z.boolean(),
});
export type LaborSummary = z.infer<typeof LaborSummarySchema>;

// ------------------------- Medya (ADR-0005) -------------------------

export const MEDIA_KINDS = ['PHOTO', 'VIDEO', 'DOCUMENT'] as const;
export const MediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MEDIA_KIND_LABELS: Readonly<Record<MediaKind, string>> = {
  PHOTO: 'Fotoğraf',
  VIDEO: 'Video',
  DOCUMENT: 'Doküman',
};

export const MEDIA_STATUSES = ['PENDING_UPLOAD', 'READY', 'QUARANTINED', 'FAILED'] as const;
export const MediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const MEDIA_STATUS_LABELS: Readonly<Record<MediaStatus, string>> = {
  PENDING_UPLOAD: 'Yükleme bekliyor',
  READY: 'Hazır',
  QUARANTINED: 'Karantina',
  FAILED: 'Başarısız',
};

/**
 * İzinli MIME'ler ve üst limitler (ADR-0005 doğrulama hattı).
 * SVG bilinçli olarak YOK: script payload yüzeyi; rasterize edilemez reddedilir.
 */
export const MEDIA_RULES: Readonly<
  Record<MediaKind, { mimes: readonly string[]; maxBytes: number }>
> = {
  PHOTO: { mimes: ['image/jpeg', 'image/png'], maxBytes: 15 * 1024 * 1024 },
  VIDEO: { mimes: ['video/mp4'], maxBytes: 200 * 1024 * 1024 },
  DOCUMENT: { mimes: ['application/pdf'], maxBytes: 25 * 1024 * 1024 },
};

/** İki adımlı yükleme — 1. adım: metadata + imzalı PUT URL'si. */
export const InitMediaUploadRequestSchema = z.object({
  kind: MediaKindSchema,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((name) => !name.includes('/') && !name.includes('\\') && !name.includes('..'), {
      message: 'Dosya adı yol bileşeni içeremez',
    }),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});
export type InitMediaUploadRequest = z.infer<typeof InitMediaUploadRequestSchema>;

export const InitMediaUploadResponseSchema = z.object({
  mediaId: z.string().uuid(),
  uploadUrl: z.string().min(1),
  uploadMethod: z.literal('PUT'),
  /** İmzalı URL sona erme anı (UTC ISO) — istemci bu sürede PUT yapmalı. */
  expiresAt: z.string().datetime(),
  requiredHeaders: z.object({
    'content-type': z.string(),
  }),
});
export type InitMediaUploadResponse = z.infer<typeof InitMediaUploadResponseSchema>;

/** 2. adım bildirimi — sunucu nesneyi magic-byte/boyut/MIME ile doğrular. */
export const CompleteMediaUploadRequestSchema = z.object({});
export type CompleteMediaUploadRequest = z.infer<typeof CompleteMediaUploadRequestSchema>;

export const MediaObjectViewSchema = z.object({
  mediaId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  kind: MediaKindSchema,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: MediaStatusSchema,
  /** Doğrulama başarısızlığının sınıflı kodu (raporlanabilir). */
  failureCode: z.string().nullable(),
  uploadedById: z.string().uuid().nullable(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  /** Yalnız READY medya için: kısa ömürlü imzalı indirme URL'si. */
  downloadUrl: z.string().nullable(),
  downloadUrlExpiresAt: z.string().datetime().nullable(),
});
export type MediaObjectView = z.infer<typeof MediaObjectViewSchema>;

export const MediaListResponseSchema = z.object({
  data: z.array(MediaObjectViewSchema),
});
export type MediaListResponse = z.infer<typeof MediaListResponseSchema>;

// ------------------------- İmza -------------------------

export const SIGNATURE_ROLES = ['CUSTOMER', 'TECHNICIAN'] as const;
export const SignatureRoleSchema = z.enum(SIGNATURE_ROLES);
export type SignatureRole = z.infer<typeof SignatureRoleSchema>;

export const SIGNATURE_ROLE_LABELS: Readonly<Record<SignatureRole, string>> = {
  CUSTOMER: 'Müşteri',
  TECHNICIAN: 'Teknisyen',
};

/** Normalize tuval noktası (0..1) + cihaz zamanı (ms). */
export const SignaturePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  t: z.number().int().nonnegative(),
});
export type SignaturePoint = z.infer<typeof SignaturePointSchema>;

/** Bir çizgi stroke'u: en az 2 nokta (tek nokta görünür iz bırakmaz). */
export const SignatureStrokeSchema = z.array(SignaturePointSchema).min(2).max(512);
export type SignatureStroke = z.infer<typeof SignatureStrokeSchema>;

/**
 * İmza yakalama — EKLE-GÜNCELLE-YOK: düzeltme yeni satır + correctionOfId
 * bağı ile; eski imza supersededById ile işaretlenir (asla üstüne yazılmaz).
 */
export const CaptureSignatureRequestSchema = z
  .object({
    role: SignatureRoleSchema,
    signerName: z.string().trim().min(2).max(120),
    signedAt: z.string().datetime(),
    strokes: z.array(SignatureStrokeSchema).min(1).max(64),
    note: z.string().trim().max(500).optional(),
    /** Düzeltme: geçersiz kılınacak imza (aynı iş emrinde olmalı). */
    correctionOfId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      value.strokes.reduce((total, stroke) => total + stroke.length, 0) >= 4 &&
      value.strokes.reduce((total, stroke) => total + stroke.length, 0) <= 8192,
    { message: 'İmza en az 4, en çok 8192 nokta içermeli' },
  );
export type CaptureSignatureRequest = z.infer<typeof CaptureSignatureRequestSchema>;

export const SignatureViewSchema = z.object({
  signatureId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  role: SignatureRoleSchema,
  signerName: z.string(),
  note: z.string().nullable(),
  capturedById: z.string().uuid().nullable(),
  capturedByName: z.string().nullable(),
  signedAt: z.string().datetime(),
  correctionOfId: z.string().uuid().nullable(),
  supersededById: z.string().uuid().nullable(),
  strokeCount: z.number().int().positive(),
  pointCount: z.number().int().positive(),
  /** Yol koordinatları (render için; görüntüleyici kaynak-düzeyi kapsamında). */
  strokes: z.array(SignatureStrokeSchema),
  createdAt: z.string().datetime(),
});
export type SignatureView = z.infer<typeof SignatureViewSchema>;

export const SignatureListResponseSchema = z.object({
  data: z.array(SignatureViewSchema),
});
export type SignatureListResponse = z.infer<typeof SignatureListResponseSchema>;

// ------------------------- Yürütme raporu -------------------------

/** Yürütme raporu: iş emri özeti + kanıt artefaktlarının tamamı. */
export const ExecutionReportViewSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderNo: z.string(),
  subject: z.string(),
  status: WorkOrderStatusSchema,
  priority: ServicePrioritySchema,
  customerName: z.string(),
  assetTag: z.string().nullable(),
  locationName: z.string().nullable(),
  assignedToName: z.string().nullable(),
  scheduledStart: z.string().datetime().nullable(),
  scheduledEnd: z.string().datetime().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  labor: LaborSummarySchema,
  visits: z.array(WorkOrderVisitViewSchema),
  checklist: z.array(ChecklistItemViewSchema),
  timeEntries: z.array(TimeEntryViewSchema),
  media: z.array(MediaObjectViewSchema),
  signatures: z.array(SignatureViewSchema),
  /** Faz 09 — parça tüketimi (CONSUME hareketleri) + toplam malzeme maliyeti. */
  parts: z.array(PartConsumptionViewSchema),
  partsCostMinor: z.number().int().nonnegative(),
  /** Zorunlu checklist eksikleri (COMPLETED kapısı için). */
  requiredChecklistRemaining: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
export type ExecutionReportView = z.infer<typeof ExecutionReportViewSchema>;

// ------------------------- Kanıt kapıları -------------------------

/** Kanıt eksikliği hata zarfının meta kısmı (409 EVIDENCE_MISSING). */
export const EvidenceMissingDetailSchema = z.object({
  code: z.literal('EVIDENCE_MISSING'),
  gate: z.enum(['COMPLETED', 'CLOSED']),
  message: z.string(),
  missing: z.array(
    z.object({
      itemId: z.string().uuid(),
      label: z.string(),
    }),
  ),
  signatureCount: z.number().int().nonnegative().optional(),
});
export type EvidenceMissingDetail = z.infer<typeof EvidenceMissingDetailSchema>;

// ------------------------- Yardımcılar -------------------------

/** Görünüm zaman damgası biçimleyicisi (görünümler ISO üretir). */
export const EXECUTION_IDEMPOTENCY_HEADER = 'x-idempotency-key';
