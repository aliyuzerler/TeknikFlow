import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateContactRequestSchema,
  CreateCustomerRequestSchema,
  CreateLocationRequestSchema,
  CustomerListQuerySchema,
  ImportCustomersRequestSchema,
  UpdateContactRequestSchema,
  UpdateCustomerRequestSchema,
  UpdateLocationRequestSchema,
} from '@teknikflow/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentAuth, RequireAnyPermissions, RequirePermissions } from '../auth/auth.decorators.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import type { RequestAuthContext } from '../auth/auth-context.js';
import { CustomersService } from './customers.service.js';

/**
 * Faz 04 — /api/v1/customers uçları.
 *
 * Okuma: customers:view_all VEYA view_limited (any).
 * Yazma: customers:manage.
 * "Assigned only" (teknisyen) atama verisiyle etkinleşir (Faz 05) —
 * şimdilik fail-closed: yalnız view_assigned taşıyan rol 403 alır.
 */
@Controller('customers')
@UseGuards(AuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async list(
    @Query() query: Record<string, string | undefined>,
    @CurrentAuth() ctx: RequestAuthContext,
  ) {
    const parsed = CustomerListQuerySchema.parse(query ?? {});
    const { rows, total } = await this.customers.listCustomers(requireTenant(ctx), parsed);
    return {
      data: rows.map(toCustomerView),
      pageInfo: { total, page: parsed.page, pageSize: parsed.pageSize },
    };
  }

  @Get('import-template')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  getImportTemplate(): { header: string; example: string } {
    return {
      header: 'name,customerType,taxId,contactName,contactEmail,contactPhone',
      example: 'Yeni Firma A.Ş.,COMPANY,1234567890,Ahmet Yılmaz,ahmet@yenifirma.test,+905551112233',
    };
  }

  @Post('import')
  @RequirePermissions('customers:manage')
  async importCustomers(
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = ImportCustomersRequestSchema.parse(body);
    return this.customers.importCustomers(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  @Get(':id')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async get(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const customer = await this.customers.getCustomer(requireTenant(ctx), id);
    return toCustomerView(customer);
  }

  @Get(':id/timeline')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async timeline(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const events = await this.customers.customerTimeline(requireTenant(ctx), id);
    return { data: events.map(toEventView) };
  }

  @Post()
  @RequirePermissions('customers:manage')
  async create(@Body() body: unknown, @CurrentAuth() ctx: RequestAuthContext, @Req() req: Request) {
    const input = CreateCustomerRequestSchema.parse(body);
    const customer = await this.customers.createCustomer(requireTenant(ctx), input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toCustomerView(customer);
  }

  @Patch(':id')
  @RequirePermissions('customers:manage')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateCustomerRequestSchema.parse(body);
    const customer = await this.customers.updateCustomer(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toCustomerView(customer);
  }

  /** CRM kayıtları kalıcıdır: silme = arşivleme (olayla kayıtlı). */
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('customers:manage')
  async archive(
    @Param('id') id: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const customer = await this.customers.archiveCustomer(requireTenant(ctx), id, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return { archived: true, customerId: customer.id };
  }

  // ------------------------- Kişiler -------------------------

  @Get(':id/contacts')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async listContacts(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const contacts = await this.customers.listContacts(requireTenant(ctx), id);
    return { data: contacts.map(toContactView) };
  }

  @Post(':id/contacts')
  @RequirePermissions('customers:manage')
  async createContact(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateContactRequestSchema.parse(body);
    const contact = await this.customers.createContact(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toContactView(contact);
  }

  @Patch('contacts/:contactId')
  @RequirePermissions('customers:manage')
  async updateContact(
    @Param('contactId') contactId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateContactRequestSchema.parse(body);
    const contact = await this.customers.updateContact(requireTenant(ctx), contactId, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toContactView(contact);
  }

  @Delete('contacts/:contactId')
  @HttpCode(200)
  @RequirePermissions('customers:manage')
  async deleteContact(
    @Param('contactId') contactId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    return this.customers.deleteContact(requireTenant(ctx), contactId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }

  // ------------------------- Servis lokasyonları -------------------------

  @Get(':id/locations')
  @RequireAnyPermissions('customers:view_all', 'customers:view_limited')
  async listLocations(@Param('id') id: string, @CurrentAuth() ctx: RequestAuthContext) {
    const locations = await this.customers.listLocations(requireTenant(ctx), id);
    return { data: locations.map(toLocationView) };
  }

  @Post(':id/locations')
  @RequirePermissions('customers:manage')
  async createLocation(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = CreateLocationRequestSchema.parse(body);
    const location = await this.customers.createLocation(requireTenant(ctx), id, input, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
    return toLocationView(location);
  }

  @Patch('locations/:locationId')
  @RequirePermissions('customers:manage')
  async updateLocation(
    @Param('locationId') locationId: string,
    @Body() body: unknown,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    const input = UpdateLocationRequestSchema.parse(body);
    const location = await this.customers.updateLocation(
      requireTenant(ctx),
      locationId,
      input as Record<string, unknown>,
      { userId: ctx.userId, requestId: headerString(req) },
    );
    return toLocationView(location);
  }

  @Delete('locations/:locationId')
  @HttpCode(200)
  @RequirePermissions('customers:manage')
  async deleteLocation(
    @Param('locationId') locationId: string,
    @CurrentAuth() ctx: RequestAuthContext,
    @Req() req: Request,
  ) {
    return this.customers.deleteLocation(requireTenant(ctx), locationId, {
      userId: ctx.userId,
      requestId: headerString(req),
    });
  }
}

// ---------------------------------------------------------------------------
// Görünüm eşleyicileri (Prisma modeli asla dışarı sızmaz)
// ---------------------------------------------------------------------------

function headerString(req: Request): string | undefined {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' ? value : undefined;
}

interface CustomerRow {
  id: string;
  customerType: 'COMPANY' | 'INDIVIDUAL';
  name: string;
  taxId: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  billingAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { contacts: number; serviceLocations: number; assets: number };
}

function toCustomerView(customer: CustomerRow) {
  return {
    customerId: customer.id,
    customerType: customer.customerType,
    name: customer.name,
    taxId: customer.taxId,
    status: customer.status,
    billingAddress: customer.billingAddress,
    contactCount: customer._count?.contacts ?? 0,
    locationCount: customer._count?.serviceLocations ?? 0,
    assetCount: customer._count?.assets ?? 0,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

function toContactView(contact: {
  id: string;
  customerId: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
}) {
  return {
    contactId: contact.id,
    customerId: contact.customerId,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    createdAt: contact.createdAt.toISOString(),
  };
}

function toLocationView(location: {
  id: string;
  customerId: string;
  name: string | null;
  address: string;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  accessNotes: string | null;
  createdAt: Date;
  _count?: { assets: number };
}) {
  return {
    locationId: location.id,
    customerId: location.customerId,
    name: location.name,
    address: location.address,
    city: location.city,
    district: location.district,
    postalCode: location.postalCode,
    latitude: location.latitude,
    longitude: location.longitude,
    accessNotes: location.accessNotes,
    assetCount: location._count?.assets ?? 0,
    createdAt: location.createdAt.toISOString(),
  };
}

function toEventView(event: {
  id: string;
  customerId: string | null;
  assetId: string | null;
  eventType: string;
  actorId: string | null;
  occurredAt: Date;
  asset?: { assetTag: string } | null;
}) {
  return {
    eventId: event.id,
    customerId: event.customerId,
    assetId: event.assetId,
    assetTag: event.asset?.assetTag ?? null,
    eventType: event.eventType,
    actorId: event.actorId,
    occurredAt: event.occurredAt.toISOString(),
  };
}

/** Kiracı bağlamı yoksa 404 (platform admin oturumları bu uçları kullanmaz). */
function requireTenant(ctx: RequestAuthContext): string {
  if (!ctx.tenantId) {
    throw new NotFoundException({ message: 'Kiracı bağlamı yok', code: 'NOT_FOUND' });
  }
  return ctx.tenantId;
}
