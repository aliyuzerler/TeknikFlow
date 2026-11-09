import { z } from 'zod';
import { ServicePrioritySchema, WorkOrderStatusSchema, WorkOrderViewSchema } from './service.js';

/**
 * Faz 06 — dispatch sözleşmeleri: pano, teknisyen müsaitliği, çalışma
 * saatleri, izinler, yetenekler, takımlar ve zamanlama (çakışma + override).
 *
 * Çakışma motoru tek gerçekliği API'dedir (dispatch-engine.ts); buradaki
 * şemalar dış sözleşme yüzeyidir. Zamanlama isteği override bayrağı
 * taşır: çakışma VARSA ve override yoksa sunucu 409 SCHEDULE_CONFLICT
 * döner; override yalnız work_orders:dispatch_override izniyle ve
 * zorunlu neden metniyle kabul edilir (denetim izi olaya yazılır).
 */

// ------------------------- Yetenekler -------------------------

export const SKILL_LEVEL_RANGE = { min: 1, max: 5 } as const;

export const SkillViewSchema = z.object({
  skillId: z.string().uuid(),
  key: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  description: z.string().nullable(),
});
export type SkillView = z.infer<typeof SkillViewSchema>;

export const CreateSkillRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Yalnız küçük harf, rakam ve tire'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
});
export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>;

export const UserSkillViewSchema = z.object({
  skillId: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  level: z.number().int().min(SKILL_LEVEL_RANGE.min).max(SKILL_LEVEL_RANGE.max),
});
export type UserSkillView = z.infer<typeof UserSkillViewSchema>;

export const SetUserSkillRequestSchema = z.object({
  skillId: z.string().uuid(),
  level: z.number().int().min(SKILL_LEVEL_RANGE.min).max(SKILL_LEVEL_RANGE.max),
});
export type SetUserSkillRequest = z.infer<typeof SetUserSkillRequestSchema>;

export const SkillListResponseSchema = z.object({ data: z.array(SkillViewSchema) });
export type SkillListResponse = z.infer<typeof SkillListResponseSchema>;

/** Kategoriye zorunlu yetenek ekleme/çıkarma (danışma eşleştirmesi kaynağı). */
export const CategorySkillSetRequestSchema = z.object({
  skillId: z.string().uuid(),
});
export type CategorySkillSetRequest = z.infer<typeof CategorySkillSetRequestSchema>;

// ------------------------- Hafta içi / dakikalar -------------------------

/** ISO-8601 hafta içi günleri: 1=Pazartesi ... 7=Pazar. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WeekdaySchema = z.number().int().min(1).max(7);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  1: 'Pazartesi',
  2: 'Salı',
  3: 'Çarşamba',
  4: 'Perşembe',
  5: 'Cuma',
  6: 'Cumartesi',
  7: 'Pazar',
};

/** 00:00'dan itibaren dakika (0..1440; start 0..1439, end 1..1440). */
export const WorkingHourWindowSchema = z
  .object({
    weekday: WeekdaySchema,
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((value) => value.endMinute > value.startMinute, {
    message: 'Pencere bitişi başlangıçtan sonra olmalı',
  });
export type WorkingHourWindow = z.infer<typeof WorkingHourWindowSchema>;

/**
 * Çalışma saatleri toplu değiştirme (PUT): belirtilen set eskisinin yerine
 * geçer. Aynı günde üst üste binen pencere reddedilir.
 */
export const WorkingHoursUpsertRequestSchema = z
  .object({ hours: z.array(WorkingHourWindowSchema).max(21) })
  .refine(
    (value) => {
      const byWeekday = new Map<number, Array<{ startMinute: number; endMinute: number }>>();
      for (const hour of value.hours) {
        const list = byWeekday.get(hour.weekday) ?? [];
        list.push(hour);
        byWeekday.set(hour.weekday, list);
      }
      for (const list of byWeekday.values()) {
        const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
        for (let i = 1; i < sorted.length; i += 1) {
          if (sorted[i]!.startMinute < sorted[i - 1]!.endMinute) return false;
        }
      }
      return true;
    },
    { message: 'Aynı günde pencereler üst üste binemez' },
  );
export type WorkingHoursUpsertRequest = z.infer<typeof WorkingHoursUpsertRequestSchema>;

export const WorkingHourViewSchema = z.object({
  workingHourId: z.string().uuid(),
  weekday: WeekdaySchema,
  startMinute: z.number().int(),
  endMinute: z.number().int(),
});
export type WorkingHourView = z.infer<typeof WorkingHourViewSchema>;

export const WorkingHoursResponseSchema = z.object({
  userId: z.string().uuid(),
  hours: z.array(WorkingHourViewSchema),
});
export type WorkingHoursResponse = z.infer<typeof WorkingHoursResponseSchema>;

// ------------------------- Teknisyen profili -------------------------

export const TechnicianProfileUpsertRequestSchema = z.object({
  territory: z.string().trim().max(120).nullable().optional(),
  dailyCapacityMinutes: z.number().int().min(30).max(1440).optional(),
  active: z.boolean().optional(),
});
export type TechnicianProfileUpsertRequest = z.infer<typeof TechnicianProfileUpsertRequestSchema>;

export const TechnicianProfileViewSchema = z.object({
  userId: z.string().uuid(),
  membershipId: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
  territory: z.string().nullable(),
  dailyCapacityMinutes: z.number().int(),
  active: z.boolean(),
  team: z.object({ teamId: z.string().uuid(), name: z.string(), code: z.string() }).nullable(),
  skills: z.array(UserSkillViewSchema),
});
export type TechnicianProfileView = z.infer<typeof TechnicianProfileViewSchema>;

export const TechnicianListResponseSchema = z.object({
  data: z.array(TechnicianProfileViewSchema),
});
export type TechnicianListResponse = z.infer<typeof TechnicianListResponseSchema>;

// ------------------------- İzin (time off) -------------------------

export const TIME_OFF_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export const TimeOffStatusSchema = z.enum(TIME_OFF_STATUSES);
export type TimeOffStatus = z.infer<typeof TimeOffStatusSchema>;

export const TIME_OFF_STATUS_LABELS: Readonly<Record<TimeOffStatus, string>> = {
  ACTIVE: 'Aktif',
  CANCELLED: 'İptal Edildi',
};

export const TimeOffCreateSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => new Date(value.endAt).getTime() > new Date(value.startAt).getTime(), {
    message: 'İzin bitişi başlangıçtan sonra olmalı',
  });
export type TimeOffCreate = z.infer<typeof TimeOffCreateSchema>;

export const TimeOffViewSchema = z.object({
  timeOffId: z.string().uuid(),
  userId: z.string().uuid(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().nullable(),
  status: TimeOffStatusSchema,
  createdAt: z.string().datetime(),
});
export type TimeOffView = z.infer<typeof TimeOffViewSchema>;

// ------------------------- Çakışma modeli -------------------------

export const CONFLICT_TYPES = ['OVERLAP', 'OUTSIDE_WORKING_HOURS', 'TIME_OFF'] as const;
export const ConflictTypeSchema = z.enum(CONFLICT_TYPES);
export type ConflictType = z.infer<typeof ConflictTypeSchema>;

export const CONFLICT_TYPE_LABELS: Readonly<Record<ConflictType, string>> = {
  OVERLAP: 'Çift rezervasyon',
  OUTSIDE_WORKING_HOURS: 'Çalışma saatleri dışı',
  TIME_OFF: 'İzin çakışması',
};

/** Motorun ürettiği tek çakışma bulgusu (insan-okur mesaj + makine tipi). */
export const ScheduleConflictSchema = z.object({
  type: ConflictTypeSchema,
  message: z.string(),
  workOrderId: z.string().uuid().nullable(),
  workOrderNo: z.string().nullable(),
});
export type ScheduleConflict = z.infer<typeof ScheduleConflictSchema>;

/** Pano satırına düşen çakışma (teknisyen bağlamıyla). */
export const TechnicianConflictSchema = ScheduleConflictSchema.extend({
  userId: z.string().uuid(),
  userName: z.string(),
});
export type TechnicianConflict = z.infer<typeof TechnicianConflictSchema>;

// ------------------------- Zamanlama isteği -------------------------

/**
 * POST /dispatch/schedule gövdesi. Tek adımda planlar ve (istendiyse)
 * atar: DRAFT→PLANNED→ASSIGNED ya da yeniden planlama/yeniden atama.
 * Çakışmada 409 SCHEDULE_CONFLICT; override için izin + neden zorunlu.
 */
export const ScheduleWorkOrderRequestSchema = z
  .object({
    assigneeUserId: z.string().uuid().optional(),
    scheduledStart: z.string().datetime(),
    scheduledEnd: z.string().datetime(),
    overrideConflict: z.boolean().optional(),
    overrideReason: z.string().trim().min(10).max(500).optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) => new Date(value.scheduledEnd).getTime() > new Date(value.scheduledStart).getTime(),
    {
      message: 'Bitiş zamanı başlangıçtan sonra olmalı',
    },
  )
  .refine(
    (value) => !(value.overrideConflict === true) || (value.overrideReason ?? '').length >= 10,
    { message: 'Çakışma üzerine planlama için neden (en az 10 karakter) zorunlu' },
  );
export type ScheduleWorkOrderRequest = z.infer<typeof ScheduleWorkOrderRequestSchema>;

/** POST /dispatch/schedule/:workOrderId yanıtı — iş emri + danışma uyarıları. */
export const ScheduleWorkOrderResponseSchema = z.object({
  workOrder: WorkOrderViewSchema,
  /// Atanan teknisyenin EKSİK kategori yetenekleri (engellemez, uyarır).
  skillWarnings: z.array(z.string()),
});
export type ScheduleWorkOrderResponse = z.infer<typeof ScheduleWorkOrderResponseSchema>;

// ------------------------- Pano -------------------------

/** Pano/pano kolonu için hafif iş emri görünümü. */
export const BoardWorkOrderSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderNo: z.string(),
  subject: z.string(),
  customerName: z.string(),
  locationName: z.string().nullable(),
  type: z.string(),
  priority: ServicePrioritySchema,
  status: WorkOrderStatusSchema,
  scheduledStart: z.string().datetime().nullable(),
  scheduledEnd: z.string().datetime().nullable(),
  slaDueAt: z.string().datetime().nullable(),
  slaBreached: z.boolean(),
  slaAtRisk: z.boolean(),
  /// Kategorinin zorunlu yetenek anahtarları (danışma eşleştirme).
  requiredSkillKeys: z.array(z.string()),
});
export type BoardWorkOrder = z.infer<typeof BoardWorkOrderSchema>;

export const CapacitySummarySchema = z.object({
  capacityMinutes: z.number().int().nonnegative(),
  scheduledMinutes: z.number().int().nonnegative(),
  utilizationPct: z.number().min(0).max(1000),
});
export type CapacitySummary = z.infer<typeof CapacitySummarySchema>;

export const TechnicianBoardColumnSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  roleKey: z.string(),
  territory: z.string().nullable(),
  team: z.object({ teamId: z.string().uuid(), name: z.string(), code: z.string() }).nullable(),
  skills: z.array(UserSkillViewSchema),
  workingWindows: z.array(
    z.object({ startAt: z.string().datetime(), endAt: z.string().datetime() }),
  ),
  onTimeOff: z.boolean(),
  workOrders: z.array(BoardWorkOrderSchema),
  capacity: CapacitySummarySchema,
});
export type TechnicianBoardColumn = z.infer<typeof TechnicianBoardColumnSchema>;

export const TeamCapacitySchema = z.object({
  teamId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  memberCount: z.number().int().nonnegative(),
  capacity: CapacitySummarySchema,
});
export type TeamCapacity = z.infer<typeof TeamCapacitySchema>;

export const SlaAlertSchema = z.object({
  workOrderId: z.string().uuid(),
  workOrderNo: z.string(),
  subject: z.string(),
  customerName: z.string(),
  priority: ServicePrioritySchema,
  status: WorkOrderStatusSchema,
  slaDueAt: z.string().datetime(),
  slaBreached: z.boolean(),
  slaAtRisk: z.boolean(),
});
export type SlaAlert = z.infer<typeof SlaAlertSchema>;

export const DispatchBoardQuerySchema = z.object({
  /** Yerel takvim günü (kiracı saat diliminde) YYYY-MM-DD. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD olmalı')
    .optional(),
});
export type DispatchBoardQuery = z.infer<typeof DispatchBoardQuerySchema>;

export const DispatchBoardResponseSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  dayStartsAt: z.string().datetime(),
  dayEndsAt: z.string().datetime(),
  technicians: z.array(TechnicianBoardColumnSchema),
  queue: z.array(BoardWorkOrderSchema),
  slaAlerts: z.array(SlaAlertSchema),
  conflicts: z.array(TechnicianConflictSchema),
  teams: z.array(TeamCapacitySchema),
});
export type DispatchBoardResponse = z.infer<typeof DispatchBoardResponseSchema>;

// ------------------------- Müsaitlik -------------------------

export const AvailabilityDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: WeekdaySchema,
  workingWindows: z.array(
    z.object({ startAt: z.string().datetime(), endAt: z.string().datetime() }),
  ),
  timeOffs: z.array(TimeOffViewSchema),
  booked: z.array(BoardWorkOrderSchema),
  freeSlots: z.array(z.object({ startAt: z.string().datetime(), endAt: z.string().datetime() })),
});
export type AvailabilityDay = z.infer<typeof AvailabilityDaySchema>;

export const AvailabilityQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export const AvailabilityResponseSchema = z.object({
  userId: z.string().uuid(),
  timezone: z.string(),
  days: z.array(AvailabilityDaySchema),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

export const ConflictListQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ConflictListQuery = z.infer<typeof ConflictListQuerySchema>;

// ------------------------- Takımlar -------------------------

export const TeamViewSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  branchId: z.string().uuid().nullable(),
  branchName: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type TeamView = z.infer<typeof TeamViewSchema>;

export const CreateTeamRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'Yalnız harf, rakam ve tire'),
  branchId: z.string().uuid().optional(),
});
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const UpdateTeamRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  code: z.string().trim().toUpperCase().min(2).max(16).optional(),
  branchId: z.string().uuid().nullable().optional(),
});
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>;

export const TeamListResponseSchema = z.object({ data: z.array(TeamViewSchema) });
export type TeamListResponse = z.infer<typeof TeamListResponseSchema>;

export const TeamMemberAddRequestSchema = z.object({
  userId: z.string().uuid(),
});
export type TeamMemberAddRequest = z.infer<typeof TeamMemberAddRequestSchema>;

export const TeamMemberViewSchema = z.object({
  membershipId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string(),
  roleKey: z.string(),
  teamLead: z.boolean(),
});
export type TeamMemberView = z.infer<typeof TeamMemberViewSchema>;

// ------------------------- Yanıt zarfları (ek) -------------------------

export const DispatchConflictListResponseSchema = z.object({
  data: z.array(TechnicianConflictSchema),
});
export type DispatchConflictListResponse = z.infer<typeof DispatchConflictListResponseSchema>;

/** Basit başarı zarfı (silme/iptal uçları). */
export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;
