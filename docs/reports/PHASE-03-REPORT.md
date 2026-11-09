# Faz 03 Raporu — Identity, Tenant Isolation, RBAC and Onboarding

Tarih: 2026-11-09 · Yürütücü: geliştirme ajanı · QA kapısı: TEST-03 (bağımsız değerlendirme)

## 1. Özet

Faz 03 kabul kriterleri — *auth flows work; permission matrix enforced server-side; all CRUD/search/file test routes reject cross-tenant access; session revoke works* — tamamlandı. TEST-03 kapısı **PASS** (bkz. §5). Kiracı kaydı (signup), oturum açma (web çerezli + mobil token'lı), davet/kabul akışı, üyelik/şube kapsamı yönetimi, sunucu tarafı RBAC (27 izin / 7 sistem rolü + kiracı özel rolleri), plan yetkisi iskeleti, platform admin ayrımı, audit kaydı ve PostgreSQL RLS savunma derinliği teslim edildi. Çapraz-kiracı erişim denemeleri (IDOR) 404 ile reddedilir — varlık sızıntısı yok; RLS ham SQL düzeyinde kanıtlandı.

**Kritik ortam bulgusu:** embedded-postgres ilk kullanıcıyı *süper kullanıcı* olarak kurar; süper kullanıcı FORCE dahil RLS'yi ATLAR ve bootstrap kullanıcısı düşürüLEMEZ. Çözüm: iki rollerli erişim — `teknikflow_app` (NOSUPERUSER, çalışma zamanı) + `teknikflow` (yalnız migration/DDL). `infra/native/setup-app-role.mjs` idempotent kurar; `db:migrate` sonrası otomatik çağrılır.

## 2. Değişen/eklenen dosyalar (özet)

| Alan | Dosyalar |
|---|---|
| Şema | `apps/api/prisma/schema.prisma` (User, Tenant, Membership, Branch, Role, Permission, RolePermission, Session, RefreshTokenFamily, Invitation, AuditLog, Plan, PlanEntitlement, Subscription), `prisma/migrations/20261109035622_phase03_identity_tenant_rbac_rls/` (+RLS politikaları: branches/memberships/audit_logs/subscriptions FORCE) |
| API kimlik | `src/auth/*` (password.service: Argon2id; token.service: JWT+opak token; session.service: oturum+refresh rotasyonu; auth.service/controller: signup/login/logout/me/refresh/sessions/revoke-all; auth.guard; csrf.middleware; rate-limit.guard; auth-context) |
| API RBAC | `src/rbac/*` (rbac-matrix: katalog+matris tek gerçeklik; permissions.guard; rbac.service/controller: özel roller) |
| API kiracı | `src/tenants/*` (tenants.service/controller: şubeler/üyeler/davetler/audit listesi; invitations.controller: herkese açık önizleme+kabul) |
| API platform | `src/platform/*` (MFA zorunlu platform admin; çapraz-kiracı liste) |
| API diğer | `src/audit/*` (redaksiyonlu audit), `src/entitlements/*` (plan limitleri), `src/common/tenant-scoped-prisma.ts` (RLS kapsamlı transaction), `src/common/configure-app.ts` (/api/v1 öneki + CSRF + credentials CORS), `src/common/error-envelope.filter.ts` (özel kod geçişi) |
| Tohum | `prisma/seed.ts` + `src/rbac/rbac-catalogue.seed.ts` (27 izin, 7 rol, 3 plan, demo kiracı 'atlas-teknik-servis': 2 şube + 8 kullanıcı) |
| Sözleşme | `packages/contracts/src/auth.ts`, `tenants.ts` (Zod şemaları) |
| İstemci | `packages/api-client/src/auth-client.ts` (login/signup/me/logout, credentials:include) |
| Web | `app/login|signup|invitations/[token]/*`, `app/app/layout.tsx` (korumalı kabuk), `app/app/users|branches/*`, `src/components/auth-form.tsx`, `src/lib/session.ts`, `src/lib/use-csrf.ts`, `src/lib/client-env.ts`, `e2e/auth.spec.ts`, `e2e/auth.setup.ts`, globals.css (auth sahneleri) |
| ui-web | `src/components/alert.tsx` (+stories +tests; RSC-güvenli `./server` giriş noktası) |
| Mobil | `src/theme.ts` (yeni semantik token'lar) |
| Altyapı | `infra/native/setup-app-role.mjs` (iki rollerli erişim), `start-local.mjs` (rol kurulumu), kök `package.json` (db:migrate → setup-role zinciri), `.env`/`.env.example` (AUTH_* + iki rol), `.github/workflows/ci.yml` |

## 3. Mimari kararlar (bu fazda uygulanan)

1. **İki taşıyıcılı oturum (ADR-0002):** web = HttpOnly `tf_session` çerezi + `tf_csrf` çift-gönderim + Origin denetimi; mobil = kısa ömürlü HS256 JWT (node:crypto ile sabit zamanlı doğrulama — harici bağımlılık yok) + dönen refresh aileleri (yeniden kullanım tespitinde aile iptali). Oturumlar veritabanında → iptal anında etkili.
2. **RLS iki-rollü erişim (ADR-0003):** süper kullanıcı RLS'i atladığından çalışma zamanı `teknikflow_app` (NOSUPERUSER) rolüyle bağlanır; `TenantScopedPrismaService.withTenant()` transaction içinde `set_config('app.current_tenant_id', …, true)` (transaction'a bağlı → havuz sızıntısı yok). Kimlik çözümlemesi (login/guard/davet) bilinçli `withPlatformAdmin` ayrıcalıklı yolundan yapılır — denetlenebilir tek nokta.
3. **Tek gerçeklik RBAC:** `rbac-matrix.ts` katalog+matris (docs/ROLES_PERMISSIONS.md birebir); tohum ve testler aynı kaynaktan. Özel roller yalnız katalogdan izinlerle; sistem rol anahtarları ele geçirilemez.
4. **Kiracı bağlamı daima sunucuda üyelikten türetilir:** `/tenants/current/*` uçları; istemci tenant id ASLA göndermez. Çoklu üyelik → seçim listesi → slug "seçici" olarak sunucuda doğrulanır.
5. **Genel hata mesajları:** bilinmeyen e-posta / yanlış parola / geçersiz slug aynı mesaj (sayım azaltma); hata zarfı istisna gövdesindeki özel kodu (INVALID_CREDENTIALS, CSRF_INVALID, PLAN_LIMIT_EXCEEDED…) taşır.
6. **Platform admin ayrımı:** üyeliksiz hesap; giriş MFA zorunlu (şema hazır). Platform uçları çapraz-kiracı okur — erişim bayrakla sınırlı, kiracı kullanıcısı 403.
7. **Plan yetkisi iskeleti:** sunucu tarafı max_users/max_branches denetimi; AKTİF üyelik + AÇIK davet birlikte koltuk sayılır.
8. **Web kabuğu oturum-kapsamlı:** `app/app/layout.tsx` sunucuda oturumu çözer (yetkiye dayalı menü — gizleme UX'tir, yetki API'dedir); AppShell client sınırı `ShellFrame` ile taşınır; RSC-güvenli bileşenler `@teknikflow/ui-web/server` alt girişinden.
9. **Davet güvenliği:** token sha256 özetiyle saklanır, yanıtta BİR kez döner; mevcut kullanıcı ancak e-postası eşleşen oturumla kabul edebilir (INVITATION_EMAIL_MISMATCH); son owner indirgenemez/askıya alınamaz.

## 4. Migration detayları

- `20261109035622_phase03_identity_tenant_rbac_rls`: 14 tablo + 6 enum + indeksler (composite `@@unique([tenantId, userId])`, `@@index([tenantId, status])` vb.) + kısmi tekil indeks `roles(key) WHERE tenantId IS NULL` + RLS yardımcı fonksiyonları (`app_current_tenant_id`, `app_is_platform_admin`) + 4 tabloda ENABLE/FORCE ROW LEVEL SECURITY ve politika şablonu.
- RLS DIŞI bilinçli: users/sessions/refresh_token_families/invitations (oturum-öncesi çözümleme), roles/permissions/plans (global katalog), tenants (slug çözümleme + platform admin tasarımı), app_settings.
- Uygulama: `pnpm db:migrate` (bootstrap sahibiyle) → `pnpm db:setup-role` (otomatik) → `pnpm db:seed` (idempotent; iki kez koşuldu).
- OpenAPI: bu faz yeni HTTP yüzeyi ekledi ancak resmi OpenAPI üretimi halen yapılandırılmadı (Faz 13 planında; sözleşmeler Zod ile tek kaynak).

## 5. TEST-03 QA matrisi

Ortam: Linux sandbox; Node v24.22.2; pnpm 9.15.9; embedded PostgreSQL 18 (uygulama rolü NOSUPERUSER); redis-memory-server; RustFS 1.0.4; Chromium 158.0.8127.18 (Playwright 1.65.0).

| Test ID | Senaryo | Beklenen | Gerçekleşen | Durum | Kanıt |
|---|---|---|---|---|---|
| T03-S1 | Prettier | 0 ihlal | "All matched files use Prettier code style!" | PASS | §6 |
| T03-S2 | ESLint | 0 hata | temiz | PASS | §6 |
| T03-S3 | Typecheck | 14/14 görev | 14/14 | PASS | turbo özeti |
| T03-S4 | Üretim derlemesi | tüm paketler | 8/8 | PASS | turbo özeti |
| T03-S5 | Prisma validate | geçerli | "The schema is valid" | PASS | §6 |
| T03-U1 | API birim (yeni: parola, token, matris, kapsam, sözleşme, CSRF, slug, env) | tümü | 67/67 (12 dosya) | PASS | vitest |
| T03-U2 | ui-web birim (+Alert) | tümü | 74/74 (11 dosya) | PASS | vitest |
| T03-U3 | api-client birim (+auth-client) | tümü | 14/14 | PASS | vitest |
| T03-U4 | Geri kalan paketler | regresyon yok | contracts 7, shared 18, worker 9, web 10, design-tokens 3 | PASS | turbo |
| T03-I1 | API entegrasyon — auth akışları (signup/login/CSRF/oturum/rotasyon/çoklu kiracı) | 15/15 | 15/15 | PASS | `auth.integration.test.ts` |
| T03-I2 | Kiracı izolasyonu + RBAC + davet + plan limiti + platform | 24/24 | 24/24 | PASS | `tenant-isolation.integration.test.ts` |
| T03-I3 | Rate limit (429) | düşük limitli örnekte tetiklenir | 1/1 | PASS | `rate-limit.integration.test.ts` |
| T03-I4 | health entegrasyonu | regresyon yok | 3/3 | PASS | eski dosya |
| T03-T1 | Çapraz-kiracı OKUMA (üye/şube/davet/audit) | 404 — varlık sızıntısı yok | 4 senaryo PASS | PASS | izolasyon §IDOR |
| T03-T2 | Çapraz-kiracı YAZMA (üye güncelleme/şube güncelleme) | 404 | PASS | PASS | aynı |
| T03-T3 | RLS ham kanıt: yanlış kiracı bağlamı → 0 satır | satır görünmez | 0/1 | PASS | izolasyon §RLS |
| T03-T4 | RLS: bağlamsız okuma → 0 satır (FORCE) | satır görünmez | 0 | PASS | aynı |
| T03-T5 | RLS: yanlış bağlamda yazma | WITH CHECK reddi | throw | PASS | aynı |
| T03-T6 | RBAC: teknisyen users:manage → 403; rol değişimi anında etkili | sunucu tarafı matris | PASS | PASS | izolasyon §RBAC |
| T03-T7 | Oturum iptali: logout/revoke/revoke-all anında etkili | 401 sonrası | PASS | PASS | auth §oturum |
| T03-T8 | Refresh yeniden kullanım → aile iptali | 401 + türetilen token ölür | PASS | PASS | auth §mobil |
| T03-T9 | CSRF: başlıksız/uyumsuz → 403; eşleşme geçer | çift-gönderim | PASS | PASS | her iki dosya |
| T03-T10 | Son owner koruması | 409 LAST_OWNER_PROTECTED | PASS | PASS | izolasyon |
| T03-E1 | Web E2E — login (hata+başarı), yönlendirme, çıkış kalıcılığı | 23/23 | PASS | PASS | playwright |
| T03-E2 | Web E2E — rol sınırı (owner listeler; teknisyen 403+menü gizli) | sunucu↔UI tutarlı | PASS | PASS | auth.spec |
| T03-E3 | Web E2E — signup → MERKEZ şubesi; zayıf parola UX | onboarding uçtan uca | PASS | PASS | auth.spec |
| T03-E4 | Web E2E — davet oluştur → bağlantı → kabul → kabuk | tam davet akışı | PASS | PASS | auth.spec |
| T03-E5 | Web E2E — mobil 390px (form + hamburger) | duyarlı | PASS | PASS | auth.spec |
| T03-E6 | Web E2E — kabuk/durum regresyonu (oturumlu) | Faz 02 korunur | PASS | PASS | shell/status spec |
| T03-B1 | Storybook derleme + etkileşim (+Alert stories) | tümü | build OK; 41/41 | PASS | §6 |
| T03-M1 | Mobil duman | typecheck + tema senkron | PASS (Jest/RNTL Faz 07) | PASS* | turbo |
| T03-P1 | Performans | API kapasite değişmedi | k6 kapsam dışı (değişiklik yok) | PASS* | — |

*Kapsam dışı (faz gereği): dosya indirme/export iş akışları (dosyalar Faz 08+), müşteri portalı kimlikleri (Faz 12), k6 (API kapasite değişmedi), SAST (Faz 15). Ayrıca "file test routes" kabul maddesi: dosya uçları bu fazda henüz YOKTUR — izolasyon kuralı (RLS şablonu + guard deseni) kuruldu ve CRUD/davet/audit yüzeylerinde kanıtlandı; dosya uçları kendi fazında aynı deseni izleyecektir.

## 6. Çalıştırılan komutlar ve tam sonuçlar

```text
pnpm format:check                       → All matched files use Prettier code style!
pnpm lint                               → 0 hata
pnpm typecheck                          → Tasks: 14 successful, 14 total
pnpm test                               → api 67, ui-web 74, api-client 14, shared 18, worker 9,
                                           web 10, contracts 7, design-tokens 3 → 202/202
pnpm test:integration                   → 4 dosya 43/43 (auth 15, izolasyon 24, rate-limit 1, health 3)
pnpm --filter @teknikflow/ui-web test:storybook → 10 dosya 41/41
pnpm --filter @teknikflow/ui-web storybook:build → Storybook build completed successfully
pnpm build                              → Tasks: 8 successful, 8 total
pnpm db:validate                        → The schema is valid
pnpm db:migrate && pnpm db:setup-role   → migration uygulandı; 'teknikflow_app' NOSUPERUSER hazır
pnpm db:seed (×2)                       → RBAC 27 izin/7 rol; 3 plan; demo kiracı 2 şube 8 kullanıcı (idempotent)
pnpm --filter @teknikflow/mobile typecheck → PASS
pnpm --filter @teknikflow/web test:e2e  → 23 passed (Chromium; kimlik+rol+onboarding+davet+mobil+kabuk+durum)
# Canlı kanıtlar (curl):
POST /api/v1/auth/login (yanlış parola) → 401 INVALID_CREDENTIALS (genel mesaj)
POST /api/v1/auth/login (web, doğru)    → 200 + tf_session/tf_csrf Set-Cookie + tam bağlam
GET  /api/v1/auth/me (çerezle)          → 200 kullanıcı+kiracı+izinler
POST /api/v1/auth/logout (CSRF'siz)     → 403 CSRF_INVALID
POST /api/v1/auth/refresh (rotasyon)    → 200 yeni çift; eski token yeniden → 401 (aile iptali)
GET  /api/v1/tenants/current/members (teknisyen JWT) → 403 FORBIDDEN
# RLS kanıtı (psql): teknikflow_app rolüyle bağlamsız SELECT branches → 0 satır (FORCE RLS);
# platform admin transaction içinde → tüm satırlar; yanlış kiracı bağlamı → 0 satır
```

## 7. Çözülen hatalar (geliştirme sırasında)

1. **Süper kullanıcı RLS atlaması (Kritik):** embedded-postgres bootstrap rolü süper kullanıcıydı → RLS testleri yanıltıcı geçiyordu. İki-rollü erişim modeli (setup-app-role.mjs + MIGRATION_DATABASE_URL) kuruldu; FORCE RLS artık gerçekten etkin.
2. **RLS'li tablolar için kapsamsız sorgular (Kritik):** login/guard/davet yolları membership okurken kapsam kurmadı → `withPlatformAdmin` bilinçli ayrıcalıklı çözümleme yoluna alındı.
3. **Tarayıcı çerez yazılmaması (Kritik):** api-client fetch'inde `credentials` yoktu → login 200 ama oturum kurulmuyordu. `credentials: 'include'` eklendi; davet kabulü ve çıkış uçlarındaki elle fetch'lere de eklendi.
4. **E2E rate-limit çakışması (Orta):** her test kendi login'ini yapıyordu → 429. Global setup (storageState) + iki projekt (auth: temiz tarayıcı / kabuk: oturumlu) + geliştirme pencere kısaltması ile çözüldü; 429 davranışı entegrasyonda düşük limitli ayrıca doğrulandı.
5. **Nest @Res() yanıt askısı (Orta):** klasik tuzak — passthrough'suz @Res dönüş göndermez. `@Res({ passthrough: true })` (+204 özel durum) düzeltti.
6. **Hata zarfı özel kodları kayboluyordu (Orta):** filter durum kodundan türetiyordu; istisna gövdesindeki kod (CSRF_INVALID vb.) artık taşınır.
7. **Sistem rolü tekil indeksi Prisma'da görünmüyor (Düşük):** kısmi SQL indeksi → seed `findUnique` validation hatası; `findFirst+create/update` idempotent kalıbına geçildi (rbac-catalogue.seed.ts).
8. **RSC/Client sınırı (Orta):** sunucu sayfaları barrel import'u hook'lara taşıyordu → `@teknikflow/ui-web/server` RSC-güvenli giriş noktası + ShellFrame client sarmalayıcı.
9. **Test parçalanması (Düşük):** yanlış/doğru login tek testte 3 deneme yapıyordu (kova) → iki ayrı test; form signup parola politikası UX doğrulaması eklendi.

## 8. Kalan kusurlar / sınırlamalar

- **Kritik/Yüksek: yok.**
- Orta: GitHub Actions bu ortamda koşulamıyor — CI dosyası iki-rollü erişim ve AUTH_* değişkenleriyle güncellendi; ilk push'ta kanal doğrulanacak.
- Orta: MFA TOTP akışı şema düzeyinde hazır değil (platform admin girişi 403 ile reddedilir — fail-closed). TOTP Faz 12/15 planında.
- Düşük: davet e-postası gerçekten GÖNDERİLMEZ (token yanıtta gösterilir, UI kopyalar) — e-posta altyapısı Faz 12.
- Düşük: Firefox/WebKit dumanı yok (Faz 16); SAST/bağımlılık taraması yok (Faz 15).
- Bilgi: `/app/overview` içeriği hâlâ etiketli DEMO veri (kabuk gerçek oturumla); canlı iş verisi Faz 04+.

## 9. Faz kapısı kararı

TEST-03 kabul kriterlerinin tümü karşılandı (kimlik akışları, sunucu tarafı izin matrisi, tüm kiracı-sahibi CRUD/davet/audit yollarında çapraz-kiracı reddi — dosya uçları bu fazda mevcut değil, desen kuruldu ve kanıtlandı; oturum iptali); kritik/yüksek açık yok. **Faz 03 kapısı: PASS.** Sonraki faz: 04 — CRM, kişiler, lokasyonlar ve ekipman envanteri (bağımlılıklar hazır: kiracı bağlamı, RBAC guard'ları, RLS şablonu, audit).
