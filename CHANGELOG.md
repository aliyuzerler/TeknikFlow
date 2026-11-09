# Changelog

## 0.3.0 — Phase 03: Identity, tenant isolation, RBAC and onboarding

- Kimlik ve oturum (ADR-0002): Argon2id parola, web HttpOnly çerezli oturum + CSRF (çift-gönderim + Origin), mobil kısa ömürlü JWT + dönen refresh aileleri (yeniden kullanım tespiti aile iptali), oturum listeleme/tekil iptal/revoke-all, login-rate-limit (IP + e-posta kovası, PII yazılmaz).
- Kiracı izolasyonu (ADR-0003): PostgreSQL RLS FORCE — branches/memberships/audit_logs/subscriptions; `TenantScopedPrismaService` transaction-kapsamlı kiracı bağlamı; IDOR reddi 404 (varlık sızıntısı yok); **iki-rollü DB erişimi** (çalışma zamanı `teknikflow_app` NOSUPERUSER; migration bootstrap sahibiyle — süper kullanıcının RLS'i atlaması kapatıldı).
- RBAC: 27 izinlik katalog + 7 sistem rolü (docs/ROLES_PERMISSIONS.md birebir) tek kaynak modülde; `@RequirePermissions` guard'ları sunucu tarafında; kiracı özel rolleri yalnız katalogdan; sistem rol anahtarları korunur; şube kapsamı rolden AYRI denetlenir; son owner indirgenemez.
- Onboarding: kiracı signup (varsayılan MERKEZ şubesi + starter deneme aboneliği), davet oluşturma (token yanıtta bir kez) → önizleme → kabul (yeni kullanıcı parola kurar; mevcut kullanıcı e-posta eşleşmeli oturumla), çoklu üyelik seçimi.
- Plan yetkisi iskeleti: max_users/max_branches sunucu tarafı denetimi (aktif üyelik + açık davet = koltuk).
- Platform admin ayrımı: üyeliksiz hesap, giriş MFA zorunlu (fail-closed), çapraz-kiracı platform uçları bayrakla sınırlı.
- Audit: aktör/eylem/kaynak/kiracı/istek + güvenli fark (parola/token/imza REDAKTE; başarısız audit iş mantığını düşürmez).
- Web: /login, /signup, /invitations/[token], oturum-korumalı app kabuğu (menü yetkiye dayalı), Kullanıcılar & Roller (+davet formu, tek kullanımlık bağlantı), Şubeler; RSC-güvenli `@teknikflow/ui-web/server` girişi; Alert bileşeni (+stories +tests).
- Testler: 202 birim + 43 entegrasyon (IDOR/RLS ham kanıt/CSRF/rotasyon/limit) + 41 Storybook + 23 E2E; CI iki-rollü erişimle güncellendi.
- TEST-03 kapısı: PASS (`docs/reports/PHASE-03-REPORT.md`); 10 ekran görüntüsü `docs/screenshots/phase-03/`.

## 0.2.0 — Phase 02: Brand system, UI shell and Storybook

- Marka sistemi: SVG marka işareti (mavi→teal geçişli "ileri akan T" yolu) + wordmark; 28 ikon; Inter Variable tipografi.
- Tek kaynaklı tasarım token zinciri: `tokens.css` (77 token) → üretici → CSS değişkenleri + `src/tokens.ts` (React Native teması dahil). Üretici Prettier API ile kararlı çıktı verir; senkron test bayat üretimi engeller; bilinmeyen token adı hata verir.
- WCAG AA: 8 token değeri kontrast eşiklerine göre revize edildi (muted, subtle, header-muted, placeholder, warning-strong, teal-600, dot-warning, dot-success) — 24 çift denetimi raporda.
- `@teknikflow/ui-web`: duyarlı AppShell (masaüstü kenar çubuğu + ≤720px mobil ARIA çekmecesi, odak tuzağı/ESC/odak geri dönüşü, atlama bağlantısı) + ortak bileşenler (Button, Input/FormField, Card/Panel, MetricCard, DataTable, StatusBadge, ConfirmDialog, SideDrawer, Empty/Skeleton/Error, PageHeader, Breadcrumbs, Avatar).
- Storybook 10 (addon-a11y + addon-vitest): 9 dosyada 34 story; 34 etkileşim testi CI'da koşar; statik derleme doğrulandı.
- Web: `/app/overview` — `design/preview.html` bileşenlerle birebir yeniden üretimi (demo veri etiketli); durum sayfası faz haritası güncel (01-02 tamamlandı; "şu anki faz" sıradaki faza düşer).
- Bileşen katmanında rastgele renk YOK: ui-web.css'te 56 düz hex → 28 anlamsal token'a bağlandı (250 `var(--tf-*)`).
- Onarım (Faz 01 kalıntısı): `pnpm dev` API açılışı tsx/esbuild'in `emitDecoratorMetadata` üretmemesi nedeniyle düşüyordu → `tsc-watch` ile üretimle aynı derlemeden çalışır.
- Kalite: 138 birim + 3 entegrasyon + 34 Storybook etkileşim + 13 E2E (Chromium) testi; 15 ekran görüntüsü `docs/screenshots/phase-02/`.
- TEST-02 kapısı: PASS (`docs/reports/PHASE-02-REPORT.md`).

## 0.1.1 — Phase 01: Workspace and infrastructure foundation

- Monorepo iskeleti kuruldu: pnpm 9 workspace + Turborepo; `apps/{api,web,mobile,worker}`, `packages/{contracts,api-client,ui-web,design-tokens,config,shared}`, `infra/`.
- `apps/api`: NestJS + `/health/live` + `/health/ready` (DB/Redis/S3 hazırlık, 503-degraded), Zod ortam doğrulaması, hata zarfı filtresi, `x-request-id`; Prisma şeması + `20261109014316_init` migration (yalnızca `app_settings` — iş modelleri kendi fazlarında).
- `apps/worker`: heartbeat (Redis) + `:4001/health`. `apps/web`: Next.js durum/kurulum sayfası (5 servis kartı + 16 faz tablosu). `apps/mobile`: Expo yer tutucu (Faz 07+).
- Altyapı: `infra/docker-compose.yml` (PostgreSQL 18 / Redis 7 / RustFS — MinIO OSS Nisan 2026'da arşivlendi, ADR-0005) ve Docker'sız `pnpm infra:native` (embedded PostgreSQL + redis-memory-server + RustFS; root'suz).
- Kalite altyapısı: Prettier + project-aware ESLint (NestJS `emitDecoratorMetadata` uyumlu) + strict TS (`tsconfig.json` tam kapsam / `tsconfig.build.json` emit) + Vitest (68 birim) + 3 entegrasyon + 5 Playwright E2E + GitHub Actions CI (quality + integration işleri).
- TEST-01 kapısı: PASS (`docs/reports/PHASE-01-REPORT.md`).

## 0.1.0 — Project blueprint
- Added TeknikFlow brand working concept and enterprise design reference.
- Added product requirements, architecture, data model, role matrix, API conventions, security, privacy, offline sync, performance, billing and deployment guidance.
- Added 16 sequential implementation phases and 16 detailed independent test prompts.
- Added Playwright, Storybook, React Native Testing Library, Maestro and k6 testing strategy.
