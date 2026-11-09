# Faz 01 Raporu — Workspace and Infrastructure Foundation

Tarih: 2026-11-09 · Yürütücü: geliştirme ajanı · QA kapısı: TEST-01 (bağımsız değerlendirme)

## 1. Özet

Faz 01 kabul kriterleri — *workspace builds; local dependencies start; health endpoints respond; docs explain setup; lockfile and CI exist* — tamamlandı. TEST-01 kapısı **PASS** (bkz. §5). Sandbox'ta Docker bulunmadığından yerel bağımlılıklar `pnpm infra:native` (embedded PostgreSQL 18 + redis-memory-server + RustFS) ile gerçek süreçler olarak doğrulandı; `docker compose` yolu dosya + CI düzeyinde hazırdır.

## 2. Değişen/eklenen dosyalar (özet)

| Alan | Dosyalar |
|---|---|
| Monorepo kökü | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`, `.env.example`, `.gitignore` |
| API | `apps/api/src/{main,app.module}.ts`, `src/config/env.ts`, `src/common/{error-envelope.filter,configure-app}.ts`, `src/health/*`, `src/prisma/*`, `src/redis/*`, `src/storage/*`, `prisma/{schema.prisma,seed.ts}`, `prisma/migrations/20261109014316_init/` |
| Worker | `apps/worker/src/{index,env,heartbeat}.ts` + HTTP health sunucusu |
| Web | `apps/web/app/{layout,page,globals.css}`, `src/lib/*`, `e2e/status.spec.ts`, `playwright.config.ts` |
| Mobil | `apps/mobile/{App.tsx,index.ts,app.json,src/theme.ts}` (yer tutucu — Faz 07+) |
| Paketler | `packages/{contracts,shared,api-client,ui-web,design-tokens,config}` (sözleşme/retry/format + yer tutucular) |
| Altyapı | `infra/docker-compose.yml`, `infra/README.md`, `infra/native/{start-local,stop-local}.mjs` |
| CI | `.github/workflows/ci.yml` (quality + integration işleri) |
| Doküman | `README.md` (geliştirici kurulumu), `docs/STATUS.md`, `docs/EXECUTION_PLAN.md`, `CHANGELOG.md`, bu rapor |

## 3. Mimari kararlar (bu fazda uygulanan)

1. **tsconfig ikilisi:** `tsconfig.json` tam kapsam + `noEmit` (IDE/lint/typecheck; testler ve seed dahil), `tsconfig.build.json` yalnız `src` emit — canonical NestJS düzeni. Bu, test dosyalarının typecheck kapsamını da garantiler.
2. **Project-aware ESLint:** `parserOptions.projectService` — `consistent-type-imports` kuralı NestJS `emitDecoratorMetadata`'yı okur; DI değer import'ları yanlış positive ile type-import'a çevrilemez. (Bu fazda yakalanan gerçek hata: DI sınıflarının `import type` edilmesi entegrasyon testinde `Nest can't resolve dependencies` üretiyordu.)
3. **`configureApp()` ortak kurulumu:** `x-request-id` middleware, CORS, hata zarfı filtresi ve shutdown kancaları hem `main.ts` hem entegrasyon testlerinde aynı fonksiyondan uygulanır → test edilen yüzey üretime birebir eşit.
4. **Docker'suz yerel altyapı:** sandbox/CI/sade makine için `infra/native` (root'suz). RustFS seçimi ADR-0005'e dayanır (MinIO OSS Nisan 2026'da arşivlendi).
5. **Tohum (seed) kapsamı:** yalnızca altyapı önyüklemesi (bucket + `app_settings`); "Atlas Teknik Servis" demo verisi bilinçli olarak Faz 03+ ile (kimlik fazı) geciktirildi.

## 4. Migration detayları

- `apps/api/prisma/migrations/20261109014316_init/migration.sql` — yalnızca `app_settings` tablosu (anahtar PK; tenant verisi DEĞİLDİR, iş modelleri kendi fazlarında eklenir).
- Uygulama: `pnpm db:migrate` (`prisma migrate deploy`) → "1 migration found, No pending migrations".
- Doğrulama: `pnpm db:validate` → geçerli. `pnpm db:seed` → bucket `teknikflow-private` + 4 `app_settings` kaydı (idempotent upsert).
- Not: geliştirme sırasında bozuk bir prompt etkileşimi çöp isimli bir migration üretmişti; veritabanı `migrate reset` ile sıfırlanıp temiz `init` migration'ı yeniden oluşturuldu (netlik kaydı).

## 5. TEST-01 QA matrisi

Ortam: Linux sandbox, Node v24.22.2, pnpm 9.15.9, PostgreSQL 18.6 (embedded), Redis (redis-memory-server), RustFS 1.0.4, Chromium 158.0.8127.18 (Playwright v1254).

| Test ID | Senaryo | Beklenen | Gerçekleşen | Durum | Kanıt |
|---|---|---|---|---|---|
| T01-S1 | Prettier biçim kontrolü | 0 ihlal | "All matched files use Prettier code style!" | PASS | terminal çıktısı (§6) |
| T01-S2 | ESLint (project-aware) | 0 hata | temiz çıkış | PASS | terminal çıktısı |
| T01-S3 | TypeScript typecheck (tam kapsam) | 11/11 görev | 11/11 successful | PASS | turbo özeti |
| T01-S4 | Üretim derlemesi | tüm paketler | 7/7 successful | PASS | turbo özeti |
| T01-S5 | Prisma şema/migration | validate + deploy temiz | valid; 1 migration, pending yok | PASS | §4 |
| T01-U1 | API birim (hata zarfı, env, health, seed) | tümü geçer | 17/17 | PASS | vitest özeti |
| T01-U2 | Worker birim (env + heartbeat tazelik/yaş/degraded) | tümü geçer | 9/9 | PASS | vitest özeti |
| T01-U3 | contracts/shared/api-client/ui-web/web birim | tümü geçer | 7+18+5+2+10 = 42/42 | PASS | vitest özeti |
| T01-U4 | Health sınır durumları (birim): bağımlılık düşük → degraded; hata özeti DSN/host SIZMAZ; asılı bağımlılık → zaman aşımı; yanlış PONG → fail | güvenli özet + doğru durum | 4 senaryo doğrulandı | PASS | `health.service.test.ts` |
| T01-I1 | `GET /health/live` (gerçek süreç) | 200 + `x-request-id` + sözleşme | 200; header mevcut; Zod sözleşme doğrulandı | PASS | curl + supertest |
| T01-I2 | `GET /health/ready` (gerçek DB/Redis/RustFS) | 200 + status ok + 3 kontrol | ok; DB 19ms, Redis 18ms, S3 22ms | PASS | curl kanıtı |
| T01-I3 | Bilinmeyen yol | 404 + hata zarfı + requestId; yığın izi yok | `NOT_FOUND` zarfı, requestId mevcut | PASS | curl kanıtı |
| T01-W1 | Worker `:4001/health` | ok + taze heartbeat | ok, ageSeconds=10 | PASS | curl kanıtı |
| T01-E1..E5 | Playwright E2E (Chromium): sayfa bütünlüğü, 5 servis kartı + rozet, 16 faz tablosu, PostgreSQL "Çalışıyor", mobil tek sütun | 5/5 | 5 passed (9.8s) | PASS | playwright list çıktısı |
| T01-N1 | "Yerel bağımlılıklar başlar" (Docker'sız) | servisler gerçek süreç olarak ayakta | PG+Redis+RustFS başladı; kurtarma senaryosu dahil | PASS | `infra-native` logu |
| T01-N2 | Güvenlik: loglarda gizli bilgi | DSN/parola sızması yok | health hata özetleri kod/ad düzeyinde; zarf yığın izi taşımaz | PASS | kaynak incelemesi + U4 |

**Kapsam dışı (faz gereği, dürüst kayıt):** tenant izolasyonu, RBAC/unauthorized senaryoları, Storybook interaction, mobil test paketi, k6 — ilgili fazlarda (03, 02, 07+, performans fazı). Bu fazda tenant verisi/kullanıcı bulunmaz; yalnızca altyapı meta verisi vardır. SAST/bağımlılık taraması henüz yapılandırılmadı (Faz 15 kapsamında planlanır; CI'da yok — kısıt olarak kayıtlı).

## 6. Çalıştırılan komutlar ve tam sonuçlar

```text
pnpm install --frozen-lockfile            → tamam (12 workspace projesi)
pnpm infra:native                         → PostgreSQL :5432, Redis :6379, RustFS :9000/:9001 hazır
pnpm db:migrate                           → 1 migration found, No pending migrations
pnpm db:seed                              → bucket 'teknikflow-private': oluşturuldu; app_settings: 4 kayıt
pnpm db:validate                          → The schema is valid
pnpm format:check                         → All matched files use Prettier code style!
pnpm lint                                 → 0 hata (project-aware)
pnpm typecheck                            → Tasks: 11 successful, 11 total
pnpm test                                 → api 17, worker 9, web 10, contracts 7, shared 18,
                                            api-client 5, ui-web 2  → 68/68 geçti
pnpm test:integration                     → 1 dosya, 3/3 geçti (gerçek DB/Redis/RustFS)
pnpm build                                → Tasks: 7 successful, 7 total
pnpm --filter @teknikflow/web test:e2e    → 5 passed (Chromium, 9.8s)
curl :4000/health/live                    → 200 {"status":"ok",...} + x-request-id
curl :4000/health/ready                   → 200 status=ok; DB 19ms / Redis 18ms / S3 22ms
curl :4001/health                         → {"status":"ok","ageSeconds":10}
```

## 7. Çözülen hatalar (geliştirme sırasında)

1. **DI type-import hatası** (Kritik): `HealthService`/`PrismaService` `import type` edilince Nest DI çalışma zamanında çözülemedi → entegrasyon testi düştü. Değer import'una çevrildi; tekrarı ESLint projectService ile yapısal olarak önlendi.
2. **Test/üretim yüzey ayrımı** (Orta): enine kesen kurulum yalnız `main.ts`'deydi → `configureApp()` ortak fonksiyonuna taşındı; entegrasyon testi aynı kurulumu kullanır.
3. **Playwright tarayıcı sürüm uyuşmazlığı** (Orta): önbellekteki Chromium 1200/istenen 1254 → eşleşen sürüm kuruldu.
4. **Çöp isimli migration** (Düşük): etkileşimli prompt kazası; reset + temiz `init` ile giderildi.

## 8. Kalan kusurlar / sınırlamalar

- **Kritik/Yüksek: yok.**
- Orta: GitHub Actions iş akışı sandbox'ta çalıştırılamadı (Actions yalnızca GitHub tarafında koşar) — ilk push'ta CI kanalıyla doğrulanacak.
- Düşük: `docker compose` yolu bu ortamda yürütülemedi (Docker yok) — dosya içerikleri gözden geçirildi; CI'da runner servisleriyle aynı imajlar/portlar kullanılır.
- Düşük: SAST/bağımlılık taraması yapılandırılmadı (Faz 15 planı).
- Bilgi: Mobil uygulama bilinçli yer tutucu (Faz 07+); Storybook Faz 02 ile gelir.

## 9. Faz kapısı kararı

TEST-01 kabul kriterlerinin tümü karşılandı; kritik/yüksek açık yok. **Faz 01 kapısı: PASS.** Sonraki faz: 02 — Marka sistemi, UI kabuğu ve Storybook.
