import { z } from 'zod';

/**
 * Faz 03 — kimlik/oturum sözleşmeleri (ADR-0002).
 * Tüm dış girişler API sınırında bu şemalarla doğrulanır; yanıtlar da
 * aynı tiplerle modellenir (Prisma modeli asla doğrudan sızmaz).
 */

/** E-posta normalizasyonu: küçük harf + surrounding boşluk. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Geçerli bir e-posta girin');

/** Parola politikası: 10+ karakter, harf + rakam (nokta yeterli değil). */
export const passwordSchema = z
  .string()
  .min(10, 'En az 10 karakter')
  .max(200)
  .refine((v) => /[a-zA-ZşğüöçıİŞĞÜÖÇ]/.test(v) && /[0-9]/.test(v), {
    message: 'En az bir harf ve bir rakam içermeli',
  });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Yalnız küçük harf, rakam ve tire');

/** Şube kapsamı: "ALL" ya da şube kimlikleri listesi. */
export const branchScopeSchema = z.union([
  z.literal('ALL'),
  z.array(z.string().uuid()).min(1).max(50),
]);

/** POST /auth/signup — kiracı kaydı (onboarding). */
export const SignupRequestSchema = z.object({
  tenantName: z.string().trim().min(2).max(120),
  slug: slugSchema.optional(),
  timezone: z.string().trim().min(1).max(64).default('Europe/Istanbul'),
  user: z.object({
    displayName: z.string().trim().min(2).max(120),
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/** POST /auth/login — parola akışı; client: web (çerez) | mobile (token). */
export const LoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  client: z.enum(['web', 'mobile']).default('web'),
  /** Birden çok kiracıda üyeliği varsa seçim (slug). */
  tenantSlug: slugSchema.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Login yanıtındaki kiracı seçeneği (çoklu üyelik). */
export const WorkspaceSummarySchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

/** Kimlik doğrulama sonrası dönen kullanıcı bağlamı. */
export const AuthUserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  platformAdmin: z.boolean(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const MembershipViewSchema = z.object({
  membershipId: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  roleKey: z.string(),
  roleName: z.string(),
  branchScope: branchScopeSchema,
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']),
});
export type MembershipView = z.infer<typeof MembershipViewSchema>;

/** POST /auth/login (web) yanıtı. */
export const LoginWebResponseSchema = z.object({
  user: AuthUserSchema,
  membership: MembershipViewSchema,
  permissions: z.array(z.string()),
  csrfToken: z.string().optional(),
});
export type LoginWebResponse = z.infer<typeof LoginWebResponseSchema>;

/** POST /auth/login (mobile) yanıtı — kısa ömürlü erişim + dönen refresh. */
export const LoginMobileResponseSchema = z.object({
  user: AuthUserSchema,
  membership: MembershipViewSchema,
  permissions: z.array(z.string()),
  accessToken: z.string(),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string().datetime(),
});
export type LoginMobileResponse = z.infer<typeof LoginMobileResponseSchema>;

/** Çoklu üyelik: oturum kurulmaz, seçim beklenir. */
export const LoginSelectionResponseSchema = z.object({
  selectionRequired: z.literal(true),
  workspaces: z.array(WorkspaceSummarySchema),
});
export type LoginSelectionResponse = z.infer<typeof LoginSelectionResponseSchema>;

/** POST /auth/signup yanıtı. */
export const SignupResponseSchema = LoginWebResponseSchema;
export type SignupResponse = z.infer<typeof SignupResponseSchema>;

/** GET /auth/me yanıtı. */
export const MeResponseSchema = z.object({
  user: AuthUserSchema,
  membership: MembershipViewSchema,
  permissions: z.array(z.string()),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** POST /auth/refresh (mobile) girişi. */
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.string().datetime(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

/** GET /auth/sessions öğesi. */
export const SessionViewSchema = z.object({
  sessionId: z.string().uuid(),
  kind: z.enum(['WEB', 'MOBILE']),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  current: z.boolean(),
  createdIp: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SessionView = z.infer<typeof SessionViewSchema>;
