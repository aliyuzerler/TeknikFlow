import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CancelServiceRequestRequest,
  ConvertServiceRequestRequest,
  CreateServiceCategoryRequest,
  CreateServiceRequestRequest,
  RequestSource,
  ServicePriority,
  ServiceRequestListQuery,
  ServiceRequestView,
  UpsertSlaPolicyRequest,
  WorkOrderView,
} from '@teknikflow/contracts';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizeName } from '../crm/crm-utils.js';
import { WorkOrdersService } from './work-orders.service.js';
import { isConvertible, isRequestTransitionAllowed } from './request-state.js';
import { computeSlaDueAt, defaultResolveMinutes } from './sla.js';

/**
 * Faz 05 — servis talebi (intake) servisi: gelen kutusu, triyaj, SLA ve
 * iş emrine dönüşüm. Tüm erişim kiracı kapsamlı (RLS); çapraz-kiracı
 * kimlik → 404 (varlık sızıntısı yok). slaDueAt, kiracı SLA politikası
 * yoksa varsayılan katalogla createdAt'ten hesaplanır.
 */

const REQUEST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  asset: { select: { id: true, assetTag: true } },
  category: { select: { id: true, key: true, name: true } },
  convertedWorkOrder: { select: { id: true, workOrderNo: true } },
} as const;

type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

@Injectable()
export class RequestsService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
    private readonly workOrders: WorkOrdersService,
  ) {}

  // ------------------------- Liste -------------------------

  async listRequests(tenantId: string, query: ServiceRequestListQuery) {
    const where: Prisma.ServiceRequestWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.q
        ? {
            OR: [
              { subject: { contains: query.q, mode: 'insensitive' } },
              { customer: { nameNormalized: { contains: normalizeName(query.q) } } },
            ],
          }
        : {}),
    };
    return this.scoped.withTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.serviceRequest.findMany({
          where,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: REQUEST_INCLUDE,
        }),
        tx.serviceRequest.count({ where }),
      ]);
      return { rows: rows as RequestRow[], total };
    });
  }

  async getRequest(tenantId: string, requestId: string): Promise<RequestRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const request = (await tx.serviceRequest.findFirst({
        where: { id: requestId, tenantId },
        include: REQUEST_INCLUDE,
      })) as RequestRow | null;
      if (!request) throw notFound();
      return request;
    });
  }

  /** Talep etkinlik geçmişi — crm_events üstünden (metadataJson.requestId). */
  async requestTimeline(tenantId: string, requestId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const request = await tx.serviceRequest.findFirst({
        where: { id: requestId, tenantId },
        select: { id: true },
      });
      if (!request) throw notFound();
      const events = await tx.crmEvent.findMany({
        where: {
          tenantId,
          metadataJson: { path: ['requestId'], equals: requestId },
        },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      });
      return events;
    });
  }

  // ------------------------- Oluşturma -------------------------

  async createRequest(
    tenantId: string,
    input: CreateServiceRequestRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<RequestRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      // FK bütünlüğü: referanslar KENDİ kiracısında ve doğru müşteriye ait.
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, tenantId },
        select: { id: true, name: true },
      });
      if (!customer) throw notFound();
      if (input.assetId) {
        const asset = await tx.asset.findFirst({
          where: { id: input.assetId, tenantId },
          select: { customerId: true },
        });
        if (!asset) throw notFound('Ekipman bulunamadı');
        if (asset.customerId !== input.customerId) {
          throw new BadRequestException({
            message: 'Ekipman bu müşteriye ait değil',
            code: 'ASSET_CUSTOMER_MISMATCH',
          });
        }
      }
      if (input.serviceLocationId) {
        const location = await tx.serviceLocation.findFirst({
          where: { id: input.serviceLocationId, tenantId },
          select: { customerId: true },
        });
        if (!location) throw notFound('Servis lokasyonu bulunamadı');
        if (location.customerId !== input.customerId) {
          throw new BadRequestException({
            message: 'Lokasyon bu müşteriye ait değil',
            code: 'LOCATION_CUSTOMER_MISMATCH',
          });
        }
      }
      if (input.categoryId) {
        const category = await tx.serviceCategory.findFirst({
          where: { id: input.categoryId, tenantId },
          select: { id: true },
        });
        if (!category) throw notFound('Kategori bulunamadı');
      }

      const now = new Date();
      const resolveMinutes = await this.resolveMinutes(tx, tenantId, input.priority);
      const slaDueAt = computeSlaDueAt(now, resolveMinutes);

      const created = (await tx.serviceRequest.create({
        data: {
          tenantId,
          customerId: input.customerId,
          ...(input.assetId ? { assetId: input.assetId } : {}),
          ...(input.serviceLocationId ? { serviceLocationId: input.serviceLocationId } : {}),
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          source: input.source,
          subject: input.subject,
          ...(input.description ? { description: input.description } : {}),
          priority: input.priority,
          status: 'NEW',
          slaDueAt,
          createdById: actor.userId,
        },
        include: REQUEST_INCLUDE,
      })) as RequestRow;

      await tx.crmEvent.create({
        data: {
          tenantId,
          customerId: input.customerId,
          assetId: input.assetId ?? null,
          eventType: 'service_request.created',
          actorId: actor.userId,
          requestId: actor.requestId ?? null,
          metadataJson: {
            requestId: created.id,
            priority: input.priority,
            source: input.source,
          },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'service_request.create',
        resourceType: 'service_request',
        resourceId: created.id,
        requestId: actor.requestId,
        metadata: { priority: input.priority, source: input.source, customerId: input.customerId },
      });
      return created;
    });
  }

  // ------------------------- Triyaj -------------------------

  async triageRequest(
    tenantId: string,
    requestId: string,
    input: TriageInput,
    actor: { userId: string; requestId?: string },
  ): Promise<RequestRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const current = (await tx.serviceRequest.findFirst({
        where: { id: requestId, tenantId },
        include: REQUEST_INCLUDE,
      })) as RequestRow | null;
      if (!current) throw notFound();
      if (current.status === 'CONVERTED' || current.status === 'CANCELLED') {
        throw new ConflictException({
          message: 'Dönüştürülmüş veya iptal edilmiş talep düzenlenemez',
          code: 'REQUEST_IMMUTABLE',
        });
      }

      // Durum geçişi (yalnız NEW→IN_REVIEW; kendi kendine geçiş geçersiz).
      if (input.status && !isRequestTransitionAllowed(current.status, input.status)) {
        throw new ConflictException({
          message: `'${current.status}' → '${input.status}' talep geçişi izinli değil`,
          code: 'INVALID_TRANSITION',
        });
      }

      // FK doğrulamaları (değişen alanlar için).
      if (input.assetId) {
        const asset = await tx.asset.findFirst({
          where: { id: input.assetId, tenantId, customerId: current.customerId },
          select: { id: true },
        });
        if (!asset) {
          throw new BadRequestException({
            message: 'Ekipman bu müşteriye ait değil ya da bulunamadı',
            code: 'ASSET_CUSTOMER_MISMATCH',
          });
        }
      }
      if (input.serviceLocationId) {
        const location = await tx.serviceLocation.findFirst({
          where: { id: input.serviceLocationId, tenantId, customerId: current.customerId },
          select: { id: true },
        });
        if (!location) {
          throw new BadRequestException({
            message: 'Lokasyon bu müşteriye ait değil ya da bulunamadı',
            code: 'LOCATION_CUSTOMER_MISMATCH',
          });
        }
      }
      if (input.categoryId) {
        const category = await tx.serviceCategory.findFirst({
          where: { id: input.categoryId, tenantId },
          select: { id: true },
        });
        if (!category) throw notFound('Kategori bulunamadı');
      }

      const changed: string[] = [];
      const data: Prisma.ServiceRequestUpdateInput = {};
      if (input.subject !== undefined) {
        data.subject = input.subject;
        changed.push('subject');
      }
      if (input.description !== undefined) {
        data.description = input.description ?? null;
        changed.push('description');
      }
      if (input.categoryId !== undefined) {
        data.category = input.categoryId
          ? { connect: { id: input.categoryId } }
          : { disconnect: true };
        changed.push('categoryId');
      }
      if (input.assetId !== undefined) {
        data.asset = input.assetId ? { connect: { id: input.assetId } } : { disconnect: true };
        changed.push('assetId');
      }
      if (input.serviceLocationId !== undefined) {
        data.serviceLocation = input.serviceLocationId
          ? { connect: { id: input.serviceLocationId } }
          : { disconnect: true };
        changed.push('serviceLocationId');
      }
      if (input.priority !== undefined && input.priority !== current.priority) {
        data.priority = input.priority;
        changed.push('priority');
        // Öncelik değişti → SLA referans (createdAt) ile yeniden hesap.
        const resolveMinutes = await this.resolveMinutes(tx, tenantId, input.priority);
        data.slaDueAt = computeSlaDueAt(current.createdAt, resolveMinutes);
      }
      if (input.status !== undefined && input.status !== current.status) {
        data.status = input.status;
        changed.push('status');
      }
      if (changed.length === 0) {
        throw new BadRequestException({ message: 'Güncellenecek alan yok', code: 'NO_FIELDS' });
      }

      const updated = (await tx.serviceRequest.update({
        where: { id: current.id },
        data,
        include: REQUEST_INCLUDE,
      })) as RequestRow;

      await tx.crmEvent.create({
        data: {
          tenantId,
          customerId: current.customerId,
          assetId: updated.assetId ?? null,
          eventType: 'service_request.updated',
          actorId: actor.userId,
          requestId: actor.requestId ?? null,
          metadataJson: { requestId: current.id, fields: changed },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'service_request.triage',
        resourceType: 'service_request',
        resourceId: current.id,
        requestId: actor.requestId,
        metadata: { fields: changed },
      });
      return updated;
    });
  }

  // ------------------------- Dönüşüm -------------------------

  /** Talebi iş emrine dönüştürür — birebir; iş emri servisi talebi kapatır. */
  async convertRequest(
    tenantId: string,
    requestId: string,
    input: ConvertServiceRequestRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<{ request: RequestRow; workOrder: WorkOrderView }> {
    const request = await this.getRequest(tenantId, requestId);
    if (!isConvertible(request.status)) {
      throw new ConflictException({
        message: 'Talep dönüşüme açık değil (dönüştürülmüş ya da iptal edilmiş)',
        code: 'REQUEST_NOT_CONVERTIBLE',
      });
    }
    const workOrderRow = await this.workOrders.createWorkOrder(
      tenantId,
      {
        customerId: request.customerId,
        ...(request.assetId ? { assetId: request.assetId } : {}),
        ...(request.serviceLocationId ? { serviceLocationId: request.serviceLocationId } : {}),
        requestId: request.id,
        type: input.type,
        priority: input.priority ?? request.priority,
        subject: request.subject,
        description: input.description ?? request.description ?? undefined,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.scheduledStart ? { scheduledStart: input.scheduledStart } : {}),
        ...(input.scheduledEnd ? { scheduledEnd: input.scheduledEnd } : {}),
      },
      actor,
    );
    const converted = await this.getRequest(tenantId, requestId);
    return { request: converted, workOrder: WorkOrdersService.toView(workOrderRow) };
  }

  // ------------------------- İptal -------------------------

  async cancelRequest(
    tenantId: string,
    requestId: string,
    input: CancelServiceRequestRequest,
    actor: { userId: string; requestId?: string },
  ): Promise<RequestRow> {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const current = (await tx.serviceRequest.findFirst({
        where: { id: requestId, tenantId },
        include: REQUEST_INCLUDE,
      })) as RequestRow | null;
      if (!current) throw notFound();
      if (!isRequestTransitionAllowed(current.status, 'CANCELLED')) {
        throw new ConflictException({
          message: 'Dönüştürülmüş veya zaten iptal edilmiş talep iptal edilemez',
          code: 'INVALID_TRANSITION',
        });
      }
      const updated = (await tx.serviceRequest.update({
        where: { id: current.id },
        data: {
          status: 'CANCELLED',
          cancellationReason: input.reasonCode,
          ...(input.note ? { cancellationNote: input.note } : {}),
        },
        include: REQUEST_INCLUDE,
      })) as RequestRow;

      await tx.crmEvent.create({
        data: {
          tenantId,
          customerId: current.customerId,
          assetId: current.assetId ?? null,
          eventType: 'service_request.cancelled',
          actorId: actor.userId,
          requestId: actor.requestId ?? null,
          metadataJson: { requestId: current.id, reasonCode: input.reasonCode },
        },
      });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'service_request.cancel',
        resourceType: 'service_request',
        resourceId: current.id,
        requestId: actor.requestId,
        metadata: { reasonCode: input.reasonCode },
      });
      return updated;
    });
  }

  // ------------------------- Kategoriler / SLA -------------------------

  async listCategories(tenantId: string) {
    return this.scoped.withTenant(tenantId, (tx) =>
      tx.serviceCategory.findMany({ where: { tenantId }, orderBy: { key: 'asc' } }),
    );
  }

  async createCategory(
    tenantId: string,
    input: CreateServiceCategoryRequest,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const duplicate = await tx.serviceCategory.findFirst({
        where: { tenantId, key: input.key },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException({
          message: 'Bu anahtarda bir kategori zaten var',
          code: 'CATEGORY_DUPLICATE',
        });
      }
      const created = await tx.serviceCategory.create({
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
        action: 'service_category.create',
        resourceType: 'service_category',
        resourceId: created.id,
        requestId: actor.requestId,
        metadata: { key: input.key },
      });
      return created;
    });
  }

  async listSlaPolicies(tenantId: string) {
    return this.scoped.withTenant(tenantId, (tx) =>
      tx.slaPolicy.findMany({ where: { tenantId }, orderBy: { priority: 'asc' } }),
    );
  }

  async upsertSlaPolicy(
    tenantId: string,
    input: UpsertSlaPolicyRequest,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.slaPolicy.findUnique({
        where: { tenantId_priority: { tenantId, priority: input.priority } },
      });
      const saved = existing
        ? await tx.slaPolicy.update({
            where: { id: existing.id },
            data: { resolveMinutes: input.resolveMinutes },
          })
        : await tx.slaPolicy.create({
            data: { tenantId, priority: input.priority, resolveMinutes: input.resolveMinutes },
          });
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'sla_policy.upsert',
        resourceType: 'sla_policy',
        resourceId: saved.id,
        requestId: actor.requestId,
        metadata: { priority: input.priority, resolveMinutes: input.resolveMinutes },
      });
      return saved;
    });
  }

  // ------------------------- Yardımcılar -------------------------

  /** Kiracı politikası → yoksa varsayılan katalog (dakika). */
  private async resolveMinutes(
    tx: ScopedClient,
    tenantId: string,
    priority: ServicePriority,
  ): Promise<number> {
    const policy = await tx.slaPolicy.findUnique({
      where: { tenantId_priority: { tenantId, priority } },
      select: { resolveMinutes: true },
    });
    return policy?.resolveMinutes ?? defaultResolveMinutes(priority);
  }

  /** Talep görünümü (SLA aşımı bayrağı dahil). */
  static toView(row: RequestRow, now: Date = new Date()): ServiceRequestView {
    const breached =
      row.slaDueAt !== null &&
      row.status !== 'CONVERTED' &&
      row.status !== 'CANCELLED' &&
      row.slaDueAt.getTime() < now.getTime();
    return {
      requestId: row.id,
      customerId: row.customer.id,
      customerName: row.customer.name,
      assetId: row.assetId,
      assetTag: row.asset?.assetTag ?? null,
      serviceLocationId: row.serviceLocationId,
      categoryId: row.categoryId,
      categoryKey: row.category?.key ?? null,
      categoryName: row.category?.name ?? null,
      source: row.source,
      subject: row.subject,
      description: row.description,
      priority: row.priority,
      status: row.status,
      slaDueAt: row.slaDueAt?.toISOString() ?? null,
      slaBreached: breached,
      convertedWorkOrderId: row.convertedWorkOrder?.id ?? null,
      convertedWorkOrderNo: row.convertedWorkOrder?.workOrderNo ?? null,
      cancellationReason: row.cancellationReason,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export interface TriageInput {
  subject?: string;
  description?: string | null;
  categoryId?: string | null;
  assetId?: string | null;
  serviceLocationId?: string | null;
  priority?: ServicePriority;
  status?: 'NEW' | 'IN_REVIEW';
}

function notFound(message = 'Servis talebi bulunamadı'): NotFoundException {
  return new NotFoundException({ message, code: 'NOT_FOUND' });
}

/** Kaynak etiketleri (UI listesi için — sözleşme enum'uyla birebir). */
export const REQUEST_SOURCE_LABELS: Record<RequestSource, string> = {
  PORTAL: 'Portal',
  OFFICE: 'Ofis',
  EMAIL: 'E-posta',
  API: 'API',
};
