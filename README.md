# TeknikFlow — ZCode Proje Başlangıç Paketi

**Teknik servis, bakım ve saha operasyonları için çok kiracılı SaaS platformu**

> Marka notu: TeknikFlow bu pakette kullanılan çalışma adıdır. Alan adı, sosyal hesap ve TÜRKPATENT marka uygunluğu ayrıca kontrol edilmeden tescilli/boş/özgün olduğu varsayılmamalıdır.

## Geliştirici Kurulumu (Faz 01 itibarıyla — uygulanmış monorepo)

> Faz 01 tamamlandıktan sonra repo kendi başına çalışır durumdadır.
> Aşağıdaki komutlar gerçek betiklerdir (`package.json`).

Ön koşuller: Node.js 20–24, pnpm 9 (`npm i -g pnpm@9`), Docker (isteğe bağlı —
yoksa `pnpm infra:native`).

```bash
pnpm install --frozen-lockfile     # bağımlılıklar (lockfile doğrulanmış)

# Yerel altyapı (PostgreSQL 18 + Redis 7 + RustFS):
pnpm infra:up                      # A) Docker varsa (docker compose)
# veya
pnpm infra:native                  # B) Docker yoksa (root'suz, embedded)

pnpm db:migrate                    # Prisma migration'larını uygula
pnpm db:seed                       # bucket + app_settings tohumu

pnpm dev                           # API(:4000) + web(:3000) + worker(:4001) + mobil

# Doğrulama:
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test                          # birim testler
pnpm test:integration              # entegrasyon (gerçek DB/Redis/S3 gerektirir)
pnpm --filter @teknikflow/web test:e2e   # Playwright (Chromium)
pnpm build                         # üretim derlemesi
```

Ayrıntılı altyapı notları: `infra/README.md`. Ortam değişkenleri: `.env.example`
→ `.env` kopyalayın (yerel geliştirme değerleri önceden doludur; üretim değerleri
değildir). Health uçları: `GET :4000/health/live`, `GET :4000/health/ready`,
`GET :4001/health` (worker).

## Paket nasıl kullanılır?

1. ZIP'i yeni bir proje klasörüne çıkartın.
2. Klasörü ZCode ile açın.
3. Önce `AGENTS.md` ve `agents.md` dosyalarını okutun. İkisi aynı ana talimatların farklı araç uyumluluğundaki kopyalarıdır.
4. `prompts/START_HERE.md` talimatını verin.
5. Fazları sırayla uygulayın. Her faz için önce `prompts/phases/PHASE-XX-...md`, ardından eşleşen `prompts/tests/TEST-XX-...md` dosyasını çalıştırın.
6. Bir fazın test kapısı geçmeden sonraki faza başlamayın. Testte başarısız olan gereksinimleri düzeltip aynı test promptunu tekrar çalıştırın.

## Ürün vizyonu

TeknikFlow; servis taleplerini, müşteri ve lokasyon kayıtlarını, makine/ekipman envanterini, iş emirlerini, ekip planlamasını, teknisyen mobil operasyonlarını, parça tüketimini, servis raporlarını, bakım sözleşmelerini ve SaaS aboneliklerini tek operasyon platformunda birleştirir.

## Ana uygulamalar

- **Web yönetim paneli:** firma yöneticisi, operasyon/dispatch, depo ve finans ekipleri.
- **React Native mobil uygulama:** saha teknisyeni ve ekip lideri; çevrimdışı öncelikli iş akışları.
- **Müşteri portalı:** servis talebi açma, teklif onaylama, ziyaret/servis raporu ve ekipman geçmişi görüntüleme.
- **Platform yönetim alanı:** SaaS operatörünün tenant, plan, abonelik ve destek işlemleri.

## Önerilen monorepo

```text
apps/
  api/                 # NestJS REST API
  web/                 # Next.js web paneli + müşteri portalı + platform admin
  mobile/              # Expo React Native teknisyen uygulaması
  worker/              # Kuyruk/planlanmış işler
packages/
  contracts/            # Zod şemaları ve DTO sözleşmeleri
  api-client/           # Üretilmiş/typed API client
  ui-web/               # Web design system
  design-tokens/        # Ortak renk, boşluk, tipografi tokenları
  config/               # ESLint, TS, test ve build config
  shared/               # Saf ortak domain yardımcıları
infra/                  # Docker, CI, observability, deployment
```

## Başlangıç teknoloji tercihleri

- TypeScript uçtan uca
- pnpm workspace + Turborepo
- Next.js (App Router), React, Tailwind CSS, Radix tabanlı erişilebilir bileşenler
- Expo + React Native; mobilde NativeWind zorunlu değil, ortak design token'larıyla StyleSheet kullanılabilir
- NestJS, PostgreSQL, Prisma
- Redis + BullMQ
- S3 uyumlu obje depolama (yerelde MinIO)
- Web UI: Storybook + Vitest + Testing Library
- Web E2E: Playwright
- API: Jest/Vitest (tek runner seç, proje boyunca tutarlı kal) + Supertest
- Mobile: Jest + React Native Testing Library; cihaz akışları için Maestro
- CI: GitHub Actions

Versiyonları uygulama oluşturulurken resmi dokümantasyondan kontrol et; paket yöneticisi lockfile üretmeli. Birbirini desteklemeyen rastgele “latest” sürümleri bir araya getirme.

## Önemli ürün kararları

- Her müşteri işletmesi ayrı **tenant** olarak izole edilir. Aynı tenant altında birden fazla şube, depo, ekip ve kullanıcı olabilir.
- Abonelik ve kullanıcı koltuğu (seat) limitleri tenant bazlıdır. Faturalama sağlayıcısı `BillingProvider` arayüzü arkasında soyutlanır.
- MVP'de gerçek ödeme sağlayıcısı seçimi yapılandırılabilir tutulur. Geliştirmede mock provider kullan; canlı ödeme öncesi Türkiye'deki güncel sağlayıcı, sözleşme, vergi ve webhook koşullarını ayrıca doğrula.
- Mobil uygulama offline-first çalışır. İş emirleri, kontrol listeleri ve taslak raporlar yerel kuyruğa yazılır; bağlantı gelince idempotent şekilde senkronize edilir.
- GPS sürekli izleme varsayılanı **kapalıdır**. Konum yalnızca teknisyen açıkça servis başlangıcı/varış/ayrılış/check-out eylemi yaptığında ve uygulama görünür bilgilendirme sunduğunda alınır.
- Dijital çizim imzası imza kanıtı ve servis formu eki olarak ele alınır; nitelikli elektronik imza veya hukuken kesin delil olduğu iddia edilmez.

## Test kapısı

Her PR/faz sonu en az: format, lint, typecheck, unit, API integration, Storybook interaction/component, Playwright web E2E, mobile test (ilgili değişiklikte), build ve migration kontrolü. Kritik akışlar için başarısızlık kabul edilmez.

## Başlangıç komutu

ZCode'a `prompts/START_HERE.md` dosyasını verin. Bu dosya yalnızca planı ve repo iskeletini oluşturur; tüm ürünü tek seferde üretmeye çalışmaz.
