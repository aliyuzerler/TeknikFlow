import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/tenant-scoped-prisma.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizeEmail, normalizeName } from './crm-utils.js';
import { parseCustomersCsv } from './csv-import.js';
import type { ScopedClient } from '../common/tenant-scoped-prisma.js';

/**
 * Faz 04 — müşteri/kişi/lokasyon servisi.
 *
 * Tüm erişim kiracı kapsamlı transaction içinde (RLS). Çapraz-kiracı kimlik
 * → 404 (varlık sızıntısı yok). Çift kayıt kuralları:
 * - Müşteri: (tenantId, nameNormalized) tekil → 409 CUSTOMER_DUPLICATE.
 * - Vergi no: aynı kiracıda ikinci kez → 409 TAX_ID_DUPLICATE.
 * - Kişi: (tenantId, customerId, emailNormalized) tekil → 409 CONTACT_DUPLICATE.
 * Olaylar (CrmEvent) her mutasyona yazılır — müşteri zaman çizelgesi.
 */
const CUSTOMER_INCLUDE = {
  _count: { select: { contacts: true, serviceLocations: true, assets: true } },
} as const;

@Injectable()
export class CustomersService {
  constructor(
    private readonly scoped: TenantScopedPrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------- Liste / arama -------------------------

  async listCustomers(
    tenantId: string,
    query: {
      q?: string;
      status?: 'ACTIVE' | 'ARCHIVED';
      page: number;
      pageSize: number;
      sort?: string;
    },
  ) {
    // Varsayılan liste arşivlenmişleri GİZLER (açık status=ARCHIVED ile görünür).
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      status: query.status ?? { not: 'ARCHIVED' },
      ...(query.q
        ? {
            OR: [
              { nameNormalized: { contains: normalizeName(query.q) } },
              { taxId: { contains: query.q.trim() } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.CustomerOrderByWithRelationInput =
      query.sort === 'createdAt' ? { createdAt: 'desc' } : { nameNormalized: 'asc' };

    return this.scoped.withTenant(tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.customer.findMany({
          where,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: CUSTOMER_INCLUDE,
        }),
        tx.customer.count({ where }),
      ]);
      return { rows, total };
    });
  }

  async getCustomer(tenantId: string, customerId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
        include: { ...CUSTOMER_INCLUDE, contacts: true, serviceLocations: true },
      });
      if (!customer) {
        throw new NotFoundException({ message: 'Müşteri bulunamadı', code: 'NOT_FOUND' });
      }
      return customer;
    });
  }

  // ------------------------- Oluşturma -------------------------

  async createCustomer(
    tenantId: string,
    input: {
      name: string;
      customerType: 'COMPANY' | 'INDIVIDUAL';
      taxId?: string;
      billingAddress?: string;
      primaryContact?: { name: string; email: string; phone?: string };
    },
    actor: { userId: string; requestId?: string },
  ) {
    const nameNormalized = normalizeName(input.name);
    return this.scoped.withTenant(tenantId, async (tx) => {
      const duplicate = await tx.customer.findFirst({ where: { tenantId, nameNormalized } });
      if (duplicate) {
        throw new ConflictException({
          message: 'Bu adda bir müşteri zaten var',
          code: 'CUSTOMER_DUPLICATE',
          customerId: duplicate.id,
        });
      }
      if (input.taxId) {
        const taxDuplicate = await tx.customer.findFirst({
          where: { tenantId, taxId: input.taxId },
        });
        if (taxDuplicate) {
          throw new ConflictException({
            message: 'Bu vergi numarası kayıtlı',
            code: 'TAX_ID_DUPLICATE',
            customerId: taxDuplicate.id,
          });
        }
      }

      const customer = await tx.customer.create({
        data: {
          tenantId,
          name: input.name,
          nameNormalized,
          customerType: input.customerType,
          ...(input.taxId ? { taxId: input.taxId } : {}),
          ...(input.billingAddress ? { billingAddress: input.billingAddress } : {}),
          createdById: actor.userId,
        },
      });

      if (input.primaryContact) {
        await tx.contact.create({
          data: {
            tenantId,
            customerId: customer.id,
            name: input.primaryContact.name,
            email: input.primaryContact.email,
            emailNormalized: normalizeEmail(input.primaryContact.email),
            ...(input.primaryContact.phone ? { phone: input.primaryContact.phone } : {}),
          },
        });
        await writeEvent(tx, {
          tenantId,
          customerId: customer.id,
          eventType: 'contact.created',
          actorId: actor.userId,
          requestId: actor.requestId,
          metadata: { name: input.primaryContact.name, email: input.primaryContact.email },
        });
      }

      await writeEvent(tx, {
        tenantId,
        customerId: customer.id,
        eventType: 'customer.created',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { name: input.name, customerType: input.customerType },
      });

      return tx.customer.findUniqueOrThrow({
        where: { id: customer.id },
        include: CUSTOMER_INCLUDE,
      });
    });
  }

  async updateCustomer(
    tenantId: string,
    customerId: string,
    input: {
      name?: string;
      taxId?: string | null;
      billingAddress?: string | null;
      status?: 'ACTIVE' | 'ARCHIVED';
    },
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id: customerId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Müşteri bulunamadı', code: 'NOT_FOUND' });
      }

      if (input.name && input.name !== existing.name) {
        const nameNormalized = normalizeName(input.name);
        const duplicate = await tx.customer.findFirst({ where: { tenantId, nameNormalized } });
        if (duplicate && duplicate.id !== customerId) {
          throw new ConflictException({
            message: 'Bu adda bir müşteri zaten var',
            code: 'CUSTOMER_DUPLICATE',
            customerId: duplicate.id,
          });
        }
      }
      if (input.taxId) {
        const taxDuplicate = await tx.customer.findFirst({
          where: { tenantId, taxId: input.taxId },
        });
        if (taxDuplicate && taxDuplicate.id !== customerId) {
          throw new ConflictException({
            message: 'Bu vergi numarası kayıtlı',
            code: 'TAX_ID_DUPLICATE',
            customerId: taxDuplicate.id,
          });
        }
      }

      await tx.customer.update({
        where: { id: customerId },
        data: {
          ...(input.name ? { name: input.name, nameNormalized: normalizeName(input.name) } : {}),
          ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
          ...(input.billingAddress !== undefined ? { billingAddress: input.billingAddress } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      });

      await writeEvent(tx, {
        tenantId,
        customerId,
        eventType:
          input.status === 'ARCHIVED' && existing.status !== 'ARCHIVED'
            ? 'customer.archived'
            : 'customer.updated',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { fields: Object.keys(input) },
      });
      return tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        include: CUSTOMER_INCLUDE,
      });
    });
  }

  /** Silme = arşivleme (CRM kayıtları kalıcıdır; RLS + olay kaydı korunur). */
  async archiveCustomer(
    tenantId: string,
    customerId: string,
    actor: { userId: string; requestId?: string },
  ) {
    return this.updateCustomer(tenantId, customerId, { status: 'ARCHIVED' }, actor);
  }

  // ------------------------- Kişiler -------------------------

  async listContacts(tenantId: string, customerId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireCustomer(tx, tenantId, customerId);
      return tx.contact.findMany({
        where: { tenantId, customerId },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  async createContact(
    tenantId: string,
    customerId: string,
    input: { name: string; email: string; phone?: string },
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireCustomer(tx, tenantId, customerId);
      const emailNormalized = normalizeEmail(input.email);
      const duplicate = await tx.contact.findFirst({
        where: { tenantId, customerId, emailNormalized },
      });
      if (duplicate) {
        throw new ConflictException({
          message: 'Bu e-postaya sahip kişi bu müşteride zaten var',
          code: 'CONTACT_DUPLICATE',
        });
      }
      const contact = await tx.contact.create({
        data: {
          tenantId,
          customerId,
          name: input.name,
          email: input.email,
          emailNormalized,
          ...(input.phone ? { phone: input.phone } : {}),
        },
      });
      await writeEvent(tx, {
        tenantId,
        customerId,
        eventType: 'contact.created',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { name: input.name, email: input.email },
      });
      return contact;
    });
  }

  async updateContact(
    tenantId: string,
    contactId: string,
    input: { name?: string; phone?: string | null },
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.contact.findFirst({ where: { id: contactId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Kişi bulunamadı', code: 'NOT_FOUND' });
      }
      const updated = await tx.contact.update({
        where: { id: contactId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        },
      });
      await writeEvent(tx, {
        tenantId,
        customerId: existing.customerId,
        eventType: 'contact.updated',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
  }

  async deleteContact(
    tenantId: string,
    contactId: string,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.contact.findFirst({ where: { id: contactId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Kişi bulunamadı', code: 'NOT_FOUND' });
      }
      await tx.contact.delete({ where: { id: contactId } });
      await writeEvent(tx, {
        tenantId,
        customerId: existing.customerId,
        eventType: 'contact.deleted',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { email: existing.email },
      });
      return { deleted: true };
    });
  }

  // ------------------------- Servis lokasyonları -------------------------

  async listLocations(tenantId: string, customerId: string) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireCustomer(tx, tenantId, customerId);
      return tx.serviceLocation.findMany({
        where: { tenantId, customerId },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { assets: true } } },
      });
    });
  }

  async createLocation(
    tenantId: string,
    customerId: string,
    input: {
      name?: string;
      address: string;
      city?: string;
      district?: string;
      postalCode?: string;
      latitude?: number;
      longitude?: number;
      accessNotes?: string;
    },
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireCustomer(tx, tenantId, customerId);
      const location = await tx.serviceLocation.create({
        data: { tenantId, customerId, ...input },
      });
      await writeEvent(tx, {
        tenantId,
        customerId,
        eventType: 'location.created',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { address: input.address },
      });
      return location;
    });
  }

  async updateLocation(
    tenantId: string,
    locationId: string,
    input: Record<string, unknown>,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.serviceLocation.findFirst({ where: { id: locationId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Lokasyon bulunamadı', code: 'NOT_FOUND' });
      }
      const updated = await tx.serviceLocation.update({
        where: { id: locationId },
        data: input as Prisma.ServiceLocationUncheckedUpdateInput,
      });
      await writeEvent(tx, {
        tenantId,
        customerId: existing.customerId,
        eventType: 'location.updated',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
  }

  async deleteLocation(
    tenantId: string,
    locationId: string,
    actor: { userId: string; requestId?: string },
  ) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      const existing = await tx.serviceLocation.findFirst({ where: { id: locationId, tenantId } });
      if (!existing) {
        throw new NotFoundException({ message: 'Lokasyon bulunamadı', code: 'NOT_FOUND' });
      }
      const assetCount = await tx.asset.count({ where: { serviceLocationId: locationId } });
      if (assetCount > 0) {
        throw new ConflictException({
          message: 'Lokasyona bağlı varlıklar var — önce taşıyın',
          code: 'LOCATION_IN_USE',
          assetCount,
        });
      }
      await tx.serviceLocation.delete({ where: { id: locationId } });
      await writeEvent(tx, {
        tenantId,
        customerId: existing.customerId,
        eventType: 'location.deleted',
        actorId: actor.userId,
        requestId: actor.requestId,
        metadata: { address: existing.address },
      });
      return { deleted: true };
    });
  }

  // ------------------------- Zaman çizelgesi -------------------------

  async customerTimeline(tenantId: string, customerId: string, limit = 50) {
    return this.scoped.withTenant(tenantId, async (tx) => {
      await this.requireCustomer(tx, tenantId, customerId);
      return tx.crmEvent.findMany({
        where: { tenantId, customerId },
        orderBy: { occurredAt: 'desc' },
        take: limit,
        include: { asset: { select: { assetTag: true } } },
      });
    });
  }

  // ------------------------- CSV içe aktarma -------------------------

  async importCustomers(
    tenantId: string,
    input: { csv: string; dryRun: boolean },
    actor: { userId: string; requestId?: string },
  ) {
    const parsed = parseCustomersCsv(input.csv);
    if (parsed.error) {
      throw new BadRequestException({ message: parsed.error, code: 'IMPORT_FORMAT_INVALID' });
    }

    // Veritabanı çapraz kontrol + (dryRun değilse) tek transaction'da oluşturma.
    return this.scoped.withTenant(tenantId, async (tx) => {
      const rowResults: Array<{
        row: number;
        name: string;
        status: 'valid' | 'duplicate' | 'error';
        customerId?: string;
        error?: string;
      }> = [];

      // Dosya içi sorunlar zaten işaretli.
      for (const issue of parsed.issues) {
        rowResults.push({
          row: issue.row,
          name: issue.name,
          status: issue.status,
          error: issue.error,
        });
      }

      let created = 0;
      for (const row of parsed.rows) {
        const nameNormalized = normalizeName(row.name);
        const existing = await tx.customer.findFirst({ where: { tenantId, nameNormalized } });
        if (existing) {
          rowResults.push({
            row: row.row,
            name: row.name,
            status: 'duplicate',
            customerId: existing.id,
            error: 'Bu adda müşteri zaten kayıtlı',
          });
          continue;
        }
        if (row.taxId) {
          const taxDuplicate = await tx.customer.findFirst({
            where: { tenantId, taxId: row.taxId },
          });
          if (taxDuplicate) {
            rowResults.push({
              row: row.row,
              name: row.name,
              status: 'duplicate',
              customerId: taxDuplicate.id,
              error: 'Bu vergi numarası kayıtlı',
            });
            continue;
          }
        }

        if (input.dryRun) {
          rowResults.push({ row: row.row, name: row.name, status: 'valid' });
          continue;
        }

        const customer = await tx.customer.create({
          data: {
            tenantId,
            name: row.name,
            nameNormalized,
            customerType: row.customerType,
            ...(row.taxId ? { taxId: row.taxId } : {}),
            createdById: actor.userId,
          },
        });
        if (row.contactEmail) {
          await tx.contact.create({
            data: {
              tenantId,
              customerId: customer.id,
              // Ad verilmediyse e-posta yerel kısmından türetilir.
              name: row.contactName ?? row.contactEmail.split('@')[0] ?? 'Kontak',
              email: row.contactEmail,
              emailNormalized: normalizeEmail(row.contactEmail),
              ...(row.contactPhone ? { phone: row.contactPhone } : {}),
            },
          });
          await writeEvent(tx, {
            tenantId,
            customerId: customer.id,
            eventType: 'contact.created',
            actorId: actor.userId,
            requestId: actor.requestId,
            metadata: { imported: true, email: row.contactEmail },
          });
        }
        await writeEvent(tx, {
          tenantId,
          customerId: customer.id,
          eventType: 'customer.imported',
          actorId: actor.userId,
          requestId: actor.requestId,
          metadata: { row: row.row, name: row.name },
        });
        rowResults.push({ row: row.row, name: row.name, status: 'valid', customerId: customer.id });
        created += 1;
      }

      rowResults.sort((a, b) => a.row - b.row);
      await this.audit.log({
        tenantId,
        actorId: actor.userId,
        action: 'customers.imported',
        resourceType: 'customer',
        requestId: actor.requestId,
        metadata: {
          dryRun: input.dryRun,
          total: rowResults.length,
          created,
          duplicates: rowResults.filter((r) => r.status === 'duplicate').length,
          errors: rowResults.filter((r) => r.status === 'error').length,
        },
      });

      return {
        dryRun: input.dryRun,
        totalRows: rowResults.length,
        createdCount: created,
        duplicateCount: rowResults.filter((r) => r.status === 'duplicate').length,
        errorCount: rowResults.filter((r) => r.status === 'error').length,
        rows: rowResults,
      };
    });
  }

  /** Kiracı-sahipliği doğrulaması (RLS zaten süzer; 404 ayrımı için). */
  private async requireCustomer(
    tx: ScopedClient,
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const customer = await tx.customer.findFirst({ where: { id: customerId, tenantId } });
    if (!customer) {
      throw new NotFoundException({ message: 'Müşteri bulunamadı', code: 'NOT_FOUND' });
    }
  }
}

/** CrmEvent yazma — mutasyon transaction'ının içinde çağrılır. */
export async function writeEvent(
  tx: ScopedClient,
  event: {
    tenantId: string;
    customerId?: string;
    assetId?: string;
    eventType: string;
    actorId?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.crmEvent.create({
    data: {
      tenantId: event.tenantId,
      ...(event.customerId ? { customerId: event.customerId } : {}),
      ...(event.assetId ? { assetId: event.assetId } : {}),
      eventType: event.eventType,
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.requestId ? { requestId: event.requestId } : {}),
      metadataJson: (event.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
