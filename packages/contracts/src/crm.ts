import { z } from 'zod';

/**
 * Faz 04 — CRM sözleşmeleri: müşteri, kişi, servis lokasyonu, varlık,
 * doküman, zaman çizelgesi, CSV içe aktarma.
 */

/** Sayfalama + arama sorgusu (liste uçları ortak). */
export const ListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().trim().max(30).optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export const PageInfoSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type PageInfo = z.infer<typeof PageInfoSchema>;

// ------------------------- Müşteri -------------------------

export const CreateCustomerRequestSchema = z.object({
  name: z.string().trim().min(2).max(200),
  customerType: z.enum(['COMPANY', 'INDIVIDUAL']).default('COMPANY'),
  taxId: z
    .string()
    .trim()
    .regex(/^[0-9]{10,11}$/, 'VKN/TCKN 10-11 rakam olmalı')
    .optional(),
  billingAddress: z.string().trim().max(300).optional(),
  primaryContact: z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Geçerli bir e-posta girin'),
      phone: z.string().trim().max(30).optional(),
    })
    .optional(),
});
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

export const UpdateCustomerRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    taxId: z
      .string()
      .trim()
      .regex(/^[0-9]{10,11}$/, 'VKN/TCKN 10-11 rakam olmalı')
      .nullable()
      .optional(),
    billingAddress: z.string().trim().max(300).nullable().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekli' });
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;

export const CustomerViewSchema = z.object({
  customerId: z.string().uuid(),
  customerType: z.enum(['COMPANY', 'INDIVIDUAL']),
  name: z.string(),
  taxId: z.string().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  billingAddress: z.string().nullable(),
  contactCount: z.number().int(),
  locationCount: z.number().int(),
  assetCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomerView = z.infer<typeof CustomerViewSchema>;

export const CustomerListQuerySchema = ListQuerySchema.extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuerySchema>;

// ------------------------- Kişi -------------------------

export const CreateContactRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Geçerli bir e-posta girin'),
  phone: z.string().trim().max(30).optional(),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequestSchema>;

export const UpdateContactRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekli' });
export type UpdateContactRequest = z.infer<typeof UpdateContactRequestSchema>;

export const ContactViewSchema = z.object({
  contactId: z.string().uuid(),
  customerId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ContactView = z.infer<typeof ContactViewSchema>;

// ------------------------- Servis lokasyonu -------------------------

export const CreateLocationRequestSchema = z.object({
  name: z.string().trim().max(120).optional(),
  address: z.string().trim().min(4).max(300),
  city: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(12).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accessNotes: z.string().trim().max(500).optional(),
});
export type CreateLocationRequest = z.infer<typeof CreateLocationRequestSchema>;

export const UpdateLocationRequestSchema = z
  .object({
    name: z.string().trim().max(120).nullable().optional(),
    address: z.string().trim().min(4).max(300).optional(),
    city: z.string().trim().max(80).nullable().optional(),
    district: z.string().trim().max(80).nullable().optional(),
    postalCode: z.string().trim().max(12).nullable().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    accessNotes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekli' });
export type UpdateLocationRequest = z.infer<typeof UpdateLocationRequestSchema>;

export const LocationViewSchema = z.object({
  locationId: z.string().uuid(),
  customerId: z.string().uuid(),
  name: z.string().nullable(),
  address: z.string(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  postalCode: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accessNotes: z.string().nullable(),
  assetCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type LocationView = z.infer<typeof LocationViewSchema>;

// ------------------------- Varlık (ekipman) -------------------------

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'));

export const CreateAssetRequestSchema = z.object({
  customerId: z.string().uuid(),
  serviceLocationId: z.string().uuid().optional(),
  parentAssetId: z.string().uuid().optional(),
  /// Boş bırakılırsa sunucu üretir (AST-XXXXXX biçimi).
  assetTag: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(24)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'Yalnız harf, rakam ve tire')
    .optional(),
  serialNumber: z.string().trim().max(80).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  installedAt: isoDate.optional(),
  warrantyUntil: isoDate.optional(),
  criticality: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('LOW'),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CreateAssetRequest = z.infer<typeof CreateAssetRequestSchema>;

export const UpdateAssetRequestSchema = z
  .object({
    serviceLocationId: z.string().uuid().nullable().optional(),
    manufacturer: z.string().trim().max(120).nullable().optional(),
    model: z.string().trim().max(120).nullable().optional(),
    serialNumber: z.string().trim().max(80).nullable().optional(),
    installedAt: isoDate.nullable().optional(),
    warrantyUntil: isoDate.nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']).optional(),
    criticality: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gerekli' });
export type UpdateAssetRequest = z.infer<typeof UpdateAssetRequestSchema>;

export const AssetViewSchema = z.object({
  assetId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  serviceLocationId: z.string().uuid().nullable(),
  serviceLocationName: z.string().nullable(),
  parentAssetId: z.string().uuid().nullable(),
  assetTag: z.string(),
  serialNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  installedAt: z.string().datetime().nullable(),
  warrantyUntil: z.string().datetime().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']),
  criticality: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  documentCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type AssetView = z.infer<typeof AssetViewSchema>;

export const AssetListQuerySchema = ListQuerySchema.extend({
  customerId: z.string().uuid().optional(),
  serviceLocationId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']).optional(),
  criticality: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
});
export type AssetListQuery = z.infer<typeof AssetListQuerySchema>;

// ------------------------- Doküman -------------------------

export const CreateAssetDocumentRequestSchema = z.object({
  documentType: z.enum(['manual', 'warranty', 'installation', 'inspection', 'other']),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().max(100).optional(),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(100 * 1024 * 1024)
    .optional(),
});
export type CreateAssetDocumentRequest = z.infer<typeof CreateAssetDocumentRequestSchema>;

export const AssetDocumentViewSchema = z.object({
  documentId: z.string().uuid(),
  assetId: z.string().uuid(),
  documentType: z.string(),
  fileName: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type AssetDocumentView = z.infer<typeof AssetDocumentViewSchema>;

// ------------------------- Olay / zaman çizelgesi -------------------------

export const CrmEventViewSchema = z.object({
  eventId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  assetId: z.string().uuid().nullable(),
  assetTag: z.string().nullable(),
  eventType: z.string(),
  actorId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type CrmEventView = z.infer<typeof CrmEventViewSchema>;

// ------------------------- CSV içe aktarma -------------------------

/**
 * CSV sütunları (başlık satırı zorunlu, sıra serbest):
 * name,customerType,taxId,contactName,contactEmail,contactPhone
 */
export const ImportCustomersRequestSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
  dryRun: z.boolean().default(false),
});
export type ImportCustomersRequest = z.infer<typeof ImportCustomersRequestSchema>;

export const ImportRowResultSchema = z.object({
  row: z.number().int(),
  name: z.string(),
  status: z.enum(['valid', 'duplicate', 'error']),
  customerId: z.string().uuid().optional(),
  error: z.string().optional(),
});
export type ImportRowResult = z.infer<typeof ImportRowResultSchema>;

export const ImportCustomersResponseSchema = z.object({
  dryRun: z.boolean(),
  totalRows: z.number().int(),
  createdCount: z.number().int(),
  duplicateCount: z.number().int(),
  errorCount: z.number().int(),
  rows: z.array(ImportRowResultSchema),
});
export type ImportCustomersResponse = z.infer<typeof ImportCustomersResponseSchema>;
