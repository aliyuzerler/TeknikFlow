import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilityDay,
  BoardWorkOrder,
  CapacitySummary,
  ConflictListQuery,
  CreateSkillRequest,
  CreateTeamRequest,
  DispatchBoardResponse,
  ScheduleWorkOrderRequest,
  ScheduleWorkOrderResponse,
  SetUserSkillRequest,
  SlaAlert,
  TechnicianConflict,
  TechnicianProfileUpsertRequest,
  TechnicianProfileView,
  TeamCapacity,
  TeamView,
  TimeOffCreate,
  TimeOffView,
  UpdateTeamRequest,
  WorkingHoursUpsertRequest,
  WorkingHourView,
  WorkOrderView,
  UserSkillView,
  SkillView,
} from '@teknikflow/contracts';
import { SLA_AT_RISK_MINUTES } from '../service/dispatch-engine.js';
import {
  capacitySummary,
  findScheduleConflicts,
  freeSlotsForDay,
  isoWeekdayOf,
  localDateOf,
  localDayBoundsUtc,
  matchSkills,
  slaState,
  windowsOverlap,
  workingWindowsForLocalDate,
  type LocalDate,
} from '../service/dispatch-engine.js';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { ScheduleConflictService } from '../service/schedule-conflict.service.js';
import { WorkOrdersService, priorityRank } from '../service/work-orders.service.js';

/**
 * Faz 06 — dispatch servisi: pano, teknisyen müsaitliği, çalışma saatleri,
 * izinler, yetenekler, takımlar ve tek adımlı planlama.
 *
 * Çakışma TEK GERÇEKLİĞİ iş emri servisinin ASSIGN/PATCH koruyucularındadır;
 * POST /dispatch/schedule önden doğrular (409'u mutasyondan ÖNCE verir) ve
 * mevcut durum makinesi geçişlerini (PLAN/ASSIGN/UNASSIGN) sırayla uygular —
 * yeni bir paralel durum yolu AÇMAZ (ADR-0007 korunur, ADR-0008).
 */

const TERMINAL_WO_STATUSES = ['COMPLETED', 'CLOSED', 'CANCELLED'] as const;

const BOARD_WO_SELECT = {
  id: true,
  workOrderNo: true,
  subject: true,
  status: true,
  priority: true,
  type: true,
  scheduledStart: true,
  scheduledEnd: true,
  slaDueAt: true,
  assignedToId: true,
  customer: { select: { name: true } },
  serviceLocation: { select: { name: true, address: true } },
  request: { select: { categoryId: true } },
} as const;

type BoardWoRow = {
  id: string;
  workOrderNo: string;
  subject: string;
  status: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  type: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  slaDueAt: Date | null;
  assignedToId: string | null;
  customer: { name: string } | null;
  serviceLocation: { name: string | null; address: string | null } | null;
  request: { categoryId: string | null } | null;
};

function notFound(message = 'Kayıt bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

function parseLocalDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException({ message: 'Tarih YYYY-MM-DD olmalı', code: 'DATE_INVALID' });
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new BadRequestException({ message: 'Geçersiz takvim tarihi', code: 'DATE_INVALID' });
  }
  return { year, month, day };
}

function localDateKey(date: LocalDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function addDaysLocal(date: LocalDate, days: number): LocalDate {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return {
    year: probe.getUTCFullYear(),
    month: probe.getUTCMonth() + 1,
    day: probe.getUTCDate(),
  };
}

function sameLocalDate(a: LocalDate, b: LocalDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function toBoardWorkOrder(row: BoardWoRow, requiredSkillKeys: string[], now: Date): BoardWorkOrder {
  const sla = slaState(row.slaDueAt, row.status, now);
  return {
    workOrderId: row.id,
    workOrderNo: row.workOrderNo,
    subject: row.subject,
    customerName: row.customer?.name ?? '—',
    locationName: row.serviceLocation?.name ?? row.serviceLocation?.address ?? null,
    type: row.type,
    priority: row.priority,
    status: row.status as BoardWorkOrder['status'],
    scheduledStart: row.scheduledStart?.toISOString() ?? null,
    scheduledEnd: row.scheduledEnd?.toISOString() ?? null,
    slaDueAt: row.slaDueAt?.toISOString() ?? null,
    slaBreached: sla.breached,
    slaAtRisk: sla.atRisk,
    requiredSkillKeys,
  };
}

type AssignableMemberRow = {
  id: string;
  branchScope: unknown;
  user: { id: string; displayName: string; emailNormalized: string };
  role: {
    key: string;
    name: string;
    rolePermissions: Array<{ permissionKey: string }>;
  };
};

@Injectable()
export class DispatchService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly scheduleConflicts: ScheduleConflictService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  // ------------------------- Pano -------------------------

  async getBoard(
    tenantId: string,
    query: { date?: string },
    viewer: { userId: string; permissions: Set<string> },
  ): Promise<DispatchBoardResponse> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const timeZone = tenant?.timezone ?? 'Europe/Istanbul';

      const now = new Date();
      const dayDate = query.date ? parseLocalDate(query.date) : localDateOf(now, timeZone);
      const dayBounds = localDayBoundsUtc(dayDate, timeZone);
      const dayStart = dayBounds.start;
      const dayEnd = dayBounds.end;

      // Atanabilir üyeler (iş emri servisiyle aynı filtre).
      const members = await this.loadAssignableMembers(tx, tenantId);
      const memberByUser = new Map(members.map((member) => [member.user.id, member]));
      const assignableUserIds = [...memberByUser.keys()];

      const [
        profiles,
        userSkills,
        teamMemberships,
        timeOffs,
        dayOrders,
        queueRows,
        slaRows,
        teams,
        categorySkills,
      ] = await Promise.all([
        tx.technicianProfile.findMany({
          where: { tenantId, userId: { in: assignableUserIds } },
          include: { workingHours: true },
        }),
        tx.userSkill.findMany({
          where: { tenantId, userId: { in: assignableUserIds } },
          include: { skill: true },
          orderBy: { skill: { key: 'asc' } },
        }),
        tx.teamMember.findMany({
          where: { tenantId, userId: { in: assignableUserIds } },
          include: { team: { select: { id: true, name: true, code: true } } },
        }),
        tx.timeOff.findMany({
          where: {
            tenantId,
            status: 'ACTIVE',
            startAt: { lt: dayEnd },
            endAt: { gt: dayStart },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            reason: true,
            profile: { select: { userId: true } },
          },
        }),
        tx.workOrder.findMany({
          where: {
            tenantId,
            assignedToId: { in: assignableUserIds },
            scheduledStart: { lt: dayEnd },
            scheduledEnd: { gt: dayStart },
          },
          select: BOARD_WO_SELECT,
          orderBy: { scheduledStart: 'asc' },
        }),
        tx.workOrder.findMany({
          where: {
            tenantId,
            status: { notIn: [...TERMINAL_WO_STATUSES] },
            OR: [{ assignedToId: null }, { scheduledStart: null }, { scheduledEnd: null }],
          },
          select: BOARD_WO_SELECT,
          take: 100,
          orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'desc' }],
        }),
        tx.workOrder.findMany({
          where: {
            tenantId,
            status: { notIn: [...TERMINAL_WO_STATUSES] },
            slaDueAt: { not: null, lt: new Date(now.getTime() + SLA_AT_RISK_MINUTES * 60_000) },
          },
          select: BOARD_WO_SELECT,
          take: 50,
          orderBy: { slaDueAt: 'asc' },
        }),
        tx.team.findMany({
          where: { tenantId },
          include: { members: { select: { userId: true } } },
          orderBy: { name: 'asc' },
        }),
        tx.serviceCategorySkill.findMany({
          where: { tenantId },
          include: { skill: { select: { key: true } } },
        }),
      ]);

      const profileByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
      const skillsByCategory = new Map<string, string[]>();
      for (const link of categorySkills) {
        const list = skillsByCategory.get(link.categoryId) ?? [];
        list.push(link.skill.key);
        skillsByCategory.set(link.categoryId, list);
      }
      const requiredKeysFor = (row: BoardWoRow): string[] =>
        row.request?.categoryId ? (skillsByCategory.get(row.request.categoryId) ?? []) : [];
      const skillsByUser = new Map<
        string,
        Array<{ skillId: string; key: string; name: string; level: number }>
      >();
      for (const userSkill of userSkills) {
        const list = skillsByUser.get(userSkill.userId) ?? [];
        list.push({
          skillId: userSkill.skillId,
          key: userSkill.skill.key,
          name: userSkill.skill.name,
          level: userSkill.level,
        });
        skillsByUser.set(userSkill.userId, list);
      }
      const teamByUser = new Map(teamMemberships.map((member) => [member.userId, member.team]));
      const timeOffsByUser = new Map<
        string,
        Array<{ start: Date; end: Date; reason: string | null }>
      >();
      for (const off of timeOffs) {
        const list = timeOffsByUser.get(off.profile.userId) ?? [];
        list.push({ start: off.startAt, end: off.endAt, reason: off.reason });
        timeOffsByUser.set(off.profile.userId, list);
      }
      const ordersByUser = new Map<string, BoardWoRow[]>();
      for (const order of dayOrders) {
        const list = ordersByUser.get(order.assignedToId!) ?? [];
        list.push(order);
        ordersByUser.set(order.assignedToId!, list);
      }

      const conflicts: TechnicianConflict[] = [];
      const seenOverlapPairs = new Set<string>();

      const technicianColumns = [...memberByUser.values()].map((member) => {
        const profile = profileByUser.get(member.user.id);
        const rules = (profile?.workingHours ?? []).map((hour) => ({
          weekday: hour.weekday,
          startMinute: hour.startMinute,
          endMinute: hour.endMinute,
        }));
        const workingWindows = workingWindowsForLocalDate(rules, dayDate, timeZone);
        const dayUserTimeOffs = timeOffsByUser.get(member.user.id) ?? [];
        const dayOrdersForUser = ordersByUser.get(member.user.id) ?? [];

        const capacity: CapacitySummary = capacitySummary({
          workingWindows,
          dailyCapacityMinutes: profile?.dailyCapacityMinutes ?? 480,
          scheduledWindows: dayOrdersForUser
            .filter((order) => order.scheduledStart && order.scheduledEnd)
            .map((order) => ({ start: order.scheduledStart!, end: order.scheduledEnd! })),
          dayBounds: { start: dayStart, end: dayEnd },
        });

        // Gün içi çakışma tespiti (pano uyarı paneli) — motor aynı kaynak.
        const activeOrders = dayOrdersForUser.filter(
          (order) =>
            !(TERMINAL_WO_STATUSES as readonly string[]).includes(order.status) &&
            order.scheduledStart &&
            order.scheduledEnd,
        );
        for (const order of activeOrders) {
          const orderConflicts = findScheduleConflicts({
            window: { start: order.scheduledStart!, end: order.scheduledEnd! },
            otherOrders: activeOrders
              .filter((other) => other.id !== order.id)
              .map((other) => ({
                workOrderId: other.id,
                workOrderNo: other.workOrderNo,
                start: other.scheduledStart!,
                end: other.scheduledEnd!,
              })),
            workingWindows,
            hasWorkingHours: rules.length > 0,
            timeOffs: dayUserTimeOffs.map((off, index) => ({
              timeOffId: `${member.user.id}:${index}`,
              start: off.start,
              end: off.end,
              reason: off.reason,
            })),
          });
          for (const conflict of orderConflicts) {
            if (conflict.type === 'OVERLAP') {
              const pairKey = [order.id, conflict.workOrderId ?? ''].sort().join('|');
              if (seenOverlapPairs.has(pairKey)) continue;
              seenOverlapPairs.add(pairKey);
            }
            conflicts.push({
              ...conflict,
              workOrderId: conflict.workOrderId ?? order.id,
              workOrderNo: conflict.workOrderNo ?? order.workOrderNo,
              userId: member.user.id,
              userName: member.user.displayName,
            });
          }
        }

        const team = teamByUser.get(member.user.id);
        return {
          userId: member.user.id,
          displayName: member.user.displayName,
          roleKey: member.role.key,
          territory: profile?.territory ?? null,
          team: team ? { teamId: team.id, name: team.name, code: team.code } : null,
          skills: (skillsByUser.get(member.user.id) ?? []).map((skill) => ({
            skillId: skill.skillId,
            key: skill.key,
            name: skill.name,
            level: skill.level,
          })),
          workingWindows: workingWindows.map((window) => ({
            startAt: window.start.toISOString(),
            endAt: window.end.toISOString(),
          })),
          onTimeOff: dayUserTimeOffs.some((off) =>
            windowsOverlap(off, { start: dayStart, end: dayEnd }),
          ),
          workOrders: dayOrdersForUser.map((order) =>
            toBoardWorkOrder(order, requiredKeysFor(order), now),
          ),
          capacity,
        };
      });

      // Kuyruk: SLA aşımı → öncelik → en yakın SLA sıralı planlama bekleyen işler.
      const queue = queueRows
        .map((row) => toBoardWorkOrder(row, requiredKeysFor(row), now))
        .sort((a, b) => {
          const breached = Number(b.slaBreached) - Number(a.slaBreached);
          if (breached !== 0) return breached;
          const rank = priorityRank(a.priority) - priorityRank(b.priority);
          if (rank !== 0) return rank;
          return (a.slaDueAt ?? '9999').localeCompare(b.slaDueAt ?? '9999');
        });

      const slaAlerts: SlaAlert[] = slaRows.map((row) => {
        const view = toBoardWorkOrder(row, requiredKeysFor(row), now);
        return {
          workOrderId: view.workOrderId,
          workOrderNo: view.workOrderNo,
          subject: view.subject,
          customerName: view.customerName,
          priority: view.priority,
          status: view.status,
          slaDueAt: view.slaDueAt!,
          slaBreached: view.slaBreached,
          slaAtRisk: view.slaAtRisk,
        };
      });

      // Takım kapasite toplamı (pano kolonlarından).
      const columnByUser = new Map(technicianColumns.map((column) => [column.userId, column]));
      const teamCapacities: TeamCapacity[] = teams.map((team) => {
        let capacityMinutes = 0;
        let scheduledMinutes = 0;
        let memberCount = 0;
        for (const member of team.members) {
          memberCount += 1;
          const column = columnByUser.get(member.userId);
          if (column) {
            capacityMinutes += column.capacity.capacityMinutes;
            scheduledMinutes += column.capacity.scheduledMinutes;
          }
        }
        return {
          teamId: team.id,
          name: team.name,
          code: team.code,
          memberCount,
          capacity: {
            capacityMinutes,
            scheduledMinutes,
            utilizationPct:
              capacityMinutes > 0 ? Math.round((scheduledMinutes / capacityMinutes) * 100) : 0,
          },
        };
      });

      void viewer; // Pano görünümü izinden bağımsız (controller view_all zorlar).
      return {
        date: localDateKey(dayDate),
        timezone: timeZone,
        dayStartsAt: dayStart.toISOString(),
        dayEndsAt: dayEnd.toISOString(),
        technicians: technicianColumns,
        queue,
        slaAlerts,
        conflicts,
        teams: teamCapacities,
      };
    });
  }

  // ------------------------- Teknisyenler -------------------------

  async listTechnicians(tenantId: string): Promise<TechnicianProfileView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const members = await this.loadAssignableMembers(tx, tenantId);
      const userIds = members.map((member) => member.user.id);
      const [profiles, userSkills, teamMemberships] = await Promise.all([
        tx.technicianProfile.findMany({
          where: { tenantId, userId: { in: userIds } },
          include: { workingHours: true },
        }),
        tx.userSkill.findMany({
          where: { tenantId, userId: { in: userIds } },
          include: { skill: true },
          orderBy: { skill: { key: 'asc' } },
        }),
        tx.teamMember.findMany({
          where: { tenantId, userId: { in: userIds } },
          include: { team: { select: { id: true, name: true, code: true } } },
        }),
      ]);
      const profileByUser = new Map(profiles.map((profile) => [profile.userId, profile]));
      const teamByUser = new Map(teamMemberships.map((member) => [member.userId, member.team]));

      return members
        .map((member) => {
          const profile = profileByUser.get(member.user.id);
          const skills: UserSkillView[] = userSkills
            .filter((userSkill) => userSkill.userId === member.user.id)
            .map((userSkill) => ({
              skillId: userSkill.skillId,
              key: userSkill.skill.key,
              name: userSkill.skill.name,
              level: userSkill.level,
            }));
          const team = teamByUser.get(member.user.id);
          return {
            userId: member.user.id,
            membershipId: member.id,
            displayName: member.user.displayName,
            email: member.user.emailNormalized,
            roleKey: member.role.key,
            roleName: member.role.name,
            territory: profile?.territory ?? null,
            dailyCapacityMinutes: profile?.dailyCapacityMinutes ?? 480,
            active: profile?.active ?? true,
            team: team ? { teamId: team.id, name: team.name, code: team.code } : null,
            skills,
          } satisfies TechnicianProfileView;
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));
    });
  }

  async getAvailability(
    tenantId: string,
    userId: string,
    query: AvailabilityQuery,
  ): Promise<AvailabilityResponse> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const timeZone = tenant?.timezone ?? 'Europe/Istanbul';

      const from = parseLocalDate(query.from);
      const to = parseLocalDate(query.to);
      if (
        to.year < from.year ||
        (to.year === from.year && to.month < from.month) ||
        (to.year === from.year && to.month === from.month && to.day < from.day)
      ) {
        throw new BadRequestException({
          message: 'Bitiş tarihi başlangıçtan sonra olmalı',
          code: 'RANGE_INVALID',
        });
      }
      let dayCount = 0;
      for (let cursor = from; !sameLocalDate(cursor, to); cursor = addDaysLocal(cursor, 1)) {
        dayCount += 1;
        if (dayCount > 90) {
          throw new BadRequestException({
            message: 'Müsaitlik aralığı en fazla 91 gün olabilir',
            code: 'RANGE_TOO_LARGE',
          });
        }
      }

      const firstBounds = localDayBoundsUtc(from, timeZone);
      const lastBounds = localDayBoundsUtc(to, timeZone);
      const [profile, timeOffs, orders] = await Promise.all([
        tx.technicianProfile.findFirst({
          where: { tenantId, userId: member.user.id },
          include: { workingHours: true },
        }),
        tx.timeOff.findMany({
          where: {
            tenantId,
            profile: { userId: member.user.id },
            status: 'ACTIVE',
            startAt: { lt: lastBounds.end },
            endAt: { gt: firstBounds.start },
          },
          orderBy: { startAt: 'asc' },
        }),
        tx.workOrder.findMany({
          where: {
            tenantId,
            assignedToId: member.user.id,
            status: { notIn: [...TERMINAL_WO_STATUSES] },
            scheduledStart: { not: null, lt: lastBounds.end },
            scheduledEnd: { not: null, gt: firstBounds.start },
          },
          select: BOARD_WO_SELECT,
          orderBy: { scheduledStart: 'asc' },
        }),
      ]);

      const rules = (profile?.workingHours ?? []).map((hour) => ({
        weekday: hour.weekday,
        startMinute: hour.startMinute,
        endMinute: hour.endMinute,
      }));
      const now = new Date();
      const days: AvailabilityDay[] = [];
      let cursor = from;
      for (;;) {
        const bounds = localDayBoundsUtc(cursor, timeZone);
        const workingWindows = workingWindowsForLocalDate(rules, cursor, timeZone);
        const dayTimeOffs = timeOffs.filter((off) =>
          windowsOverlap({ start: off.startAt, end: off.endAt }, bounds),
        );
        const dayOrders = orders.filter(
          (order) =>
            order.scheduledStart &&
            order.scheduledEnd &&
            windowsOverlap({ start: order.scheduledStart, end: order.scheduledEnd }, bounds),
        );
        const freeSlots = freeSlotsForDay({
          workingWindows,
          booked: dayOrders.map((order) => ({
            start: order.scheduledStart!,
            end: order.scheduledEnd!,
          })),
          timeOffs: dayTimeOffs.map((off) => ({ start: off.startAt, end: off.endAt })),
        });
        days.push({
          date: localDateKey(cursor),
          weekday: isoWeekdayOf(cursor),
          workingWindows: workingWindows.map((window) => ({
            startAt: window.start.toISOString(),
            endAt: window.end.toISOString(),
          })),
          timeOffs: dayTimeOffs.map((off) => ({
            timeOffId: off.id,
            userId: member.user.id,
            startAt: off.startAt.toISOString(),
            endAt: off.endAt.toISOString(),
            reason: off.reason,
            status: off.status,
            createdAt: off.createdAt.toISOString(),
          })),
          booked: dayOrders.map((order) => toBoardWorkOrder(order, [], now)),
          freeSlots: freeSlots.map((slot) => ({
            startAt: slot.start.toISOString(),
            endAt: slot.end.toISOString(),
          })),
        });
        if (sameLocalDate(cursor, to)) break;
        cursor = addDaysLocal(cursor, 1);
      }

      return { userId: member.user.id, timezone: timeZone, days };
    });
  }

  // ------------------------- Profil / çalışma saatleri -------------------------

  async upsertProfile(
    tenantId: string,
    userId: string,
    input: TechnicianProfileUpsertRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<TechnicianProfileView> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      await tx.technicianProfile.upsert({
        where: { tenantId_userId: { tenantId, userId: member.user.id } },
        create: {
          tenantId,
          userId: member.user.id,
          ...(input.territory !== undefined ? { territory: input.territory } : {}),
          ...(input.dailyCapacityMinutes !== undefined
            ? { dailyCapacityMinutes: input.dailyCapacityMinutes }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        update: {
          ...(input.territory !== undefined ? { territory: input.territory } : {}),
          ...(input.dailyCapacityMinutes !== undefined
            ? { dailyCapacityMinutes: input.dailyCapacityMinutes }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.profile.upsert',
        resourceType: 'technician_profile',
        resourceId: member.user.id,
        requestId: actor.requestId,
        metadata: { ...input },
      });
    });
    const technicians = await this.listTechnicians(tenantId);
    const view = technicians.find((tech) => tech.userId === userId);
    if (!view) throw notFound('Teknisyen bulunamadı');
    return view;
  }

  /** Mevcut çalışma pencere kümesi (PUT toplu değiştirmenin okuma ucu). */
  async getWorkingHours(tenantId: string, userId: string): Promise<WorkingHourView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const rows = await tx.workingHour.findMany({
        where: { tenantId, profile: { userId: member.user.id } },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });
      return rows.map((row) => ({
        workingHourId: row.id,
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      }));
    });
  }

  async upsertWorkingHours(
    tenantId: string,
    userId: string,
    input: WorkingHoursUpsertRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<WorkingHourView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const profile = await tx.technicianProfile.upsert({
        where: { tenantId_userId: { tenantId, userId: member.user.id } },
        create: { tenantId, userId: member.user.id },
        update: {},
      });
      // Toplu değiştirme: eski pencereler silinir, yeni set yazılır.
      await tx.workingHour.deleteMany({ where: { tenantId, profileId: profile.id } });
      if (input.hours.length > 0) {
        await tx.workingHour.createMany({
          data: input.hours.map((hour) => ({
            tenantId,
            profileId: profile.id,
            weekday: hour.weekday,
            startMinute: hour.startMinute,
            endMinute: hour.endMinute,
          })),
        });
      }
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.working_hours.upsert',
        resourceType: 'technician_profile',
        resourceId: profile.id,
        requestId: actor.requestId,
        metadata: { hours: input.hours.length },
      });
      const rows = await tx.workingHour.findMany({
        where: { tenantId, profileId: profile.id },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });
      return rows.map((row) => ({
        workingHourId: row.id,
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      }));
    });
  }

  // ------------------------- İzinler -------------------------

  async createTimeOff(
    tenantId: string,
    userId: string,
    input: TimeOffCreate,
    actor: { userId: string; requestId?: string },
  ): Promise<TimeOffView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const profile = await tx.technicianProfile.upsert({
        where: { tenantId_userId: { tenantId, userId: member.user.id } },
        create: { tenantId, userId: member.user.id },
        update: {},
      });
      const created = await tx.timeOff.create({
        data: {
          tenantId,
          profileId: profile.id,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          reason: input.reason ?? null,
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.time_off.create',
        resourceType: 'time_off',
        resourceId: created.id,
        requestId: actor.requestId,
        metadata: { userId: member.user.id, startAt: input.startAt, endAt: input.endAt },
      });
      return {
        timeOffId: created.id,
        userId: member.user.id,
        startAt: created.startAt.toISOString(),
        endAt: created.endAt.toISOString(),
        reason: created.reason,
        status: created.status,
        createdAt: created.createdAt.toISOString(),
      };
    });
  }

  async cancelTimeOff(
    tenantId: string,
    timeOffId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<TimeOffView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.timeOff.findFirst({
        where: { id: timeOffId, tenantId },
        include: { profile: { select: { userId: true } } },
      });
      if (!existing) throw notFound('İzin kaydı bulunamadı');
      if (existing.status === 'CANCELLED') {
        throw new ConflictException({
          message: 'İzin zaten iptal edilmiş',
          code: 'TIME_OFF_ALREADY_CANCELLED',
        });
      }
      const updated = await tx.timeOff.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED' },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.time_off.cancel',
        resourceType: 'time_off',
        resourceId: updated.id,
        requestId: actor.requestId,
        metadata: {},
      });
      return {
        timeOffId: updated.id,
        userId: existing.profile.userId,
        startAt: updated.startAt.toISOString(),
        endAt: updated.endAt.toISOString(),
        reason: updated.reason,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  }

  // ------------------------- Yetenekler -------------------------

  async listSkills(tenantId: string): Promise<SkillView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const rows = await tx.skill.findMany({ where: { tenantId }, orderBy: { key: 'asc' } });
      return rows.map((row) => ({
        skillId: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
      }));
    });
  }

  async createSkill(
    tenantId: string,
    input: CreateSkillRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<SkillView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.skill.findFirst({
        where: { tenantId, key: input.key },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          message: 'Bu anahtara sahip yetenek zaten var',
          code: 'SKILL_KEY_EXISTS',
        });
      }
      const created = await tx.skill.create({
        data: {
          tenantId,
          key: input.key,
          name: input.name,
          description: input.description ?? null,
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.skill.create',
        resourceType: 'skill',
        resourceId: created.id,
        requestId: actor.requestId,
        metadata: { key: input.key },
      });
      return {
        skillId: created.id,
        key: created.key,
        name: created.name,
        description: created.description,
      };
    });
  }

  async setUserSkill(
    tenantId: string,
    userId: string,
    input: SetUserSkillRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<UserSkillView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const skill = await tx.skill.findFirst({
        where: { id: input.skillId, tenantId },
        select: { id: true, key: true, name: true },
      });
      if (!skill) throw notFound('Yetenek bulunamadı');
      const saved = await tx.userSkill.upsert({
        where: {
          tenantId_userId_skillId: { tenantId, userId: member.user.id, skillId: skill.id },
        },
        create: { tenantId, userId: member.user.id, skillId: skill.id, level: input.level },
        update: { level: input.level },
        include: { skill: true },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.user_skill.set',
        resourceType: 'user_skill',
        resourceId: `${member.user.id}:${skill.id}`,
        requestId: actor.requestId,
        metadata: { userId: member.user.id, skillKey: skill.key, level: input.level },
      });
      return {
        skillId: saved.skillId,
        key: saved.skill.key,
        name: saved.skill.name,
        level: saved.level,
      };
    });
  }

  async removeUserSkill(
    tenantId: string,
    userId: string,
    skillId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const existing = await tx.userSkill.findFirst({
        where: { tenantId, userId: member.user.id, skillId },
        select: { id: true },
      });
      if (!existing) throw notFound('Yetenek ataması bulunamadı');
      await tx.userSkill.delete({ where: { id: existing.id } });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.user_skill.remove',
        resourceType: 'user_skill',
        resourceId: existing.id,
        requestId: actor.requestId,
        metadata: { userId: member.user.id, skillId },
      });
    });
  }

  /** Kategoriye zorunlu yetenek ekleme (danışma eşleştirme kaynağı). */
  async addCategorySkill(
    tenantId: string,
    categoryId: string,
    skillId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const category = await tx.serviceCategory.findFirst({
        where: { id: categoryId, tenantId },
        select: { id: true, key: true },
      });
      if (!category) throw notFound('Kategori bulunamadı');
      const skill = await tx.skill.findFirst({
        where: { id: skillId, tenantId },
        select: { id: true, key: true },
      });
      if (!skill) throw notFound('Yetenek bulunamadı');
      await tx.serviceCategorySkill.upsert({
        where: {
          tenantId_categoryId_skillId: { tenantId, categoryId, skillId },
        },
        create: { tenantId, categoryId, skillId },
        update: {},
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.category_skill.add',
        resourceType: 'service_category',
        resourceId: categoryId,
        requestId: actor.requestId,
        metadata: { categoryKey: category.key, skillKey: skill.key },
      });
    });
  }

  async removeCategorySkill(
    tenantId: string,
    categoryId: string,
    skillId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.serviceCategorySkill.findFirst({
        where: { tenantId, categoryId, skillId },
        select: { id: true },
      });
      if (!existing) throw notFound('Kategori yetenek eşlemesi bulunamadı');
      await tx.serviceCategorySkill.delete({ where: { id: existing.id } });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.category_skill.remove',
        resourceType: 'service_category',
        resourceId: categoryId,
        requestId: actor.requestId,
        metadata: { skillId },
      });
    });
  }

  // ------------------------- Çakışma listesi -------------------------

  /** Belirtilen günün pano çakışmaları (panonun alt kümesi). */
  async listConflicts(tenantId: string, query: ConflictListQuery): Promise<TechnicianConflict[]> {
    const board = await this.getBoard(tenantId, query.from ? { date: query.from } : {}, {
      userId: '',
      permissions: new Set(),
    });
    void query.to;
    return board.conflicts;
  }

  // ------------------------- Planlama (tek adım) -------------------------

  async scheduleWorkOrder(
    tenantId: string,
    workOrderId: string,
    input: ScheduleWorkOrderRequest,
    actor: { userId: string; requestId?: string; permissions: Set<string> },
  ): Promise<ScheduleWorkOrderResponse> {
    // Kaynağı yükle ve planlanabilir durumda doğrula; çakışmayı ÖNDEN denetle
    // (mutasyondan önce 409 — DRAFT→PLANNED yarım kalmasın).
    const current = await this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: {
          id: true,
          status: true,
          assignedToId: true,
          scheduledStart: true,
          scheduledEnd: true,
          version: true,
        },
      });
      if (!workOrder) throw notFound('İş emri bulunamadı');
      if (!['DRAFT', 'PLANNED', 'ASSIGNED'].includes(workOrder.status)) {
        throw new ConflictException({
          message: 'Bu durumdaki iş emri planlamaya açık değil',
          code: 'NOT_SCHEDULABLE',
        });
      }
      const targetAssignee =
        input.assigneeUserId ??
        (workOrder.status === 'ASSIGNED' ? (workOrder.assignedToId ?? undefined) : undefined);
      if (targetAssignee) {
        await this.scheduleConflicts.assertNoConflicts(
          tx,
          tenantId,
          {
            assigneeUserId: targetAssignee,
            window: { start: new Date(input.scheduledStart), end: new Date(input.scheduledEnd) },
            excludeWorkOrderId: workOrder.id,
          },
          { requested: input.overrideConflict === true, reason: input.overrideReason },
          actor.permissions,
        );
      }
      return workOrder;
    });

    const skillWarnings = await this.computeSkillWarnings(
      tenantId,
      workOrderId,
      input.assigneeUserId ??
        (current.status === 'ASSIGNED' ? (current.assignedToId ?? undefined) : undefined),
    );

    const override =
      input.overrideConflict === true
        ? {
            overrideConflict: true as const,
            ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
          }
        : {};
    const expectedVersion = input.expectedVersion ?? current.version;

    // DRAFT → önce PLAN (pencereyi kur), istenirse ASSIGN.
    if (current.status === 'DRAFT') {
      const planned = await this.workOrders.transitionWorkOrder(
        tenantId,
        workOrderId,
        {
          to: 'PLANNED',
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
          expectedVersion,
        },
        actor,
      );
      if (input.assigneeUserId) {
        return {
          workOrder: WorkOrdersService.toView(
            await this.workOrders.transitionWorkOrder(
              tenantId,
              workOrderId,
              {
                to: 'ASSIGNED',
                assigneeUserId: input.assigneeUserId,
                ...override,
                // expectedVersion bilinçli verilmez: PLAN sonrası sürüm
                // değişmiştir; sürüm kuralı tek adımda zaten doğrulandı.
              },
              actor,
            ),
          ),
          skillWarnings,
        };
      }
      return { workOrder: WorkOrdersService.toView(planned), skillWarnings: [] };
    }

    // ASSIGNED + teknisyen değişimi → UNASSIGN, sonra yeni ASSIGN.
    if (
      current.status === 'ASSIGNED' &&
      input.assigneeUserId &&
      input.assigneeUserId !== current.assignedToId
    ) {
      await this.workOrders.transitionWorkOrder(
        tenantId,
        workOrderId,
        { to: 'PLANNED', expectedVersion },
        actor,
      );
      return {
        workOrder: WorkOrdersService.toView(
          await this.workOrders.transitionWorkOrder(
            tenantId,
            workOrderId,
            {
              to: 'ASSIGNED',
              assigneeUserId: input.assigneeUserId,
              scheduledStart: input.scheduledStart,
              scheduledEnd: input.scheduledEnd,
              ...override,
              // expectedVersion bilinçli verilmez (UNASSIGN sürümü değiştirdi).
            },
            actor,
          ),
        ),
        skillWarnings,
      };
    }

    // PLANNED / ASSIGNED (aynı teknisyen): pencere PATCH ile güncellenir
    // (çakışma denetimi PATCH koruyucusunda da çalışır).
    if (current.status === 'PLANNED' && input.assigneeUserId) {
      // PLANNED + atama: önce pencereyi güncelle, sonra ata.
      if (
        current.scheduledStart?.toISOString() !== input.scheduledStart ||
        current.scheduledEnd?.toISOString() !== input.scheduledEnd
      ) {
        await this.workOrders.updateWorkOrder(
          tenantId,
          workOrderId,
          {
            scheduledStart: input.scheduledStart,
            scheduledEnd: input.scheduledEnd,
            ...override,
            expectedVersion,
          },
          actor,
        );
      }
      return {
        workOrder: WorkOrdersService.toView(
          await this.workOrders.transitionWorkOrder(
            tenantId,
            workOrderId,
            {
              to: 'ASSIGNED',
              assigneeUserId: input.assigneeUserId,
              ...override,
              // expectedVersion bilinçli verilmez (PATCH sürümü değiştirdi).
            },
            actor,
          ),
        ),
        skillWarnings,
      };
    }

    await this.workOrders.updateWorkOrder(
      tenantId,
      workOrderId,
      {
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        ...override,
        expectedVersion,
      },
      actor,
    );
    const workOrder = await this.loadWorkOrderView(tenantId, workOrderId);
    return { workOrder, skillWarnings };
  }

  /** Atanan teknisyenin EKSİK kategori yetenekleri (danışma; ADR-0008). */
  private async computeSkillWarnings(
    tenantId: string,
    workOrderId: string,
    assigneeUserId: string | undefined,
  ): Promise<string[]> {
    if (!assigneeUserId) return [];
    return this.scoped.withTenant(tenantId, async (tx) => {
      const workOrder = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        select: { request: { select: { categoryId: true } } },
      });
      const categoryId = workOrder?.request?.categoryId;
      if (!categoryId) return [];
      const [links, userSkills] = await Promise.all([
        tx.serviceCategorySkill.findMany({
          where: { tenantId, categoryId },
          include: { skill: { select: { key: true } } },
        }),
        tx.userSkill.findMany({
          where: { tenantId, userId: assigneeUserId },
          select: { skill: { select: { key: true } } },
        }),
      ]);
      const requiredKeys = links.map((link) => link.skill.key);
      const owned = userSkills.map((userSkill) => ({ key: userSkill.skill.key, level: 3 }));
      return matchSkills(requiredKeys, owned).missing;
    });
  }

  private async loadWorkOrderView(tenantId: string, workOrderId: string): Promise<WorkOrderView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const row = await tx.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        include: {
          customer: { select: { id: true, name: true } },
          asset: { select: { id: true, assetTag: true } },
          serviceLocation: { select: { id: true, name: true, address: true } },
          branch: { select: { id: true, name: true, code: true } },
          assignedTo: { select: { id: true, displayName: true } },
          request: { select: { id: true, subject: true, status: true } },
        },
      });
      if (!row) throw notFound('İş emri bulunamadı');
      return WorkOrdersService.toView(row);
    });
  }

  // ------------------------- Takımlar -------------------------

  async listTeams(tenantId: string): Promise<TeamView[]> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const teams = await tx.team.findMany({
        where: { tenantId },
        include: { branch: { select: { name: true } }, members: { select: { userId: true } } },
        orderBy: { name: 'asc' },
      });
      return teams.map((team) => ({
        teamId: team.id,
        name: team.name,
        code: team.code,
        branchId: team.branchId,
        branchName: team.branch?.name ?? null,
        memberCount: team.members.length,
        createdAt: team.createdAt.toISOString(),
      }));
    });
  }

  async createTeam(
    tenantId: string,
    input: CreateTeamRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<TeamView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      if (input.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: input.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw notFound('Şube bulunamadı');
      }
      const duplicate = await tx.team.findFirst({
        where: { tenantId, code: input.code },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({
          message: 'Bu kodla bir takım zaten var',
          code: 'TEAM_CODE_EXISTS',
        });
      }
      const created = await tx.team.create({
        data: {
          tenantId,
          name: input.name,
          code: input.code,
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.team.create',
        resourceType: 'team',
        resourceId: created.id,
        requestId: actor.requestId,
        metadata: { code: input.code, name: input.name },
      });
      return {
        teamId: created.id,
        name: created.name,
        code: created.code,
        branchId: created.branchId,
        branchName: null,
        memberCount: 0,
        createdAt: created.createdAt.toISOString(),
      };
    });
  }

  async updateTeam(
    tenantId: string,
    teamId: string,
    input: UpdateTeamRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<TeamView> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.team.findFirst({
        where: { id: teamId, tenantId },
        include: { branch: { select: { name: true } }, members: { select: { userId: true } } },
      });
      if (!existing) throw notFound('Takım bulunamadı');
      if (input.code && input.code !== existing.code) {
        const duplicate = await tx.team.findFirst({
          where: { tenantId, code: input.code, id: { not: teamId } },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException({
            message: 'Bu kodla bir takım zaten var',
            code: 'TEAM_CODE_EXISTS',
          });
        }
      }
      if (input.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: input.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw notFound('Şube bulunamadı');
      }
      const data: Prisma.TeamUpdateInput = {
        ...(input.name ? { name: input.name } : {}),
        ...(input.code ? { code: input.code } : {}),
        ...(input.branchId !== undefined
          ? input.branchId
            ? { branch: { connect: { id: input.branchId } } }
            : { branch: { disconnect: true } }
          : {}),
      };
      const updated = await tx.team.update({
        where: { id: existing.id },
        data,
        include: { branch: { select: { name: true } }, members: { select: { userId: true } } },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.team.update',
        resourceType: 'team',
        resourceId: updated.id,
        requestId: actor.requestId,
        metadata: { ...input },
      });
      return {
        teamId: updated.id,
        name: updated.name,
        code: updated.code,
        branchId: updated.branchId,
        branchName: updated.branch?.name ?? null,
        memberCount: updated.members.length,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  }

  async deleteTeam(
    tenantId: string,
    teamId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.team.findFirst({
        where: { id: teamId, tenantId },
        select: { id: true, code: true },
      });
      if (!existing) throw notFound('Takım bulunamadı');
      await tx.teamMember.deleteMany({ where: { tenantId, teamId: existing.id } });
      await tx.team.delete({ where: { id: existing.id } });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.team.delete',
        resourceType: 'team',
        resourceId: existing.id,
        requestId: actor.requestId,
        metadata: { code: existing.code },
      });
    });
  }

  async addTeamMember(
    tenantId: string,
    teamId: string,
    userId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const team = await tx.team.findFirst({
        where: { id: teamId, tenantId },
        select: { id: true, name: true },
      });
      if (!team) throw notFound('Takım bulunamadı');
      const member = await this.loadAssignableMember(tx, tenantId, userId);
      const existingMembership = await tx.teamMember.findFirst({
        where: { tenantId, userId: member.user.id },
        include: { team: { select: { name: true } } },
      });
      if (existingMembership) {
        if (existingMembership.teamId === team.id) return; // idempotent yeniden ekleme
        throw new ConflictException({
          message: `Kullanıcı zaten ${existingMembership.team.name} takımında`,
          code: 'TEAM_MEMBER_EXISTS',
        });
      }
      await tx.teamMember.create({
        data: { tenantId, teamId: team.id, userId: member.user.id },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.team.member_add',
        resourceType: 'team',
        resourceId: team.id,
        requestId: actor.requestId,
        metadata: { userId: member.user.id },
      });
    });
  }

  async removeTeamMember(
    tenantId: string,
    teamId: string,
    userId: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    await this.scoped.withTenant(tenantId, async (tx) => {
      const team = await tx.team.findFirst({
        where: { id: teamId, tenantId },
        select: { id: true },
      });
      if (!team) throw notFound('Takım bulunamadı');
      const existing = await tx.teamMember.findFirst({
        where: { tenantId, teamId: team.id, userId },
        select: { id: true },
      });
      if (!existing) throw notFound('Takım üyeliği bulunamadı');
      await tx.teamMember.delete({ where: { id: existing.id } });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'dispatch.team.member_remove',
        resourceType: 'team',
        resourceId: team.id,
        requestId: actor.requestId,
        metadata: { userId },
      });
    });
  }

  // ------------------------- Yardımcılar -------------------------

  /** Atanabilir üyelikler (iş emri servisiyle AYNI filtre). */
  private async loadAssignableMembers(
    tx: ScopedClient,
    tenantId: string,
  ): Promise<AssignableMemberRow[]> {
    const memberships = await tx.membership.findMany({
      where: { tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: {
        user: { select: { id: true, displayName: true, emailNormalized: true } },
        role: { include: { rolePermissions: { select: { permissionKey: true } } } },
      },
      orderBy: { user: { displayName: 'asc' } },
    });
    const assignable = memberships.filter((membership) => {
      const keys = new Set(membership.role.rolePermissions.map((p) => p.permissionKey));
      return keys.has('work_orders:complete') || keys.has('work_orders:view_assigned');
    });
    return assignable.map((membership) => ({
      id: membership.id,
      branchScope: membership.branchScope,
      user: membership.user,
      role: membership.role,
    }));
  }

  /** Tek atanabilir üye (kiracı dışı → 404, varlık sızıntısı yok). */
  private async loadAssignableMember(tx: ScopedClient, tenantId: string, userId: string) {
    const membership = await tx.membership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: {
        user: { select: { id: true, displayName: true } },
        role: { include: { rolePermissions: { select: { permissionKey: true } } } },
      },
    });
    if (!membership) throw notFound('Teknisyen bulunamadı');
    const keys = new Set(membership.role.rolePermissions.map((p) => p.permissionKey));
    if (!keys.has('work_orders:complete') && !keys.has('work_orders:view_assigned')) {
      throw new BadRequestException({
        message: 'Bu üye atanabilir (teknisyen) rolde değil',
        code: 'NOT_ASSIGNABLE',
      });
    }
    return membership;
  }
}
