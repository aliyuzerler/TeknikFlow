# PHASE 05 REPORT — Service intake and work-order lifecycle

- Tarih: 2026-11-09
- Kapı: TEST-05 (`prompts/tests/TEST-05-service-intake-and-work-order-lifecycle.md`)
- Sonuç: **PASS** (bkz. §9)
- Kanıt dizinleri: `docs/screenshots/phase-05/` (8 görüntü), entegrasyon/E2E çıktıları §6

## 1. Özet

Faz 05, servis akışının omurgasını kurdu: **servis talebi (intake) gelen kutusu → triyaj → iş emrine dönüşüm → 12 durumlu yaşam döngüsü → kapatma**, uçtan uca. Durum makinesi tek gerçeklik olarak saf modülde (ADR-0007); iş emri numaraları kiracı+yıl başına atomik sayaçla üretilir; atamalar append-only geçmişle; notlar dahili/müşteri-görünür ayrımıyla; SLA kiracı politikasıyla (varsayılan katalog dahil) hesaplanır ve aşım bayrağıyla görünür. 8 yeni RLS FORCE tablosu; 37 yeni entegrasyon testi; 6 yeni E2E testi; 4 yeni Storybook hikâyesi (Timeline bileşeni).

## 2. Değişen/eklenen dosyalar (özet)

**Sözleşme:** `packages/contracts/src/service.ts` (yeni — enum'lar, şemalar, görünümler, liste zarfları, UI etiket haritaları, görünür geçiş tablosu).

**API:** `apps/api/src/service/` (yeni modül): `work-order-state.ts` (durum makinesi), `request-state.ts`, `sla.ts`, `work-orders.service.ts`, `work-orders.controller.ts`, `requests.service.ts`, `requests.controller.ts`, `service.module.ts`; birim testleri (`*.test.ts`, `service-contracts.test.ts`). `app.module.ts` kaydı.

**Veritabanı:** `prisma/schema.prisma` (+8 model/enum seti, ilişkiler); migration `20261109092257_phase05_service_intake_work_orders` (+RLS FORCE ×8); `prisma/seed.ts` (kategoriler, SLA politikaları, 3 talep + 8 iş emri demo verisi, sayaç senkronu).

**İstemci:** `packages/api-client/src/service-client.ts` (+test) — talep/İE listeleme-detay-mutasyon typed istemcisi.

**ui-web:** `components/timeline.tsx` (+stories +test), `ui-web.css` (tf-timeline stilleri), `index.ts`/`server.ts` ihracatı.

**Web:** `/app/requests` (gelen kutusu + arama/filtre + yeni talep çekmecesi), `/app/requests/[id]` (bilgiler + triyaj + dönüşüm + iptal + etkinlik geçmişi), `/app/work-orders` (liste + yeni İE çekmecesi), `/app/work-orders/[id]` (bilgiler + eylem paneli + atama/planlama çekmeceleri + notlar + atama geçmişi + zaman çizelgesi + düzenleme); `app/layout.tsx` navigasyonu (yetkiye dayalı).

**Doküman:** `docs/decisions/ADR-0007`, STATUS.md, CHANGELOG 0.5.0, bu rapor.

## 3. Mimari kararlar (bu fazda uygulanan)

1. **ADR-0007 — Durum makinesi tek gerçekliği:** saf geçiş tablosu + 5 yetki sınıfı (PLANNING/DISPATCH/EXECUTION/CLOSE/CANCEL); birleşik geçiş ucu; sözleşmenin görünür tablosuyla birebirlik birim testle kanıtlı. "Assigned only": EXECUTION = `work_orders:complete` VE (`view_all` VEYA aktif atanan) — teknisyen yalnız kendi işini yürütür, kapatamaz (yönetici: CLOSE).
2. **Numaralandırma:** `WO-YYYY-NNNN` — sayaç tablosunda `ON CONFLICT DO UPDATE ... RETURNING` (atomik, RLS'e tabi); `(tenantId, workOrderNo)` tekil indeks geri savunma; 5-paralel koşum testiyle kanıt.
3. **İyimser eşzamanlılık:** `version` — PATCH'te zorunlu, geçişte opsiyonel → 409 VERSION_CONFLICT (TEST-05 "stale version" senaryosu).
4. **Atanabilirlik kuralı:** `complete` VEYA `view_assigned` izni olan roller atanabilir (teknisyen/owner/admin/servis yöneticisi); finans/planlayıcı atanamaz (görür ama yürütmeyen roller). Şube kapsamı atamada doğrulanır (BRANCH_SCOPE_MISMATCH) — Faz 04'ün notu kapatıldı.
5. **SLA:** dakika bazlı politika (kiracıya özel; varsayılan URGENT 4sa/HIGH 8sa/MEDIUM 24sa/LOW 72sa); `slaDueAt` createdAt referansından; triyajda öncelik değişince yeniden hesap.
6. **Talep↔İE birebir dönüşüm:** `WorkOrder.requestId` tekil; talep CONVERTED terminali; ikinci dönüşüm 409 REQUEST_NOT_CONVERTIBLE.
7. **Olay akışı:** `work_order_events` (append-only, güvenli meta) + önemli adımlar `crm_events`'e (müşteri/varlık zaman çizelgesi tek kaynağı) + audit kayıtları.
8. **E2E seri modu:** zincir-bağımlı yaşam döngüsü testleri `describe.configure({mode:'serial'})` ile tek worker'da — `fullyParallel` altındaki RUN uyuşmazlığı çözüldü (§7).

## 4. Migration detayları

`20261109092257_phase05_service_intake_work_orders`: 8 tablo (`service_categories`, `sla_policies`, `service_requests`, `work_orders`, `work_order_assignments`, `work_order_events`, `work_order_notes`, `work_order_counters`) + 7 enum + indeksler `(tenantId, status, createdAt)`, `(tenantId, assignedToId, scheduledStart)`, `(tenantId, customerId, createdAt)`, `(tenantId, workOrderNo) TEKİL`, `(requestId) TEKİL` + **RLS ENABLE+FORCE ×8** (uygulama rolü `teknikflow_app` dahil tüm roller politikalara tabi). Uygulama: `pnpm db:migrate` (migration sahibi + `db:setup-role` ile uygulama rolü tazelendi). Doğrulama: `prisma migrate status` → "Database schema is up to date!"; RLS bayrakları pg_class sorgusuyla 8/8 FORCE kanıtlandı.

## 5. TEST-05 QA matrisi

Ortam: Linux sandbox; Node v24.22.2; pnpm 9.15.9; embedded PostgreSQL 18 (`teknikflow_app` NOSUPERUSER — RLS etkin); redis-memory-server; RustFS 1.0.4; Chromium (Playwright, üretim derlemesi üzerinde).

| Test ID | Senaryo | Beklenen | Gerçekleşen | Durum | Kanıt |
|---|---|---|---|---|---|
| T05-S1 | Prettier | 0 ihlal | "All matched files use Prettier code style!" | PASS | §6 |
| T05-S2 | ESLint | 0 hata | temiz | PASS | §6 |
| T05-S3 | Typecheck | tüm paketler | 14/14 | PASS | turbo |
| T05-S4 | Üretim derlemesi | tüm paketler | 8/8 | PASS | turbo |
| T05-S5 | Prisma validate + migrate status | geçerli + güncel | "The schema is valid" / "up to date!" | PASS | §6 |
| T05-S6 | RLS FORCE doğrulaması | 8/8 yeni tablo | 8/8 (pg_class: rls=t, force=t) | PASS | §4 |
| T05-U1 | Durum makinesi birim: 12×12 TAM matris (izinli 24, reddedilen 120) | kabul listesiyle birebir + terminallerden geçiş yok + kendine geçiş yok | 14/14 | PASS | `work-order-state.test.ts` |
| T05-U2 | Sözleşme-makine birebirliği (ADR-0007) | WORK_ORDER_TRANSITION_TARGETS ≡ makine | PASS | PASS | aynı |
| T05-U3 | Talep makinesi + SLA birim (dönüşüm açıklığı, terminal, SLA aritmetiği/aşım) | tümü | 8/8 | PASS | `request-state.test.ts` |
| T05-U4 | Sözleşme doğrulama birim (sınır değerleri: konu uzunluğu, schedule sırası, ASSIGNED zorunlusu, CANCELLED nedeni, expectedVersion, not görünürlüğü) | tümü | 10/10 | PASS | `service-contracts.test.ts` |
| T05-U5 | API birim toplam (+Faz 05 dosyaları) | tümü | 121/121 (17 dosya) | PASS | vitest |
| T05-U6 | ui-web birim (+Timeline 7) / api-client (+7) / diğer paketler | regresyon yok | ui-web 91, api-client 21, contracts 7, shared 18, worker 9, web 10, design-tokens 3 → **280/280** | PASS | turbo |
| T05-I1 | Talep entegrasyonu: oluşturma (varsayılan/kiracı SLA'sı), FK uyumsuzluğu (404/400), arama/sayfalama, uzun metin sınırı, triyaj (SLA yeniden hesabı, geçersiz geri dönüş), dönüşüm (birebir, schedule'lu PLANNED), iptal (neden, terminal 409), kategoriler (çift 409), kiracı izolasyonu, teknisyen 403'leri | tümü | 15/15 | PASS | `service-intake.integration.test.ts` |
| T05-I2 | İE entegrasyonu: numara (biçim, ardışık, 5-paralel TEKİL), TAM yaşam döngüsü (DRAFT→…→CLOSED; teknisyen yürütür, kapatamaz 403; kapanan terminal), bekleme döngüsü, yeniden açma (completedAt temizlenir), geri alma/atama kaldırma (REMOVED geçmişi), geçersiz geçişler (409 + şema 400'leri), iptal (dispatcher yetkili), atanmamış teknisyen 403, mine filtresi, dispatcher yürütmez, atanamayan üye (404/400), çift atama idempotent, assignable-users (dispatch yetkisi; teknisyen 403), sürüm çakışması (PATCH+geçiş), kiracı izolasyonu (404/boş liste + RLS ham kanıt), not görünürlükleri (meta'da gövde YOK), liste filtreleri | tümü | 22/22 | PASS | `work-orders.integration.test.ts` |
| T05-I3 | Önceki entegrasyonlar (auth/izolasyon/CRM/rate-limit/health) | regresyon yok | 72/72 → toplam **109/109** | PASS | vitest |
| T05-A1 | Kabul: TÜM izinli geçişler test edildi | 24/24 geçiş entegrasyonda işletildi | işletildi (I2 zincirleri: PLAN/ASSIGN/ACCEPT/EN_ROUTE/ON_SITE/IN_PROGRESS/WAITING_×2/RESUME×4/COMPLETE/REOPEN/CLOSE/CANCEL×2/BACK_TO_DRAFT/UNASSIGN) | PASS | I2 |
| T05-A2 | Kabul: geçersiz geçişler reddedilir | 409 INVALID_TRANSITION (birim 120 kombinasyon + entegrasyon atlama/geri sarma/kendine) | doğrulandı | PASS | U1+I2 |
| T05-A3 | Kabul: numara tekilliği | ardışık + eşzamanlı | WO-YYYY-NNNN, +1 artış, 5-paralel 5 farklı | PASS | I2 |
| T05-A4 | Kabul: talep→İE akışı E2E | uçtan uca | 3 seri E2E testi (oluşturma→triyaj→dönüşüm→planla→ata→teknisyen yürütür→kapat) | PASS | E1-E3 |
| T05-C1 | Çift gönderim/yeniden oynatma: aynı teknisyene çift atama | idempotent (yeni kayıt yok) | assignments=1 | PASS | I2 |
| T05-C2 | Bayat sürüm: paralel düzenleme | 409 VERSION_CONFLICT | PATCH + geçiş olmak üzere iki yüzeyde | PASS | I2 |
| T05-C3 | Boş/uzun veri: boş liste durumu, 200 karakter konu kabul/201 reddi, 2000 karakter not sınırı | sınır değerleri | doğrulandı | PASS | I1+U4 |
| T05-C4 | Ağ hatası/denetimi: fetch yanıt yok → "Ağa ulaşılamadı"; sözleşme dışı gövde → önceden hata (fetch çağrılmaz) | istemci savunması | api-client testli; UI'da Alert | PASS | api-client 21/21 |
| T05-B1 | Storybook derleme + etkileşim (+Timeline stories: yaşam döngüsü sırası, kronolojik, iptal/bekleme tonları, boş durum) | tümü | 55/55 (13 dosya) | PASS | §6 |
| T05-E1 | E2E yaşam döngüsü (seri): talep oluştur→triyaj→dönüşüm→planla→ata | uçtan uca + yönlendirme | PASS | PASS | `service.spec.ts` |
| T05-E2 | E2E teknisyen: kendi işini kabul/yol/varış/başla/tamamla; KAPAT düğmesi yok (sunucu da reddeder); not ekleme | rol sınırı + atama | PASS | PASS | aynı |
| T05-E3 | E2E yönetici: kapatma + yeniden yüklemede kalıcılık + zaman çizelgesi (geçiş açıklamaları) + terminalde eylem yok | kalıcılık | PASS | PASS | aynı |
| T05-E4 | E2E iptal: neden kodu + not → "Talep iptal edildi"; eylem kalkar | iptal akışı | PASS | PASS | aynı |
| T05-E5 | E2E rol sınırı: teknisyende talep nav gizli + doğrudan URL → yetki uyarısı | sunucu↔UI tutarlı | PASS | PASS | aynı |
| T05-E6 | E2E mobil 390px: liste + detay tek sütun; arama/düğme ≥36px | duyarlılık | PASS | PASS | aynı |
| T05-E7 | E2E önceki akışlar (giriş/rol/signup/davet/CRM/kabuk/durum) | regresyon yok | **34/34** toplam | PASS | playwright |
| T05-M1 | Mobil: jest/RNTL/Maestro paketi Faz 07'de kurulur; bu faz mobil uygulamayı değiştirmedi — tip denetimi dumanı | typecheck PASS | PASS | PASS | turbo |
| T05-P1 | Performans: liste uçları sayfalamalı (take/skip + count), `pageSize ≤ 100`, detay 1 sorgu + include'lar; yeni indeksler `(tenantId, status, createdAt)`, `(tenantId, assignedToId, scheduledStart)`; sayaç atomik (kilit yok) | API kapasite değişikliği k6 gerektirmez | doğrulandı | PASS* | şema |
| T05-X1 | Güvenlik: loglarda gizli değer yok (tarama — parola/token/imza yazılmıyor; not gövdesi olay meta'sına girmez); klavye/odak (SideDrawer odak tuzağı + ESC; Timeline ol semantiği); kontrast token'lardan | a11y + gizlilik | Storybook a11y eklentisi 55/55; E2E klavye (ESC) | PASS | §6 |
| T05-X2 | Bağımlılık taraması (`pnpm audit --prod`) | kritik yok | 4 orta + 1 yüksek — hepsi GELİŞTİRME-ARAÇ zinciri (glob/minimatch/deepmerge-ts; storybook/vitest yapılandırması), üretim çalışma zamanı bağımlılığı değil | BİLİNEN SINIR | §8 |

*Kapsam dışı (faz gereği): Firefox/WebKit dumanı (Faz 16), k6 (API kapasite bandı değişmedi), SAST (Faz 15), mobil Jest/Maestro (Faz 07), SLA takvim duyarlılığı (Faz 13).

## 6. Çalıştırılan komutlar ve tam sonuçları

```text
pnpm format:check                       → All matched files use Prettier code style!
pnpm lint                               → 0 hata
pnpm typecheck                          → Tasks: 14 successful, 14 total
pnpm build                              → Tasks: 8 successful, 8 total
pnpm test                               → api 121, ui-web 91, api-client 21, shared 18, worker 9,
                                           web 10, contracts 7, design-tokens 3 → 280/280
pnpm test:integration                   → 7 dosya 109/109 (intake 15 + iş emirleri 22 + crm 29 +
                                           auth 15 + izolasyon 24 + rate-limit 1 + health 3)
pnpm --filter @teknikflow/ui-web test:storybook → 13 dosya 55/55
pnpm db:validate                        → The schema is valid
pnpm db:migrate                         → phase05_service_intake_work_orders uygulandı + uygulama rolü tazelendi
DATABASE_URL=$MIGRATION_DATABASE_URL prisma migrate status → "Database schema is up to date!"
pnpm db:seed                            → demo servis akışı idempotent (6 kategori, 4 SLA, 3 talep, 8 İE, sayaç senkron)
pnpm --filter @teknikflow/mobile typecheck → PASS
pnpm --filter @teknikflow/web test:e2e  → 34 passed (üretim derlemesi; yaşam döngüsü+iptal+rol+mobil
                                           + önceki giriş/CRM/kabuk/durum akışları)
# Canlı kanıtlar (curl/API, owner oturumuyla):
POST /api/v1/service-requests           → 201 (status=NEW, slaDueAt=createdAt+1440dk)
PUT  /api/v1/service-requests/sla-policies (URGENT 120) → 200; sonraki URGENT talep +120dk
POST /api/v1/service-requests/{id}/convert → 201 (WO-2026-000N DRAFT; talep CONVERTED)
POST /api/v1/work-orders/{id}/transition ×8 → 201 zinciri (PLANNED→…→CLOSED)
POST …/transition (CLOSED→IN_PROGRESS)  → 409 INVALID_TRANSITION
GET  /api/v1/work-orders (teknisyen)    → yalnız atanmış 4 kayıt; /service-requests → 403 FORBIDDEN
GET  /api/v1/service-requests/{id}/events → JSON-yol filtreli etkinlik listesi
# RLS: 8 yeni tabloda FORCE; withTenant(B) bağlamında A'nın İE/talep satırları 0
```

## 7. Çözülen hatalar (geliştirme sırasında)

1. **E2E paralel dağıtım RUN uyuşmazlığı (Kritik):** `fullyParallel` zincir testleri farklı worker'lara dağıttı → her worker kendi `RUN` değeri üretti, testler birbirinin verisini aradı ("0 iş emri"). Yaşam döngüsü `mode: 'serial'` ile tek worker'a bağlandı + hücre bazlı satır seçimi.
2. **Çift atama idempotentliği durum doğrulamasından önce olmalı (Yüksek):** ASSIGNED durumunda aynı teknisyene yeniden atama, geçiş kuralı doğrulamasında `ASSIGNED→ASSIGNED` kendine geçiş olarak 409 alıyordu → idempotent kontrol kural tablosundan ÖNCE çalışır (kayıt üretilmez, 201 döner).
3. **Atanabilirlik kuralı fazla gevşekti (Yüksek):** `view_all` taşıyan finans rolü atanabiliyordu → kural `complete | view_assigned` ile sıkılaştırıldı (görür-ama-yürütmeyen atanamaz; entegrasyon testi finance 400 ile kanıtlar).
4. **Yeniden açma testi geçiş zincirini atlıyordu (Orta):** ACCEPTED→IN_PROGRESS atlama izinli değil — test zincire EN_ROUTE/ON_SITE eklendi (test hatası, ürün davranışı doğru).
5. **supertest zincir hatası (Orta):** `request(app).set()` — SuperTestImpl `.set` taşımaz; set `.get()/.post()` Test'inden sonra gelmeli → yardımcı get/post/patch/put fabrikasına dönüştürüldü.
6. **FormField render-prop imzası (Orta):** children `ReactNode` değil `(ids)=>ReactNode` — tüm yeni formlar `{...ids}` bağlamayla dönüştürüldü (id/aria-describedby otomatik).
7. **Alert/ConfirmDialog API uyumu (Düşük):** Alert `title` zorunlu; ConfirmDialog children kabul etmiyor → neden kodlu iptal formları SideDrawer'a taşındı (odak tuzağı + ESC korunur).
8. **Tohum talep olayları requestId taşımıyordu (Düşük):** talep detay etkinlik geçmişi boş görünüyordu → olay meta'sına requestId eklendi + mevcut demo veriye tek seferlik yama.

## 8. Kalan kusurlar / sınırlamalar

- **Kritik/Yüksek: yok.**
- Orta: GitHub Actions bu ortamda koşulamıyor — CI dosyası devralınıyor (db:migrate → setup-role zinciri 8 yeni tabloyu da kapsar; ilk push'ta kanıtlanacak).
- Düşük: `pnpm audit --prod` → 4 orta + 1 yüksek; tümü geliştirme-araç zinciri (glob/minimatch/deepmerge-ts — storybook/vitest); Faz 15'te bağımlılık tazeleme kapsamında ele alınacak. Üretim çalışma zamanı paketlerinde açık yok.
- Düşük: SLA takvim duyarlı değil (iş günü/saat); politikalar dakika bazlı — Faz 13 notu.
- Düşük: doğrudan İE oluşturma çekmecesinde ekipman/lokasyon seçimi yok (talep dönüşümü taşır; API tam destekler) — Faz 06 dispatch tahtasıyla zenginleşecek.
- Düşük: `crm_events` JSON-yol filtresi (`requestId`) talep etkinlik geçmişi için yeterli; ayrı sütun talep hacmi gerekirse eklenir.
- Bilgi: müşteri portalı talep formu (PORTAL kaynağı) Faz 12; mobil teknisyen yürütmesi Faz 07-08 (aynı sözleşmeler).

## 9. Faz kapısı kararı

TEST-05 kabul kriterlerinin tümü karşılandı: **tüm izinli geçişler** işletildi (24/24 — birim 12×12 tam matris + entegrasyon zincirleri + E2E); **geçersiz geçişler reddedildi** (409 INVALID_TRANSITION — 120 kombinasyon birimde + atlama/geri sarma entegrasyonda); **iş emri numarası tekilliği** kanıtlandı (ardışık + 5-paralel atomik sayaç); **talep→iş emri akışı E2E geçti** (3 seri test: oluştur→triyaj→dönüşüm→planla→ata→yürüt→kapat + kalıcılık). Kritik/yüksek açık yok. **Faz 05 kapısı: PASS.** Sonraki faz: 06 — Sevk tahtası, takım kapasitesi ve planlama (bağımlılıklar hazır: iş emri planlama alanları, atamalar, teknisyen görünürlüğü, `assignable-users` ucu).
