import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import {
  findScheduleConflicts,
  localDatesTouched,
  workingWindowsForLocalDate,
  type EngineConflict,
  type UtcWindow,
} from './dispatch-engine.js';

/**
 * Faz 06 — planlama çakışması koruyucusu (ADR-0008).
 *
 * Motor (dispatch-engine.ts) saf hesaplar; bu servis veritabanından
 * kiracı bağlamını (saat dilimi, profil, çalışma saatleri, izinler,
 * teknisyenin diğer işleri) yükler ve motoru çalıştırır.
 *
 * TEK GERÇEKLİK noktaları (çift rezervasyon engeli):
 *   1. İş emri ASSIGNED'a geçişte (transition → ASSIGN eylemi)
 *   2. Atanmış iş emrinin schedule PATCH'inde
 *   3. POST /dispatch/schedule (önden doğrulama)
 *
 * Override politikası: çakışma üzerine planlama yalnız
 * work_orders:dispatch_override izniyle VE ≥10 karakter nedenle;
 * neden iş emrine ve olay akışına yazılır (denetim izi).
 */

export interface ConflictCheckInput {
  assigneeUserId: string;
  window: UtcWindow;
  /** Çakışma denetiminde hariç tutulacak iş emri (kendisi). */
  excludeWorkOrderId: string;
}

export interface OverrideDirective {
  requested: boolean;
  reason?: string;
}

/** İzin verilen override sonucu ya da fırlatılan hata. */
export interface ConflictEvaluation {
  conflicts: EngineConflict[];
  overridden: boolean;
}

@Injectable()
export class ScheduleConflictService {
  constructor(private readonly scoped: TenantScopedPrismaService) {}

  /**
   * Atanan teknisyen için aday pencereyi değerlendir; çakışma varsa
   * 409 SCHEDULE_CONFLICT fırlat VEYA override geçerliyse geçmesine izin ver.
   */
  async assertNoConflicts(
    tx: ScopedClient,
    tenantId: string,
    input: ConflictCheckInput,
    override: OverrideDirective,
    actorPermissions: Set<string>,
  ): Promise<ConflictEvaluation> {
    const conflicts = await this.evaluate(tx, tenantId, input);
    if (conflicts.length === 0) {
      return { conflicts, overridden: false };
    }

    if (!override.requested) {
      throw new ConflictException({
        message: 'Planlama çakışması: teknisyen bu aralıkta müsait değil',
        code: 'SCHEDULE_CONFLICT',
        conflicts: conflicts.map((conflict) => ({
          type: conflict.type,
          message: conflict.message,
          workOrderId: conflict.workOrderId,
          workOrderNo: conflict.workOrderNo,
        })),
      });
    }

    if (!actorPermissions.has('work_orders:dispatch_override')) {
      throw new ForbiddenException({
        message: 'Çakışma üzerine planlama için dispatch_override yetkisi gerekir',
        code: 'OVERRIDE_FORBIDDEN',
      });
    }
    if (!override.reason || override.reason.trim().length < 10) {
      throw new BadRequestException({
        message: 'Çakışma üzerine planlama için neden (en az 10 karakter) zorunlu',
        code: 'OVERRIDE_REASON_REQUIRED',
      });
    }

    return { conflicts, overridden: true };
  }

  /** Veritabanı bağlamlı değerlendirme (hata fırlatmaz). */
  async evaluate(
    tx: ScopedClient,
    tenantId: string,
    input: ConflictCheckInput,
  ): Promise<EngineConflict[]> {
    const tenant = await tx.tenant.findFirst({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timeZone = tenant?.timezone ?? 'Europe/Istanbul';

    const [profile, timeOffs, otherOrders] = await Promise.all([
      tx.technicianProfile.findFirst({
        where: { tenantId, userId: input.assigneeUserId },
        include: { workingHours: true },
      }),
      tx.timeOff.findMany({
        where: {
          tenantId,
          profile: { userId: input.assigneeUserId },
          status: 'ACTIVE',
          startAt: { lt: input.window.end },
          endAt: { gt: input.window.start },
        },
        select: { id: true, startAt: true, endAt: true, reason: true },
      }),
      tx.workOrder.findMany({
        where: {
          tenantId,
          assignedToId: input.assigneeUserId,
          id: { not: input.excludeWorkOrderId },
          status: { notIn: ['COMPLETED', 'CLOSED', 'CANCELLED'] },
          scheduledStart: { not: null, lt: input.window.end },
          scheduledEnd: { not: null, gt: input.window.start },
        },
        select: { id: true, workOrderNo: true, scheduledStart: true, scheduledEnd: true },
      }),
    ]);

    const workingWindows: UtcWindow[] = [];
    if (profile) {
      const rules = profile.workingHours.map((hour) => ({
        weekday: hour.weekday,
        startMinute: hour.startMinute,
        endMinute: hour.endMinute,
      }));
      for (const localDate of localDatesTouched(input.window, timeZone)) {
        workingWindows.push(...workingWindowsForLocalDate(rules, localDate, timeZone));
      }
    }

    return findScheduleConflicts({
      window: input.window,
      otherOrders: otherOrders.map((order) => ({
        workOrderId: order.id,
        workOrderNo: order.workOrderNo,
        start: order.scheduledStart!,
        end: order.scheduledEnd!,
      })),
      workingWindows,
      hasWorkingHours: (profile?.workingHours.length ?? 0) > 0,
      timeOffs: timeOffs.map((off) => ({
        timeOffId: off.id,
        start: off.startAt,
        end: off.endAt,
        reason: off.reason,
      })),
    });
  }
}
