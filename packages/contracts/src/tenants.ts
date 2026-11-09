import { z } from 'zod';

/**
 * Faz 03 — kiracı/RBAC/davet sözleşmeleri.
 */
import { branchScopeSchema, emailSchema, passwordSchema } from './auth.js';

/** Şube görünümü. */
export const BranchViewSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  address: z.string().nullable(),
  timezone: z.string(),
  createdAt: z.string().datetime(),
});
export type BranchView = z.infer<typeof BranchViewSchema>;

export const CreateBranchRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'Yalnız harf, rakam ve tire'),
  address: z.string().trim().max(300).optional(),
  timezone: z.string().trim().min(1).max(64).default('Europe/Istanbul'),
});
export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

export const UpdateBranchRequestSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().max(300).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type UpdateBranchRequest = z.infer<typeof UpdateBranchRequestSchema>;

/** Üye görünümü (kullanıcı yönetimi). */
export const MemberViewSchema = z.object({
  membershipId: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  userStatus: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  roleKey: z.string(),
  roleName: z.string(),
  branchScope: branchScopeSchema,
  membershipStatus: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']),
  invitedAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;

export const UpdateMemberRequestSchema = z
  .object({
    roleKey: z.string().min(2).max(60).optional(),
    branchScope: branchScopeSchema.optional(),
    membershipStatus: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine(
    (v) =>
      v.roleKey !== undefined || v.branchScope !== undefined || v.membershipStatus !== undefined,
    {
      message: 'En az bir alan gerekli',
    },
  );
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequestSchema>;

/** Davet görünümü (yönetici listesi). */
export const InvitationViewSchema = z.object({
  invitationId: z.string().uuid(),
  email: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
  branchScope: branchScopeSchema,
  status: z.enum(['OPEN', 'ACCEPTED', 'REVOKED', 'EXPIRED']),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type InvitationView = z.infer<typeof InvitationViewSchema>;

/** POST .../invitations girişi. */
export const CreateInvitationRequestSchema = z.object({
  email: emailSchema,
  roleKey: z.string().min(2).max(60),
  branchScope: branchScopeSchema.default('ALL'),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

/** POST .../invitations yanıtı — davet bağlantısı/token YALNIZ burada bir kez döner. */
export const CreateInvitationResponseSchema = z.object({
  invitation: InvitationViewSchema,
  /** Tek kullanımlık davet token'ı (e-posta gönderimi Faz 12; MVP'de yanıtta). */
  inviteToken: z.string().min(20),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;

/** GET /invitations/:token — herkese açık önizleme (bilinmeyen token → 404). */
export const InvitationPreviewSchema = z.object({
  tenantName: z.string(),
  tenantSlug: z.string(),
  invitedEmail: z.string(),
  roleName: z.string(),
  expiresAt: z.string().datetime(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

/**
 * POST /invitations/:token/accept — yeni kullanıcı için hesap kurulumu.
 * Mevcut kullanıcı için parola GEREKMEZ (kimlik doğrulanmış kabul);
 * yeni kullanıcıda servis katmanı parolayı zorunlu kılar.
 */
export const AcceptInvitationRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  password: passwordSchema.optional(),
  client: z.enum(['web', 'mobile']).default('web'),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

/** Rol/izin kataloğu görünümü. */
export const PermissionViewSchema = z.object({
  key: z.string(),
  description: z.string(),
  category: z.string(),
});
export type PermissionView = z.infer<typeof PermissionViewSchema>;

export const RoleViewSchema = z.object({
  roleId: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
});
export type RoleView = z.infer<typeof RoleViewSchema>;

export const CreateRoleRequestSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Yalnız küçük harf, rakam ve tire'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().min(3).max(60)).min(1).max(50),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

/** Audit kaydı görünümü. */
export const AuditLogViewSchema = z.object({
  auditLogId: z.string().uuid(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  requestId: z.string().nullable(),
  occurredAt: z.string().datetime(),
});
export type AuditLogView = z.infer<typeof AuditLogViewSchema>;

/** Sayfalama zarfı (docs/API_CONVENTIONS.md) — crm.ts'teki tanımla uyumlu. */
export { PageInfoSchema, type PageInfo } from './crm.js';
