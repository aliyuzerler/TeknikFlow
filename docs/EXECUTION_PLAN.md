# Teknik Yürütme Planı (Execution Plan)

> Bu doküman `prompts/START_HERE.md` adımının çıktısıdır. Ürün geliştirmesi fazlara bölünmüştür; her faz kendi test prompt'u geçilmeden kapatılmaz. Plan, fazlar ilerledikçe güncellenir.

## 1. Mimari özet

- **Stil:** API için modüler monolit + ayrı kuyruk worker'ı (mikroservis yok). Modüller: `auth, tenants, memberships, branches, billing, customers, contacts, locations, assets, service-requests, work-orders, dispatch, technicians, skills, checklists, attachments, signatures, inventory, maintenance, quotes, expenses, documents, notifications, customer-portal, reports, audit, platform-admin`.
- **Çalışma alanı:** pnpm workspaces + Turborepo; `apps/{api,web,mobile,worker}`, `packages/{contracts,api-client,ui-web,design-tokens,config,shared}`, `infra/`.
- **Teknoloji:** TypeScript strict (uçtan uca), NestJS + PostgreSQL + Prisma, Redis + BullMQ, S3-uyumlu depolama (yerelde MinIO), Next.js (App Router) + Tailwind + Radix, Expo React Native (offline-first), Zod sözleşmeleri, Vitest (tek test runner) + Supertest, Storybook + Testing Library, Playwright (web E2E), Jest + RNTL + Maestro (mobil), GitHub Actions CI.
- **Taslak ADR'ler:** `docs/decisions/ADR-0001` (monorepo/araçlar), `ADR-0002` (auth/oturum), `ADR-0003` (tenant izolasyonu), `ADR-0004` (mobil offline sync), `ADR-0005` (dosya depolama), `ADR-0006` (faturalama soyutlaması). Hepsi **Proposed** durumda; ilgili fazda gözden geçirilip **Accepted** yapılır.

## 2. Faz haritası ve bağımlılıklar

| Grup | Fazlar | Temel çıktı |
|---|---|---|
| Temel | 01 | Monorepo, Docker Compose (Postgres/Redis/MinIO), health check, CI, seed |
| Marka & kimlik | 02, 03 | Design system + UI shell + Storybook; auth, RBAC, tenant izolasyonu, onboarding |
| Operasyon çekirdeği | 04, 05, 06 | CRM + ekipman envanteri; servis talebi + iş emri yaşam döngüsü; dispatch board + planlama |
| Saha | 07, 08, 09 | Mobil temel + teknisyen gelen kutusu; iş yürütme (GPS/medya/imza); stok + van stock + parça tüketimi |
| Ticari | 10, 11 | Önleyici bakım + servis sözleşmeleri; teklif + masraf + ticari akış |
| Müşteri & içgörü | 12, 13 | Müşteri portalı + bildirimler; analitik + export + operasyon panoları |
| SaaS & yayına | 14, 15, 16 | Plan/seat/abonelik + billing sağlayıcı; güvenlik/performans/observability/deploy; RC + regresyon + kalite onayı |

Kritik bağımlılık zinciri: 01 → 02 → 03 → (04/05 paralel olabilir) → 06 → 07 → 08 → 09; 14, 03'teki abonelik modelini; 12, 05'teki iş emri yaşam döngüsünü esas alır.

## 3. Yerel çalıştırma stratejisi

- `docker compose up` (infra/) → Postgres + Redis + MinIO.
- `pnpm install` → `pnpm dev` (Turborepo ile api/web/mobile/worker paralel).
- Seed: demo tenant + kullanıcılar + örnek veri (`docs/DEMO_SEED_DATA.md`; yalnızca demo/test, üretim kod yolunda mock yok).
- Kalite kapısı: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build` + ilgiliyse Storybook/Playwright/Maestro.

## 4. Ortam ön koşulları ve mevcut durum

| Araç | Gereklilik | Bu ortamda | Not |
|---|---|---|---|
| Node.js | ≥ 20 (önerilen 22/24) | ✅ v24.22.2 | |
| npm | yalnız pnpm kurulumu için | ✅ 11.19.1 | |
| pnpm | zorunlu (workspace) | ❌ kurulu değil | `corepack enable` / `npm i -g pnpm` ile kurulabilir — onay bekleniyor |
| Docker + Compose | Postgres/Redis/MinIO için | ❌ yok (sandbox) | Phase 01'de karar: native servis kurulumu veya alternatif |
| Git | sürüm kontrol | ✅ 2.47.3 | repo init edildi |
| Android/iOS build | Mobil fazlar (07+) | ❌ | Expo Go + gerçek cihaz önerilir; iOS build bu ortamda mümkün değil |
| Turborepo/GH Actions | CI | GitHub Actions dosyaları hazırlanır; sandbox'ta çalıştırılamaz | |

**Sandbox kısıtları (dürüst kayıt):** Docker yok → "local dependencies start" kabul kriteri Phase 01'de alternatif yolla (native paketler veya ertelenmiş Docker doğrulaması) karşılanacak ve açıkça raporlanacak. Playwright tarayıcı kurulumu ve mobil cihaz akışları ortam kısıtlarına tabidir; çalıştırılamayan testler asla "geçti" olarak raporlanmaz.

## 5. Ürün değişmezleri (her fazda korunur)

1. Tenant kimliği sunucu tarafında üyelikten türetilir; istemci girdisi otorite değildir.
2. Her tenant kaydı tenant-scoped; PostgreSQL RLS savunma derinliği; çapraz-tenant reddi testlidir.
3. Rol/izin kontrolleri sunucudadır; buton gizlemek yetkilendirme değildir.
4. İş emri durum geçişleri açık domain kurallarıyla, audit olaylarıyla.
5. Stok hareketleri append-only; bakiye hareketlerden türetilir; sessiz üzerine yazma yok.
6. Mobil senkronizasyon idempotent, outbox tabanlı, çatışmalar görünür.
7. GPS yalnızca açık teknisyen eyleminde; gizli/sürekli izleme yok.
8. Dosyalar varsayılan özel; yetkili kısa ömürlü imzalı URL ile paylaşılır.
9. Kimlik bilgisi/token/imza içerikleri loglanmaz.
10. Para tam sayı minor birim + ISO para birimi; miktar decimal; timestamp UTC.

## 6. Faz kapısı kuralı

Bir faz ancak eşleşen `prompts/tests/TEST-XX-*.md` prompt'u geçtiğinde **Complete** işaretlenir. Testte kalan gereksinimler düzeltilip test yeniden çalıştırılır; sonraki faza geçilmez. Çalıştırılamayan araç/test açıkça engel olarak raporlanır; uydurma sonuç yok.

## 7. Sonraki adım

Phase 01 (`prompts/phases/PHASE-01-workspace-and-infrastructure-foundation.md`) kullanıcı onayı ile başlatılır. Kabul kriterleri: workspace build edilir; yerel bağımlılıklar başlar; health endpoint'ler yanıt verir; kurulum dokümante edilir; lockfile ve CI mevcut.
