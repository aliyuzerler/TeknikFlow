import { z } from 'zod';

/**
 * Faz 05 — servis sözleşmeleri: servis talebi (intake), iş emri yaşam
 * döngüsü, durum makinesi geçişleri, atamalar, notlar ve zaman çizelgesi.
 *
 * Durum makinesi tek gerçekliği API'dedir (work-order-state.ts); buradaki
 * enum'lar dış sözleşme yüzeyidir. Geçiş isteği bildirimseldir: istemci
 * hedef durumu ve ilgili parametreleri gönderir, sunucu izinli geçişi
 * ve kaynak düzeyi yetkiyi doğrular.
 */

// ------------------------- Ortak enum'lar -------------------------

export const SERVICE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const ServicePrioritySchema = z.enum(SERVICE_PRIORITIES);
export type ServicePriority = z.infer<typeof ServicePrioritySchema>;

/** Talep kaynakları (PRD): portal formu, ofis girişi, e-posta, API. */
export const REQUEST_SOURCES = ['PORTAL', 'OFFICE', 'EMAIL', 'API'] as const;
export const RequestSourceSchema = z.enum(REQUEST_SOURCES);
export type RequestSource = z.infer<typeof RequestSourceSchema>;

export const REQUEST_STATUSES = ['NEW', 'IN_REVIEW', 'CONVERTED', 'CANCELLED'] as const;
export const RequestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

/** İş emri durumları (PRD §5 — tam yaşam döngüsü). */
export const WORK_ORDER_STATUSES = [
  'DRAFT',
  'PLANNED',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'WAITING_CUSTOMER',
  'COMPLETED',
  'CLOSED',
  'CANCELLED',
] as const;
export const WorkOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const WORK_ORDER_TYPES = [
  'CORRECTIVE',
  'PREVENTIVE',
  'INSTALLATION',
  'INSPECTION',
  'OTHER',
] as const;
export const WorkOrderTypeSchema = z.enum(WORK_ORDER_TYPES);
export type WorkOrderType = z.infer<typeof WorkOrderTypeSchema>;

/** İptal nedenleri — serbest metin yerine sınıflı kod (raporlanabilir). */
export const CANCELLATION_REASONS = [
  'CUSTOMER_REQUEST',
  'DUPLICATE',
  'OUT_OF_SCOPE',
  'PARTS_UNAVAILABLE',
  'SCHEDULE_CONFLICT',
  'OTHER',
] as const;
export const CancellationReasonSchema = z.enum(CANCELLATION_REASONS);
export type CancellationReason = z.infer<typeof CancellationReasonSchema>;

export const NOTE_VISIBILITIES = ['INTERNAL', 'CUSTOMER'] as const;
export const NoteVisibilitySchema = z.enum(NOTE_VISIBILITIES);
export type NoteVisibility = z.infer<typeof NoteVisibilitySchema>;

// ------------------------- SLA politikası -------------------------

/** Öncelik başına çözüm süresi (dakika) — kiracı bazlı, varsayılanlarla gelir. */
export const SlaPolicyViewSchema = z.object({
  priority: ServicePrioritySchema,
  resolveMinutes: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export type SlaPolicyView = z.infer<typeof SlaPolicyViewSchema>;

export const UpsertSlaPolicyRequestSchema = z.object({
  priority: ServicePrioritySchema,
  resolveMinutes: z
    .number()
    .int()
    .min(15)
    .max(60 * 24 * 30),
});
export type UpsertSlaPolicyRequest = z.infer<typeof UpsertSlaPolicyRequestSchema>;

// ------------------------- Servis kategorisi -------------------------

export const ServiceCategoryViewSchema = z.object({
  categoryId: z.string().uuid(),
  key: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  description: z.string().nullable(),
});
export type ServiceCategoryView = z.infer<typeof ServiceCategoryViewSchema>;

export const CreateServiceCategoryRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Anahtar 2-40 küçük harf/rakam/tire olmalı'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
});
export type CreateServiceCategoryRequest = z.infer<typeof CreateServiceCategoryRequestSchema>;

// ------------------------- Servis talebi -------------------------

export const CreateServiceRequestRequestSchema = z.object({
  customerId: z.string().uuid(),
  assetId: z.string().uuid().optional(),
  serviceLocationId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  source: RequestSourceSchema.default('OFFICE'),
  subject: z.string().trim().min(4).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: ServicePrioritySchema.default('MEDIUM'),
});
export type CreateServiceRequestRequest = z.infer<typeof CreateServiceRequestRequestSchema>;

/** Triage: alan güncelleme + NEW→IN_REVIEW; alanlar opsiyonel. */
export const TriageServiceRequestRequestSchema = z
  .object({
    subject: z.string().trim().min(4).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    assetId: z.string().uuid().nullable().optional(),
    serviceLocationId: z.string().uuid().nullable().optional(),
    priority: ServicePrioritySchema.optional(),
    status: z.enum(['NEW', 'IN_REVIEW']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'En az bir alan gerekli' });
export type TriageServiceRequestRequest = z.infer<typeof TriageServiceRequestRequestSchema>;

/** Talebi iş emrine dönüştürme — POST /service-requests/:id/convert. */
export const ConvertServiceRequestRequestSchema = z.object({
  type: WorkOrderTypeSchema.default('CORRECTIVE'),
  priority: ServicePrioritySchema.optional(),
  branchId: z.string().uuid().optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  description: z.string().trim().max(5000).optional(),
});
export type ConvertServiceRequestRequest = z.infer<typeof ConvertServiceRequestRequestSchema>;

export const CancelServiceRequestRequestSchema = z.object({
  reasonCode: CancellationReasonSchema,
  note: z.string().trim().max(500).optional(),
});
export type CancelServiceRequestRequest = z.infer<typeof CancelServiceRequestRequestSchema>;

export const ServiceRequestViewSchema = z.object({
  requestId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  assetId: z.string().uuid().nullable(),
  assetTag: z.string().nullable(),
  serviceLocationId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
  categoryKey: z.string().nullable(),
  categoryName: z.string().nullable(),
  source: RequestSourceSchema,
  subject: z.string(),
  description: z.string().nullable(),
  priority: ServicePrioritySchema,
  status: RequestStatusSchema,
  slaDueAt: z.string().datetime().nullable(),
  slaBreached: z.boolean(),
  convertedWorkOrderId: z.string().uuid().nullable(),
  convertedWorkOrderNo: z.string().nullable(),
  cancellationReason: CancellationReasonSchema.nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ServiceRequestView = z.infer<typeof ServiceRequestViewSchema>;

export const ServiceRequestListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: RequestStatusSchema.optional(),
  priority: ServicePrioritySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ServiceRequestListQuery = z.infer<typeof ServiceRequestListQuerySchema>;

// ------------------------- İş emri -------------------------

export const CreateWorkOrderRequestSchema = z
  .object({
    customerId: z.string().uuid(),
    assetId: z.string().uuid().optional(),
    serviceLocationId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    type: WorkOrderTypeSchema.default('CORRECTIVE'),
    priority: ServicePrioritySchema.default('MEDIUM'),
    subject: z.string().trim().min(4).max(200),
    description: z.string().trim().max(5000).optional(),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
  })
  .refine(
    (value) =>
      !value.scheduledStart ||
      !value.scheduledEnd ||
      new Date(value.scheduledEnd).getTime() > new Date(value.scheduledStart).getTime(),
    { message: 'Bitiş zamanı başlangıçtan sonra olmalı' },
  )
  .refine(
    (value) => !value.scheduledStart || new Date(value.scheduledStart).getUTCFullYear() >= 2020,
    { message: 'Geçersiz planlama zamanı' },
  );
export type CreateWorkOrderRequest = z.infer<typeof CreateWorkOrderRequestSchema>;

/** Alan/schedule düzenleme — iyimser eşzamanlılık (expectedVersion). */
export const UpdateWorkOrderRequestSchema = z
  .object({
    subject: z.string().trim().min(4).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    type: WorkOrderTypeSchema.optional(),
    priority: ServicePrioritySchema.optional(),
    branchId: z.string().uuid().nullable().optional(),
    scheduledStart: z.string().datetime().nullable().optional(),
    scheduledEnd: z.string().datetime().nullable().optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (value) => {
      const scheduleProvided =
        value.scheduledStart !== undefined || value.scheduledEnd !== undefined;
      if (!scheduleProvided) return true;
      const start = value.scheduledStart === null ? undefined : value.scheduledStart;
      const end = value.scheduledEnd === null ? undefined : value.scheduledEnd;
      if (start && end) return new Date(end).getTime() > new Date(start).getTime();
      return true;
    },
    { message: 'Bitiş zamanı başlangıçtan sonra olmalı' },
  );
export type UpdateWorkOrderRequest = z.infer<typeof UpdateWorkOrderRequestSchema>;

/**
 * Birleşik geçiş ucu — POST /work-orders/:id/transition.
 * Parametreler hedef duruma göre: ASSIGNED → assigneeUserId;
 * PLANNED → scheduledStart/scheduledEnd/branchId; CANCELLED → reasonCode+note.
 */
export const TransitionWorkOrderRequestSchema = z
  .object({
    to: WorkOrderStatusSchema,
    assigneeUserId: z.string().uuid().optional(),
    reasonCode: CancellationReasonSchema.optional(),
    note: z.string().trim().max(500).optional(),
    scheduledStart: z.string().datetime().optional(),
    scheduledEnd: z.string().datetime().optional(),
    branchId: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.to === 'ASSIGNED' && !value.assigneeUserId) {
      ctx.addIssue({
        code: 'custom',
        path: ['assigneeUserId'],
        message: 'Atama için teknisyen gerekli',
      });
    }
    if (value.to === 'CANCELLED' && !value.reasonCode) {
      ctx.addIssue({ code: 'custom', path: ['reasonCode'], message: 'İptal nedeni gerekli' });
    }
    if (
      value.to === 'PLANNED' &&
      value.scheduledStart &&
      value.scheduledEnd &&
      new Date(value.scheduledEnd).getTime() <= new Date(value.scheduledStart).getTime()
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduledEnd'],
        message: 'Bitiş zamanı başlangıçtan sonra olmalı',
      });
    }
  });
export type TransitionWorkOrderRequest = z.infer<typeof TransitionWorkOrderRequestSchema>;

export const WorkOrderNoteCreateSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  visibility: NoteVisibilitySchema.default('INTERNAL'),
});
export type WorkOrderNoteCreate = z.infer<typeof WorkOrderNoteCreateSchema>;

export const WorkOrderNoteViewSchema = z.object({
  noteId: z.string().uuid(),
  authorId: z.string().nullable(),
  authorName: z.string().nullable(),
  body: z.string(),
  visibility: NoteVisibilitySchema,
  createdAt: z.string().datetime(),
});
export type WorkOrderNoteView = z.infer<typeof WorkOrderNoteViewSchema>;

export const WorkOrderEventViewSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string(),
  fromState: WorkOrderStatusSchema.nullable(),
  toState: WorkOrderStatusSchema.nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime(),
});
export type WorkOrderEventView = z.infer<typeof WorkOrderEventViewSchema>;

export const WorkOrderAssignmentViewSchema = z.object({
  assignmentId: z.string().uuid(),
  userId: z.string(),
  userName: z.string().nullable(),
  assignedById: z.string().nullable(),
  status: z.enum(['ACTIVE', 'REMOVED']),
  assignedAt: z.string().datetime(),
  removedAt: z.string().datetime().nullable(),
});
export type WorkOrderAssignmentView = z.infer<typeof WorkOrderAssignmentViewSchema>;

export const WorkOrderViewSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderNo: z.string(),
  requestId: z.string().uuid().nullable(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  assetId: z.string().uuid().nullable(),
  assetTag: z.string().nullable(),
  serviceLocationId: z.string().uuid().nullable(),
  locationName: z.string().nullable(),
  branchId: z.string().uuid().nullable(),
  branchName: z.string().nullable(),
  type: WorkOrderTypeSchema,
  priority: ServicePrioritySchema,
  status: WorkOrderStatusSchema,
  subject: z.string(),
  description: z.string().nullable(),
  scheduledStart: z.string().datetime().nullable(),
  scheduledEnd: z.string().datetime().nullable(),
  assignedToId: z.string().nullable(),
  assignedToName: z.string().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  cancelledAt: z.string().datetime().nullable(),
  cancellationReason: CancellationReasonSchema.nullable(),
  version: z.number().int().nonnegative(),
  createdById: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkOrderView = z.infer<typeof WorkOrderViewSchema>;

export const WorkOrderListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: WorkOrderStatusSchema.optional(),
  priority: ServicePrioritySchema.optional(),
  customerId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  /** Sadece benim atanmış işlerim (teknisyen görünümü için kolaylık). */
  mine: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type WorkOrderListQuery = z.infer<typeof WorkOrderListQuerySchema>;

/** Atama çekmecesinde listelenecek üyeler (work_orders:dispatch). */
export const AssignableUserViewSchema = z.object({
  userId: z.string().uuid(),
  membershipId: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
  branchScope: z.union([z.literal('ALL'), z.array(z.string())]),
});
export type AssignableUserView = z.infer<typeof AssignableUserViewSchema>;

// ------------------------- Liste / detay zarfları -------------------------

/** Liste uçları ortak zarfı (data + pageInfo). */
const PageInfoEnvelope = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const ServiceRequestListResponseSchema = z.object({
  data: z.array(ServiceRequestViewSchema),
  pageInfo: PageInfoEnvelope,
});
export type ServiceRequestListResponse = z.infer<typeof ServiceRequestListResponseSchema>;

export const WorkOrderListResponseSchema = z.object({
  data: z.array(WorkOrderViewSchema),
  pageInfo: PageInfoEnvelope,
});
export type WorkOrderListResponse = z.infer<typeof WorkOrderListResponseSchema>;

/** Detay ucu: iş emri + olay akışı + notlar + atama geçmişi. */
export const WorkOrderDetailResponseSchema = WorkOrderViewSchema.extend({
  events: z.array(WorkOrderEventViewSchema),
  notes: z.array(WorkOrderNoteViewSchema),
  assignments: z.array(WorkOrderAssignmentViewSchema),
});
export type WorkOrderDetailResponse = z.infer<typeof WorkOrderDetailResponseSchema>;

export const ServiceCategoryListResponseSchema = z.object({
  data: z.array(ServiceCategoryViewSchema),
});
export type ServiceCategoryListResponse = z.infer<typeof ServiceCategoryListResponseSchema>;

export const SlaPolicyListResponseSchema = z.object({ data: z.array(SlaPolicyViewSchema) });
export type SlaPolicyListResponse = z.infer<typeof SlaPolicyListResponseSchema>;

export const AssignableUserListResponseSchema = z.object({
  data: z.array(AssignableUserViewSchema),
});
export type AssignableUserListResponse = z.infer<typeof AssignableUserListResponseSchema>;

/** POST /service-requests/:id/convert yanıtı. */
export const ConvertServiceRequestResponseSchema = z.object({
  request: ServiceRequestViewSchema,
  workOrder: WorkOrderViewSchema,
});
export type ConvertServiceRequestResponse = z.infer<typeof ConvertServiceRequestResponseSchema>;

// ------------------------- UI etiket sabitleri -------------------------
// Web ve mobilin ortak etiket haritaları (sözleşmenin sunum parçası).
// API tarafındaki yetki haritası (work-order-state.ts) ayrı tutulur;
// tutarlılık birim testiyle doğrulanır.

export const WORK_ORDER_STATUS_LABELS: Readonly<Record<WorkOrderStatus, string>> = {
  DRAFT: 'Taslak',
  PLANNED: 'Planlandı',
  ASSIGNED: 'Atandı',
  ACCEPTED: 'Kabul Edildi',
  EN_ROUTE: 'Yolda',
  ON_SITE: 'Yerinde',
  IN_PROGRESS: 'Devam Ediyor',
  WAITING_PARTS: 'Parça Bekliyor',
  WAITING_CUSTOMER: 'Müşteri Bekliyor',
  COMPLETED: 'Tamamlandı',
  CLOSED: 'Kapatıldı',
  CANCELLED: 'İptal Edildi',
};

/** Sözleşme düzeyinde görünür geçiş tablosu (yetki denetimi API'dedir). */
export const WORK_ORDER_TRANSITION_TARGETS: Readonly<
  Record<WorkOrderStatus, readonly WorkOrderStatus[]>
> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PLANNED: ['ASSIGNED', 'DRAFT', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'PLANNED', 'CANCELLED'],
  ACCEPTED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ON_SITE', 'CANCELLED'],
  ON_SITE: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'WAITING_CUSTOMER', 'COMPLETED', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export const REQUEST_STATUS_LABELS: Readonly<Record<RequestStatus, string>> = {
  NEW: 'Yeni',
  IN_REVIEW: 'İncelemede',
  CONVERTED: 'Dönüştürüldü',
  CANCELLED: 'İptal Edildi',
};

export const PRIORITY_LABELS: Readonly<Record<ServicePriority, string>> = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
  URGENT: 'Acil',
};

export const WORK_ORDER_TYPE_LABELS: Readonly<Record<WorkOrderType, string>> = {
  CORRECTIVE: 'Arıza Onarımı',
  PREVENTIVE: 'Önleyici Bakım',
  INSTALLATION: 'Kurulum',
  INSPECTION: 'Muayene',
  OTHER: 'Diğer',
};

export const CANCELLATION_REASON_LABELS: Readonly<Record<CancellationReason, string>> = {
  CUSTOMER_REQUEST: 'Müşteri talebi',
  DUPLICATE: 'Mükerrer kayıt',
  OUT_OF_SCOPE: 'Kapsam dışı',
  PARTS_UNAVAILABLE: 'Parça temin edilemiyor',
  SCHEDULE_CONFLICT: 'Plan çakışması',
  OTHER: 'Diğer',
};

export const REQUEST_SOURCE_LABELS: Readonly<Record<RequestSource, string>> = {
  PORTAL: 'Portal',
  OFFICE: 'Ofis',
  EMAIL: 'E-posta',
  API: 'API',
};
