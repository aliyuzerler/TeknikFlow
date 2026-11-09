# Faz 02 Raporu — Brand System, UI Shell and Storybook

Tarih: 2026-11-09 · Yürütücü: geliştirme ajanı · QA kapısı: TEST-02 (bağımsız değerlendirme)

## 1. Özet

Faz 02 kabul kriterleri — *all common components have stories; responsive web shell works; keyboard/accessibility checks pass; no arbitrary token violations* — tamamlandı. TEST-02 kapısı **PASS** (bkz. §5). Marka işareti/wordmark, tek kaynaklı tasarım token sistemi (77 token), duyarlı AppShell (masaüstü kenar çubuğu + mobil ARIA çekmecesi), ortak bileşen kütüphanesi (düğme, girdi, kart, tablo, rozet, diyalog, yan panel, geri bildirim durumları) ve 34 hikâyeli Storybook teslim edildi. `design/preview.html` bileşenlerle birebir yeniden üretildi (`/app/overview` + `Kabuk/AppShell` hikâyesi). Bu fazda **şema/migration yok** (veri modeli değişmedi) ve **yeni API uç noktası yok** (OpenAPI değişmedi).

Süreçte iki önemli kalite kazılımı elde edildi: (1) `tokens.css` tek kaynak ilkesi hayata geçirildi — bileşenlerdeki/stylesheet'teki 56 düz hex değeri 28 yeni anlamsal token'a bağlandı; (2) WCAG kontrast denetimi 8 token değerinin AA uyumlu revizyonunu gerektirdi. Ayrıca geliştirme sırasında ortaya çıkan **Faz 01 kalıntı bir kusur** (`pnpm dev` ile API'nin açılmaması) bu faza prerequisite olarak onarıldı (bkz. §7/2).

## 2. Değişen/eklenen dosyalar (özet)

| Alan | Dosyalar |
|---|---|
| design-tokens | `tokens.css` (43→77 token; kontrast düzeltmeleri), `scripts/generate-tokens.mjs` (Prettier API ile kararlı çıktı + yeni sınıflandırma), `scripts/generate-tokens.d.mts`, `src/tokens.ts` (üretilmiş), `src/tokens.sync.test.ts`, `package.json` (prettier devDep) |
| ui-web | `src/brand/{logo,logo.test}.tsx` (SVG marka işareti + wordmark), `src/icons.tsx` (28 ikon), `src/ui-web.css` (tam bileşen stil sistemi — 250 `var(--tf-*)` kullanımı, 0 düz hex), `src/components/*` (app-shell, button, input, card, data-table, status-badge, confirm-dialog, side-drawer, feedback, page, metric-card + 9 stories + testler), `src/hooks/use-focus-trap.ts`, `.storybook/{main,preview}.tsx` (addon-a11y), `scripts/serve-static.mjs`, `vitest.{unit,stories}.config.ts`, `package.json` |
| Web | `app/layout.tsx` (Inter Variable + ui-web stilleri), `app/globals.css` (app düzeyi 2 değişken), `app/app/overview/page.tsx` + `src/lib/demo-dashboard.ts` (yalnızca demo önizleme — üretim veri yolu yok), `src/lib/phases.ts` (faz haritası 01-02 tamamlandı), `e2e/shell.spec.ts` (8 test), `package.json`, `tsconfig.json` |
| Mobil | `src/theme.ts` (üretilmiş token'lardan RN teması — Faz 07'de tüketilecek) |
| API | `package.json` + `devDependencies` (tsc-watch — §7/2 kusur onarımı; uygulama kodu değişmedi) |
| Doküman | `docs/STATUS.md`, `CHANGELOG.md`, `docs/screenshots/phase-02/*.png` (15 ekran görüntüsü) + bu rapor |

## 3. Mimari kararlar (bu fazda uygulanan)

1. **Tek kaynak token zinciri:** `tokens.css` → `scripts/generate-tokens.mjs` → `src/tokens.ts` (JS/RN) + CSS değişkenleri (web). `tokens.ts` elle düzenlenemez; senkron test (`tokens.sync.test.ts`) `tokens.css` değişip üretim koşulmadan commit edildiğinde KIRMIZI olur. Üretici çıktısı Prettier API ile biçimlenir → `pnpm format` üretimi bozamaz (geliştirme sırasında yakalanan gerçek tutarsızlık).
2. **Token kategorileri:** renk (çekirdek palet + anlamsal yardımcılar + kenar çubuğu paleti + ton varyantları), tipografi ölçeği, yarıçap, gölge/odak, boşluk (8px taban), yazı tipi. Bilinmeyen bir token adı üretimde açıkça hata verir (`Tanınmayan token`) — yazım hatası sessizce yok OLAMAZ.
3. **AppShell duyarlılık stratejisi:** tek DOM; ≤720px'de kenar çubuğu CSS ile gizlenir, hamburger `SideDrawer`'a dönüşür (odak tuzağı + ESC + odak geri dönüşü). Atlama bağlantısı hedefi `tabIndex={-1}` ile klavye odaklanabilir (WCAG 2.4.3).
4. **Odak tuzaği sözleşmesi:** diyaloglar açıldığında ilk odaklanabilir öğeye (ConfirmDialog: Vazgeç; SideDrawer: kapat düğmesi), kapandığında tetikleyiciye döner — iki bileşen aynı kuralı paylaşır ve stories'lerde otomatik doğrulanır.
5. **Storybook etkileşim testleri:** `tags: ['test']` hikâyeler `@storybook/addon-vitest` ile CI'da koşar (34 test); kalan hikâyeler statik derleme + ekran görüntüsü doğrulamasıyla kapsanır. Erişilebilirlik denetimi `@storybook/addon-a11y` ile paneldedir.
6. **Demo/üretim ayrımı:** `/app/overview` ve `ShellContent` hikâyesi `demo-dashboard.ts` DEMO verisi kullanır (etiketleriyle işaretli); üretim veri yollarında sahte veri YOKTUR. Gerçek veri sayfaları iş modelleriyle (Faz 04+) gelir.
7. **Faz haritası tek gerçeklik:** `apps/web/src/lib/phases.ts` `docs/STATUS.md` ile eş tutulur; durum sayfası "şu anki faz"ı sürmekte olan ya da sıradaki başlanmamış fazdan türetir.

## 4. Migration detayları

- **Bu fazda migration yok** — şema değişmedi (`pnpm db:validate` geçerli; `pnpm db:migrate` → "1 migration found, No pending migrations").
- Yeni API sözleşmesi/uç noktası yok → OpenAPI değişikliği yok.

## 5. TEST-02 QA matrisi

Ortam: Linux sandbox, Node v24.22.2, pnpm 9.15.9, Chromium 158.0.8127.18 (Playwright 1.65.0), Next.js 16.4.5, Storybook 10.6.6, gerçek yerel altyapı (embedded PostgreSQL 18, redis-memory-server, RustFS).

| Test ID | Senaryo | Beklenen | Gerçekleşen | Durum | Kanıt |
|---|---|---|---|---|---|
| T02-S1 | Prettier biçim kontrolü | 0 ihlal | "All matched files use Prettier code style!" | PASS | terminal çıktısı (§6) |
| T02-S2 | ESLint (project-aware) | 0 hata | temiz çıkış | PASS | terminal çıktısı |
| T02-S3 | TypeScript typecheck | 14/14 görev | 14/14 successful | PASS | turbo özeti |
| T02-S4 | Üretim derlemesi | tüm paketler | 8/8 successful | PASS | turbo özeti |
| T02-S5 | Prisma şema/migration | değişiklik yok | valid; pending yok | PASS | §4 |
| T02-U1 | ui-web birim (logo, düğme, girdi, tablo, rozet, diyalog, çekmece, durumlar, kabuk) | tümü geçer | 69/69 | PASS | vitest özeti |
| T02-U2 | design-tokens senkron + sınıflandırma | tümü geçer | 3/3 (eşleşmezse kırmızı) | PASS | vitest özeti |
| T02-U3 | Geri kalan paketler regresyonu | önceki sayı | api 17, worker 9, web 10, contracts 7, shared 18, api-client 5 | PASS | vitest özeti |
| T02-I1 | API entegrasyon (gerçek DB/Redis/RustFS) | 3/3 | 3/3 | PASS | vitest özeti |
| T02-B1 | Storybook statik derleme | başarılı | "Storybook build completed successfully" | PASS | derleme çıktısı |
| T02-B2 | Storybook etkileşim testleri (klavye, diyalog odağı, doğrulama, birincil aksiyonlar) | tümü geçer | 34/34 (9 dosya) | PASS | vitest özeti |
| T02-B3 | Tüm ortak bileşenlerin hikâyesi | her bileşen ≥1 story | 9 story dosyası, 34 story (varsayılan/yükleniyor/boş/hata/etkileşim) | PASS | `storybook-static/index.json` |
| T02-E1 | Web E2E — kabuk bütünlüğü (masaüstü 1440px) | kenar çubuğu, marka, üst çubuk, kırıntı, demo içerik | 8/8 shell testi geçti | PASS | playwright list çıktısı |
| T02-E2 | Web E2E — mobil (390px) | kenar çubuğu gizli, hamburger aria-expanded/controls, çekmece klavye akışı, tek sütun | geçti | PASS | playwright çıktısı |
| T02-E3 | Web E2E — klavye/erişilebilirlik | atlama bağlantısı odağı `main`'e taşır; Tab çekmece içinde kalır; ESC kapatır + odak geri döner | doğrulandı | PASS | `e2e/shell.spec.ts` |
| T02-E4 | Web E2E — Faz 01 regresyonu (durum sayfası) | 5/5 | 5/5 | PASS | playwright çıktısı |
| T02-A1 | WCAG kontrast (etkilenen UI) | metin ≥4.5:1, non-text ≥3:1 | 24 çift denetlendi; 8 token revize edildi; son durum tümü uyumlu | PASS | §5-alt kontrast tablosu |
| T02-A2 | Rastgele token ihlali | bileşen kaynağında düz hex yok | ui-web.tsx: 0 hex; ui-web.css: 0 hex (250 var()); web app: 2 app-düzeyi değişken | PASS | grep taraması |
| T02-A3 | Klavye/odak (birim+story+E2E üçlü katman) | odak tuzağı, ESC, odak geri dönüşü, Tab döngüsü | 69 birim + 34 story + E2E doğrulaması | PASS | test çıktıları |
| T02-M1 | Mobil duman (mobil faz değil) | typecheck geçer; test paketi Faz 07'de kurulur | typecheck PASS; jest/maestro N/A (bilinçli) | PASS* | terminal çıktısı |
| T02-P1 | Performans/bundle | API kapasite değişmedi; k6 N/A | web derlemesi statik+dinamik rotalar; k6 kapsam dışı | PASS* | derleme özeti |

*Kapsam dışı (faz gereği, dürüst kayıt): tenant izolasyonu/RBAC senaryoları (Faz 03 — bu fazda tenant verisi yok); Firefox/WebKit dumanı (yalnızca Chromium yapılandırıldı — CI genişletmesi Faz 16); k6 (API davranışı değişmedi); SAST/bağımlılık taraması (Faz 15). Mobil Jest/RNTL/Maestro paketi bilinçli olarak Faz 07'de kurulur; bu fazda mobil yüzey yalnızca temadır ve typecheck ile kapsanır.

### Kontrast denetimi (son değerlerle)

| Çift | Oran | Gerek | Sonuç |
|---|---:|---:|---|
| text / surface, canvas | 16.27 / 15.16 | 4.5 | PASS |
| muted / surface, canvas | 4.90 / 4.56 | 4.5 | PASS (64748b→627289) |
| subtle (küçük not) / surface, bg-quiet | 4.77 / 4.56 | 4.5 | PASS (8290a1→667485) |
| header-muted / surface-alt | 4.56 | 4.5 | PASS (7b8798→697586) |
| placeholder (metin) / surface | 4.56 | 4.5 | PASS (94a3b8→68778c) |
| on-accent / blue-600; ink-950 | 5.17 / 15.99 | 4.5 | PASS |
| success / success-bg | 4.57 | 4.5 | PASS |
| warning-strong / warning-bg | 4.54 | 4.5 | PASS (a16207→9f6005) |
| danger / danger-bg; danger-strong üstü on-accent | 5.30 / 8.31 | 4.5 | PASS |
| info / info-bg | 5.17 | 4.5 | PASS |
| kenar çubuğu paleti (text/item/label/subtle/role) / ink-950 | 5.21–12.21 | 4.5 | PASS |
| count-text / count-bg | 7.54 | 4.5 | PASS |
| teal-600 ilerleme dolumu / border-soft | 3.01 | 3.0 | PASS (0f9f9a→0b9b96) |
| dot-warning, dot-danger, dot-success / surface | 3.01 / 3.76 / 3.04 | 3.0 | PASS (f59e0b→d78000, 10b981→00a971) |
| odak halkası (blue-600) / beyaz | 5.17 | 3.0 | PASS |

Not: 8 token değerinin revizyonu bilinçli bir erişilebilirlik kararıdır — `design/preview.html` yapısal referans olarak kalır; tonlar AA eşiğini geçecek şekilde en az deltayla koyulaştırıldı (görsel karakter değişmedi). Devre dışı arama gibi pasif bileşen metni WCAG 1.4.3 istisnasındadır; token yine de eşikte tutuldu.

## 6. Çalıştırılan komutlar ve tam sonuçlar

```text
pnpm format:check                       → All matched files use Prettier code style!
pnpm lint                               → 0 hata (project-aware)
pnpm typecheck                          → Tasks: 14 successful, 14 total
pnpm test                               → ui-web 69, api 17, shared 18, worker 9, web 10,
                                           contracts 7, api-client 5, design-tokens 3 → 138/138
pnpm test:integration                   → 1 dosya, 3/3 (gerçek PostgreSQL/Redis/RustFS)
pnpm --filter @teknikflow/ui-web test:storybook → 9 dosya, 34/34 etkileşim testi
pnpm --filter @teknikflow/ui-web storybook:build → Storybook build completed successfully
pnpm --filter @teknikflow/ui-web test    → 10 dosya, 69/69 (yeniden koşum)
pnpm build                              → Tasks: 8 successful, 8 total
pnpm --filter @teknikflow/mobile typecheck → PASS (tema tip güvenliği)
pnpm --filter @teknikflow/web test:e2e  → 13 passed (Chromium 158.0.8127.18; shell 8 + status 5)
pnpm db:migrate                         → 1 migration found, No pending migrations
node scripts/serve-static.mjs storybook-static 6010 → Storybook statik sunumu
# Ekran görüntüleri: üretim derlemesi (:3000) + Storybook (:6010) üzerinden Playwright ile
docs/screenshots/phase-02/               → 15 PNG (web kabuğu masaüstü/mobil/çekmece, durum
                                           sayfası, AppShell hikâyesi, bileşen galerisi)
```

## 7. Çözülen hatalar (geliştirme sırasında)

1. **Token üretimi ↔ Prettier kararsızlığı** (Orta): üreticinin ham çıktısı uzun satırlarda Prettier ile çelişiyordu; `pnpm format` üretimi geri alıp senkron testi kırmızıya çeviriyordu → üretici Prettier API ile biçimler (kararlı, çift yönlü).
2. **`pnpm dev` ile API açılmıyor (Faz 01 kalıntısı)** (Kritik): tsx/esbuild `emitDecoratorMetadata` üretmez → Nest DI `PrismaService`'i çözemez, `main.ts` açılışta düşüyordu (entegrasyon testleri vite hattından geçtiği için gizli kalıyordu). Çözüm: `dev` artık `tsc-watch` ile üretimle aynı tsc derlemesinden `node dist/main.js` çalıştırır. Canlı kanıt: `curl :4000/health/ready` → 200, DB/Redis/S3 ok.
3. **Atlama bağlantısı odağı** (Orta): `#tf-main` parça hedefi odak almıyordu → `tabIndex={-1}` + odak halkası gizleme (WCAG 2.4.3).
4. **Hikâye/E2E sorgu belirsizliği** (Orta): masaüstü kenar çubuğu DOM'da kalıp çift eşleşme üretiyordu → çekmeceye kısıtlı `within()`; aç/kapat düğmesi adı durumla değiştiğinden regexp sorgusu.
5. **SideDrawer ilk-odak beklentisi** (Düşük): hikâye ilk odak olarak gövde düğmesini bekliyordu; bileşen sözleşmesi (ilk odaklanabilir öğe) ve ConfirmDialog ile tutarşılaştırıldı; Tab döngüsü assertion'ları eklendi.
6. **Zayıf E2E odak iddiası** (Düşük): `textContent()` promise'i beklenmiyordu → gerçek odak-kapsama (containment) iddiasıyle değiştirildi.
7. **Durum sayfası faz tablosu bayatlığı** (Orta): fazlar 01-02 tamamlandı olarak güncellendi; "şu anki" faz göstergesi sıradaki faza düşer (görüntü doğrulamasında yakalandı).

## 8. Kalan kusurlar / sınırlamalar

- **Kritik/Yüksek: yok.**
- Orta: GitHub Actions iş akışı sandbox'ta çalıştırılamadı — ilk push'ta CI kanalıyla doğrulanacak (Faz 01 kısıtının devamı).
- Düşük: Firefox/WebKit duman tarayıcıları bu fazda yapılandırılmadı (Chromium tek proje) — Faz 16 regresyon genişletmesi kapsamında planlanır.
- Düşük: Storybook görsel regresyon anlık görüntüleri (chromatic benzeri) yapılandırılmadı; etkileşim + statik derleme + elle ekran görüntüsü doğrulaması ile kapsanıyor.
- Bilgi: `/app/overview` demosu bilinçli olarak sabit demo verisi kullanır; canlı veri bağlantısı iş modeli fazlarına (04+) bırakıldı.

## 9. Faz kapısı kararı

TEST-02 kabul kriterlerinin tümü karşılandı; kritik/yüksek açık yok. **Faz 02 kapısı: PASS.** Sonraki faz: 03 — Kimlik, kiracı izolasyonu, RBAC ve onboarding (bağımlılıklar: Faz 01 altyapısı + bu fazın UI kabuğu/tasarım sistemi hazır).
