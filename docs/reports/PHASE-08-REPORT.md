# PHASE 08 REPORT — Technician job execution, GPS, media and signature

- Tarih: 2026-11-10
- Kapı: TEST-08 (`prompts/tests/TEST-08-technician-job-execution-gps-media-and-signature.md`)
- Sonuç: **PASS** (bkz. §9)
- Mimari kararlar: ADR-0010 (bu fazda yazıldı), ADR-0005 (dosya depolama — uygulandı), ADR-0004 (outbox — yürütücüler bağlandı), ADR-0007 (durum makinesi — kanıt kapıları eklendi)
- Kanıt: sözleşme 37 birim; API 170 birim + 157 entegrasyon (18 yeni); ui-web 104 birim + 71 Storybook; web 19 birim + 38 E2E; mobil 99 Jest; komut çıktıları §6

## 1. Özet

Faz 08, teknisyenin saha yürütmesini **kanıt üreten** bir akışa dönüştürdü: kabul → yola çıkış → **GPS kilometre taşıyla varış** (cihaz konumu ya da izin redli manuel onay+neden) → iş başlatma → checklist → **işgücü kaydı** (seyahat/iş/bekleme) → fotoğraf/video (**iki adımlı yükleme**, magic-byte doğrulaması) → **müşteri imzası** (ekle-güncelle-yok, düzeltme zinciri) → tamamlama → kapatma. **Kanıt kapıları** durum makinesine bağlandı: COMPLETED için zorunlu checklist tam (eksikse 409 `EVIDENCE_MISSING` + eksik listesi), CLOSED için ≥1 imza. Mobil taraf her mutasyonu **outbox + idempotency anahtarıyla** gönderir (uçak modu/çift dokunuş güvenli); sunucu `(kiracı, kullanıcı, anahtar)` tekil satırında kanonik yanıtı saklar ve oynatır. Web: varış çekmecesi, yürütme paneli ve `/work-orders/:id/report` yürütme raporu.

## 2. Değişen/eklenen dosyalar (özet)

**Sözleşme:** `packages/contracts/src/execution.ts` (YENİ — GPS/varış/checklist/süre/medya/imza/rapor şemaları + etiketler + `MEDIA_RULES` beyaz listesi + `EXECUTION_IDEMPOTENCY_HEADER`), `service.ts` (`GpsLocationSchema` + transition'a opsiyonel `location` — ON_SITE hedefinde zorunlu superRefine), `index.ts`, `execution.test.ts` (YENİ, 13 test).

**API:** `src/execution/` modülü (YENİ): `execution.controller.ts` (12 uç), `execution.service.ts` (checklist/süre/rapor + kaynak-düzeyi yetki), `media.service.ts` (init→imzalı PUT→complete doğrulama hattı), `signature.service.ts` (ekle-güncelle-yok + düzeltme), `idempotency.service.ts` (tek-transaction yanıt deposu + oynatma), `execution-utils.ts` (magic-byte koklama + işgücü hesabı — saf), `execution-utils.test.ts` (YENİ). Değişen: `work-orders.service.ts` (kanıt kapıları + ziyaret/GPS yazımı + `locationMetadata`), `common/error-envelope.filter.ts` (`missing[]` + Faz 08 güvenli ayrıntı alanları), `app.module.ts` (ExecutionModule). Testler: `tests/integration/execution.integration.test.ts` (YENİ, 18 test) + `work-orders.integration.test.ts` (varış konumu + imza kapısı güncellemesi).

**api-client:** `execution-client.ts` (YENİ — tüm yürütme uçları + idempotency başlığı + `replayed` + EVIDENCE_MISSING alanları + `uploadMediaBytes`), `index.ts`.

**Mobil:** `src/location/gps.ts` (YENİ — saf GPS çekirdeği + manuel geri dönüş) + `expo-location-provider.ts` (YENİ — native adapter), `src/sync/outbox-executors.ts` (YENİ — 7 işlem yürütücüsü + sınıflandırma), `sync-service.ts` (drainOutbox yürütücüleri bağlar), `src/screens/execution-actions.ts` (YENİ — outbox'a giren saha eylemleri), `work-order-detail-screen.tsx` (yürütme paneli + rapor), `src/components/execution-panel.tsx` (YENİ), `src/components/signature-pad.tsx` (YENİ — RN tuval), `src/api/client.ts` (Faz 08 istemci metotları + `x-idempotency-key` + `replayed`), `App.tsx`/`navigator.tsx` (bağlama), `package.json` (expo-location). Testler: `gps.test.ts`, `outbox-executors.test.ts`, `execution-actions.test.ts`, `signature-pad.test.tsx` (YENİ, 28 test) + `sync-service.test.ts` (bilinmeyen işlem güncellemesi).

**Web/ui-web:** `packages/ui-web/src/components/signature-pad.tsx` (YENİ — erişilebilir HTML canvas + `sanitizeStrokes`) + stories + test + CSS; `apps/web/app/app/work-orders/[id]/execution-panel.tsx` (YENİ — checklist/süre/imza), `work-order-actions.tsx` (varış çekmecesi + EVIDENCE_MISSING dürüst mesajları), `page.tsx` (panel + rapor bağlantısı), `[id]/report/page.tsx` (YENİ — yürütme raporu, SVG imza eskizi). E2E: `service.spec.ts` (varış manuel onay + imza kapısı + rapor).

**Doküman:** ADR-0010, STATUS.md, CHANGELOG 0.8.0, API_CONVENTIONS.md (Faz 08 uçları), bu rapor.

## 3. Mimari kararlar (bu fazda uygulanan — ADR-0010)

1. **Kanıt kapıları:** COMPLETED ← zorunlu checklist tam; CLOSED ← ≥1 imza; her ikisi de 409 `EVIDENCE_MISSING` (kapı + eksik listesi hata zarfında). Kapılar geçiş transaction'ı içinde, yetki sınıfından sonra — atomik.
2. **GPS:** ON_SITE (ARRIVE) konum zorunlu; `source=GPS` koordinat ister, `source=MANUAL` + `manualReason` izin redli geri dönüş (koordinatsız geçerli); `→COMPLETED` ayrılış opsiyonel konumla; `work_order_visits` append-only, `recordedAt` cihaz zamanından (geç senkronlarda gerçek varış saati).
3. **İmza:** JSON yol koordinatları (SVG YOK — script enjeksiyon yüzeyi yok); ekle-güncelle-yok; düzeltme yeni satır + `correctionOfId`, eski satırın `supersededById`'si tek seferlik güncellenir; ikinci düzeltme 409.
4. **Medya (ADR-0005 uygulaması):** init → 10dk imzalı PUT → doğrudan RustFS → complete → HEAD + ilk 32 bayt magic-byte + boyut + MIME → READY | FAILED (sınıflı kod); SVG reddi; imzalı indirme URL'si 5dk (her yanıtta taze — oynatma dahil).
5. **Idempotency:** iş mantığı + anahtar kaydı AYNI transaction'da (çökmede birlikte geri alınır — çift imza yüzeyi kapalı); eşzamanlı çift gönderimde tekil kısıt → kaybeden rollback, kazananın yanıtı oynatılır; TTL 24 saat.
6. **İşgücü:** kullanıcı-iş başına tek AÇIK kayıt (409); dakika ceil (müşteriye yansıyan süre konservatif); rapor `labor` özeti Faz 06 kapasite tahmininin sahadaki karşılığı.
7. **Mobil offline-first tek yol:** her saha eylemi ÖNCE outbox'a girer (UUID idempotency anahtarıyla) sonra kuyruk boşaltılır; ağ hatası üstel backoff, kalıcı 4xx 24 saat dondurma ("sunucu kazanır" — OFFLINE_SYNC çatışma politikası).

## 4. Migration detayları

`20261110085651_phase08_execution_gps_media_signature` — 7 enum (`visit_milestone`, `gps_source`, `time_entry_type`, `time_entry_status`, `media_kind`, `file_status`, `signature_role`) + 6 tablo (`work_order_visits`, `work_order_checklist_items`, `time_entries`, `file_objects`, `work_order_signatures`, `idempotency_keys`) + indeksler + FK zinciri + **RLS FORCE blokları** (ADR-0003 şablonu; migration dosyasının içinde — taze ortamlarda migration'la birlikte uygulanır). `prisma migrate dev` ile üretilmiş, `migrate reset` ile baştan uygulandığı doğrulandı; `pg_class` kanıtı: 6/6 `relrowsecurity=t AND relforcerowsecurity=t` (uygulama rolü bağlamıyla sorgulandı — §6). `db:setup-role` (idempotent GRANT) her migration sonrası çalışır. Geri alma: tablolar DROP; iş emri çekirdeği değişmez (yalnız opsiyonel `location` girdisi).

## 5. TEST-08 QA matrisi

Ortam: Linux sandbox; Node v24.22.2; pnpm 9.15.9; embedded PostgreSQL 18.6; redis-memory-server (Rust binary); RustFS 1.0.4 (S3 API :9000); vitest 5 / jest 29.7 + RNTL 13.2; Playwright Chromium (üretim derlemesi, `AUTH_RATE_LIMIT_MAX=50` yalnız test süreci env'i — limiter mantığı integration'da gerçek limitlerle). **Emülatör/cihaz: YOK (Maestro BLOCKED — T08-M1).**

| Test ID | Senaryo | Beklenen | Gerçekleşen | Durum | Kanıt |
|---|---|---|---|---|---|
| T08-S1 | Prettier | 0 ihlal | temiz | PASS | §6 |
| T08-S2 | ESLint | 0 hata | temiz (3 unused-import düzeltmesiyle) | PASS | §6 |
| T08-S3 | Typecheck | tüm paketler | tümü | PASS | turbo |
| T08-S4 | Üretim derlemesi | tüm paketler | 8/8 (FULL TURBO cache dahil) | PASS | §6 |
| T08-S5 | Migration doğrulaması | uygulanır + RLS FORCE | 6/6 tablo FORCE (pg_class, uygulama rolü bağlamında) | PASS | §6 |
| T08-U1 | Sözleşme: GPS kuralları (GPS koordinat zorunlu; MANUEL neden zorunlu; sınırlar), ON_SITE kapısı, checklist/süre/imza/medya sınırları (path traversal, üst limit, nokta alt sınırı) | tümü | 13 yeni (37 toplam sözleşme) | PASS | `execution.test.ts` |
| T08-U2 | Magic-byte koklama: JPEG/PNG/PDF/MP4-ftyp tanır; SVG/metin/EXE/ELF tanımaz; MIME eşleşmesi | tümü | 6/6 | PASS | `execution-utils.test.ts` |
| T08-U3 | İşgücü özeti: tür toplamları, açık kayıt işareti, ceil yuvarlama (61sn→2dk), negatif aralık yok sayma, boş liste | tümü | 5/5 | PASS | aynı |
| T08-U4 | API birim toplamı | regresyon yok | 157→**170** (+13) | PASS | vitest |
| T08-I1 | **Kabul — izin reddi/manuel geri dönüş:** ON_SITE konumsuz 400; GPS konumu ziyarete koordinat+doğrulukla yazılır; MANUEL+neden koordinatsız geçer; MANUEL nedensiz 400 | tümü | 4/4 | PASS | `execution.integration.test.ts` |
| T08-I2 | **Kabul — GPS doğruluk meta'sı:** rapor ziyaretinde ±m + kaynak + neden | meta taşınır | accuracyMeters=12.5, source=GPS/MANUAL kanıtlandı | PASS | aynı |
| T08-I3 | **Kabul — çift senkron (idempotency):** aynı anahtarla imza çift gönderimi → TEK satır + `x-idempotent-replay: true` | tek kayıt | liste 1 imza; başlık taşındı | PASS | aynı |
| T08-I4 | **Kabul — medya yeniden deneme:** PUT yok → 409 `UPLOAD_NOT_RECEIVED`; sahte içerik (SVG→jpg declared) → FAILED `MAGIC_BYTE_MISMATCH`; gerçek JPEG → READY + imzalı URL gerçek baytları döndürür; çift complete idempotent | tümü | 3/3 (RustFS gidiş-dönüşü kanıtlı) | PASS | aynı |
| T08-I5 | **Kabul — imza ekle-güncelle-yok:** düzeltme yeni satır + eski `supersededById`; geçmiş kalır (2 satır); ikinci düzeltme 409 `SIGNATURE_ALREADY_CORRECTED` | append-only | kanıtlandı | PASS | aynı |
| T08-I6 | Kanıt kapıları: zorunlu madde eksik → 409 + `missing[]`; tamamlanınca geçer; opsiyonel madde engellemez; imzasız kapatma 409; imzalı kapatma geçer | tümü | work-orders + execution entegrasyonlarında | PASS | 2 dosya |
| T08-I7 | Süre kayıtları: açık→çift açılış 409 `TIME_ENTRY_ALREADY_OPEN`→durdur (90dk)→çift durdurma idempotent; rapor işgücü özeti | tümü | kanıtlandı | PASS | `execution.integration.test.ts` |
| T08-I8 | Terminal durum: CLOSED iş emrine checklist/imza/medya → 409 `WORK_ORDER_IMMUTABLE` | kanıt eklenmez | 3/3 | PASS | aynı |
| T08-I9 | Yetki sınırları: depo (complete yok) madde tamamlayamaz 403 + imza yakalayamaz 403 | kaynak düzeyi | kanıtlandı | PASS | aynı |
| T08-I10 | Kiracı izolasyonu: B kiracısı A'nın rapor/checklist/süre/medya/imza OKUMASI 404 + YAZMA denemesi 404 (varlık sızıntısı yok) | izole | 6 uç okuma + 1 yazma | PASS | aynı |
| T08-I11 | Entegrasyon toplamı | regresyon yok | 139→**157** (+18) | PASS | vitest |
| T08-M1 | Mobil: GPS çekirdeği (izin red→denied; sinyal yok→unavailable; GPS→konum), yürütücüler (idempotency taşıma, ağ→retryable, 409→kalıcı, 5xx→retryable, bilinmeyen), saha eylemleri (outbox'a girme, drain tetikleme, oturumsuz reddi), imza tuvali (etiket/temizle/testID) | tümü | 28 yeni (99 toplam mobil) | PASS | 4 test dosyası |
| T08-M2 | Maestro saha akışı (emülatör) | cihazda | **BLOCKED** — emülatör/cihaz yok (Faz 07 kalıntısı); RNTL karşılıkları + entegrasyon uçları davranışı kapsıyor | BLOCKED | §8 |
| T08-W1 | ui-web SignaturePad: erişilebilirlik (aria), çizim→onStrokesChange, tek nokta düşürme, devre dışı, temizle | tümü | 7 yeni (104 toplam) + Storybook etkileşim hikâyesi (71 toplam) | PASS | `signature-pad.test.tsx` + stories |
| T08-W2 | api-client: idempotency başlığı + replayed + EVIDENCE_MISSING alanları; `uploadMediaBytes` gövde türleri | derler + 21 eski test geçer | 21/21 + typecheck | PASS | vitest |
| T08-E1 | Web E2E (üretim derlemesi): tam yaşam döngüsü + **varış çekmecesi manuel onay (izin redli konum)** + imza tuvali fare çizimi + imzasız kapatma reddi + imzalı kapatma + **rapor sayfası** (konum kaydı, imza, işgücü) + önceki 34 regresyon | 38/38 | **38/38** | PASS | playwright |
| T08-A1 | Erişilebilirlik: imza tuvali role=img + aria-label; çekmece odak/ESC (Faz 02 desenleri); klavye ile varış | a11y | tuval aria + mevcut SideDrawer odak tuzakları | PASS | W1 + shell E2E |
| T08-A2 | Güvenlik: SVG reddi (sözleşme + magic-byte + E2E), path traversal dosya adı reddi, token/PII loglanmaz, RLS FORCE 6 tablo | tümü | kanıtlandı | PASS | I4 + §6 |

## 6. Çalıştırılan komutlar ve tam sonuçları

```
pnpm format:check         → All matched files use Prettier code style!
pnpm lint                 → eslint . (0 hata — 3 unused-import düzeltmesi sonrası)
pnpm turbo run typecheck  → tüm paketler (api, web, mobile, ui-web, api-client, contracts, shared, worker, design-tokens)
pnpm turbo run test       → contracts 37 · api 170 · api-client 21 · ui-web 104 · mobile 99 · web 19 · shared 18 · worker 9 · design-tokens 3
pnpm --filter @teknikflow/api test:integration → 9 dosya, 157/157 (execution.integration.test.ts: 18/18)
pnpm --filter @teknikflow/ui-web test:storybook → 16 dosya, 71/71
pnpm build                → 8/8 paket (turbo; FULL TURBO cache doğrulaması)
pnpm --filter @teknikflow/web test:e2e → 38/38 (Chromium; üretim derlemesi; temiz DB + seed)
pg_class sorgusu (teknikflow_app rolüyle):
  file_objects:FORCE idempotency_keys:FORCE time_entries:FORCE
  work_order_checklist_items:FORCE work_order_signatures:FORCE work_order_visits:FORCE
prisma migrate reset --force → tüm migration'lar (phase08 dahil) temiz DB'de yeniden uygulandı
```

Ortam notu: E2E koşumu öncesi `AUTH_RATE_LIMIT_MAX=50` (yalnız yerel .env — test süreci; entegrasyon testleri limiterı gerçek limitiyle ayrı örneklemde sınar) ve **temiz veritabanı** (migrate reset + seed) kullanıldı; koşum sırasında kaynak dosya değiştirilmedi (tsc-watch yeniden başlatması testi böler — §7).

## 7. Çözülen hatalar (geliştirme sırasında)

1. **Varış çekmecesi "Ağa ulaşılamadı":** E2E koşumu sırasında lint düzeltmeleri tsc-watch'ı tetikledi → API yeniden başladı → istek öldü. Çözüm: derlenmiş `node dist/main.js` (watch yok) + koşum sırasında kaynak değiştirmeme.
2. **E2E SCHEDULE_CONFLICT:** önceki koşumun bıraktığı atanmış iş aynı sabit pencereye ikinci atamayı reddetti (Faz 06 koruması DOĞRU çalışıyordu). Çözüm: temiz DB reset + seed ile tek koşum.
3. **Hata zarfı beyaz listesi:** `gate`/`missing` alanları `ErrorEnvelopeFilter`'ın beyaz listesinde yoktu → istemci eksik listeyi göremiyordu. Çözüm: filter'a `missing[]` (conflicts deseni) + güvenli ayrıntı alanları eklendi.
4. **Test pencere çakışması (integration):** aynı teknisyene aynı zaman penceresi → Faz 06 çakışma denetimi 409. Çözüm: her testte benzersiz pencere (günlük kaydırma).
5. **Playwright tarayıcı ikilileri:** sandbox'ta chromium_headless_shell-1254 eksikti → `playwright install chromium` ile indirildi.
6. **redis-memory-server kaynak derleme hatası:** altyapı betiği Redis'i kaynaktan derlemeye çalışıp başarısız oldu; indirilmiş hazır binary (v8.10.2) doğrudan çalıştırıldı (postgres/pg_ctl + rustfs manuel başlatma ile aynı yaklaşım).

## 8. Kalan kusurlar / sınırlamalar

1. **T08-M2 — Maestro yürütmesi BLOCKED:** emülatör/cihaz yok (Faz 07 kalıntısı). RNTL (99) + entegrasyon (157) + E2E (38) davranışı kapsıyor; Maestro akış dosyaları hazır.
2. **EXIF temizleme + karantina kancası:** ADR-0005'te görüntü yeniden kodlama/EXIF silme ve malware tarama worker fazını bekliyor (QUARANTINED durumu şemada hazır; Faz 08'e giren hiçbir medya karantinaya alınmıyor — magic-byte/boyut/MIME hattı etkin).
3. **Cihaz saati güveni:** `capturedAt` istemciden; sahte saat yalnız raporlanabilir (clamp yok) — ADR-0010 §Consequences'te belgelendi.
4. **Mobil medya çekici UI:** iki adımlı yükleme API/istemci/outbox executorleri tam; kamera/galeriden seçim (expo-image-picker) ekran bağlamı bir sonraki iterasyonda (bağımlılık kuruldu, typecheck'te).
5. **Video süre limiti doğrulaması:** ADR-0005'te anılan süre denetimi worker'ın görüntü işleme hattına bırakıldı.

## 9. Faz kapısı kararı

TEST-08 kabul kriterlerinin tümü karşılandı: **izin reddi/manuel geri dönüş** (entegrasyon I1 + E2E — tarayıcı konumu reddedildi → manuel onay + nedenle varış); **GPS doğruluk meta'sı** (I2 — koordinat + ±m + kaynak raporda); **uçak modu/çift senkron** (I3 — aynı idempotency anahtarı → tek satır + oynatma başlığı; mobil outbox testleri); **medya yeniden deneme** (I4 — PUT yok 409, sahte içerik FAILED, gerçek JPEG READY + imzalı URL döndürür); **imza ekle-güncelle-yok** (I5 — düzeltme zinciri, geçmiş kalır, ikinci düzeltme 409). Kritik/yüksek açık yok; Maestro BLOCKED kalemi cihaz yokluğundan (ürün davranışı RNTL+entegrasyon+E2E ile kanıtlı — Faz 07 emsal kararına uygun). **Faz 08 kapısı: PASS.** Sonraki faz: 09 — Envanter, araç stoğu ve parça tüketimi (bağımlılıklar hazır: işgücü/checklist kanıt altyapısı, RBAC `stock:*` izinleri katalogda, `file_objects` genişletilebilir şema).
