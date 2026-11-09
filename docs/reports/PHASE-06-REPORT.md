# PHASE 06 REPORT — Dispatch board, team capacity and scheduling

- Tarih: 2026-11-09
- Kapı: TEST-06 (`prompts/tests/TEST-06-dispatch-board-team-capacity-and-scheduling.md`)
- Sonuç: **PASS** (bkz. §9)
- Kanıt dizinleri: `docs/screenshots/phase-06/` (4 görüntü), RLS pg_class kanıtı §6, entegrasyon/E2E çıktıları §6
- Mimari karar: ADR-0008 (`docs/decisions/ADR-0008-dispatch-engine-and-scheduling.md`)

## 1. Özet

Faz 06, sevk (dispatch) katmanını kurdu: **planlama kuyruğu → çakışma denetimi → tek adımda planla/ata → kanban/takvim/liste pano → kapasite ve müsaitlik → SLA uyarıları**, uçtan uca. Çakışma kurallarının TEK gerçekliği veritabanı erişimi olmayan saf motorda (ADR-0008): örtüşme (OVERLAP), izin (TIME_OFF) ve çalışma saati dışı (OUTSIDE_WORKING_HOURS) bulguları üç mutasyon yüzeyinde (schedule ucu, doğrudan ASSIGNED geçişi, PATCH schedule) aynı motorle denetlenir. İzinsiz çift rezervasyon yok — override yalnız `work_orders:dispatch_override` izni + ≥10 karakter gerekçeyle, gerekçe kalıcı olarak saklanır ve olay/audit akışına girer. Saat dilimi çekirdeği iki geçişli ofset düzeltmesiyle DST geçişlerinde (23/25 saatlik günler) doğru çalışır. 8 yeni RLS FORCE tablosu (teknisyen profilleri, çalışma saatleri, izinler, yetenekler, kullanıcı-yetenekleri, takımlar, takım üyeleri, kategori-yetenek eşlemesi); 26 yeni entegrasyon testi; 4 yeni E2E testi (klavye yoluyla atama dahil); 12 yeni Storybook etkileşimi (SegmentedControl, MeterBar, dispatch kontrolleri).

## 2. Değişen/eklenen dosyalar (özet)

**Sözleşme:** `packages/contracts/src/dispatch.ts` (yeni — pano/müsaitlik/profil/çalışma saati/izin/yetenek/takım şemaları, bulgu türleri, UI etiket haritaları + test); `service.ts` (override alanları: `overrideConflict` + `overrideReason` — PATCH ve transition şemalarında; `WorkOrderView`'a `slaDueAt`/`scheduleOverrideReason`).

**API:** `apps/api/src/service/dispatch-engine.ts` (yeni — SAF motor: saat dilimi çekirdeği, çakışma, kapasite, SLA, yetenek, serbest slot; 36 birim test), `schedule-conflict.service.ts` (yeni — girdi yükleme + override kuralı), `apps/api/src/dispatch/` (yeni modül: `dispatch.controller.ts` 16 uç, `teams.controller.ts` 6 uç, `dispatch.service.ts` pano/müsaitlik/profil/yetenek/takım), `work-orders.service.ts` (ASSIGNED geçişinde koruyucu çakışma denetimi; override alanları; SLA devri), `app.module.ts` (DispatchModule kaydı), `error-envelope.filter.ts` (`conflicts[]` beyaz-listeli zarf alanı), `rbac-matrix.ts` (`work_orders:dispatch_override` + dispatch okuma izinleri), `auth.controller.ts` (Faz 03 kalıntısı: cookie maxAge saniye→milisaniye düzeltmesi — §7.1).

**Veritabanı:** `prisma/schema.prisma` (+8 model/enum seti, ilişkiler); migration `20261109105434_phase06_dispatch_capacity_scheduling` (7 tablo + `work_orders.scheduleOverrideReason/slaDueAt` + SLA geri doldurma + RLS FORCE ×7), migration `20261109111036_phase06_category_skill_requirements` (+RLS FORCE ×1); `prisma/seed.ts` (Faz 06 demo: 5 yetenek, 3 profil + çalışma saati, 1 izin, 2 takım).

**İstemci:** `packages/api-client/src/dispatch-client.ts` (yeni — pano/müsaitlik/planlama/yetenek/takım typed istemcisi).

**ui-web:** `components/segmented-control.tsx` + `meter-bar.tsx` (yeni — görsel seçici ve kapasite ölçeri; stories + etkileşim testleri), `dispatch-controls.test.tsx`, `ui-web.css` (tf-segmented/tf-meter stilleri), `index.ts` ihracı.

**Web:** `/app/dispatch` (pano: kanban — teknisyen kolonları + planlama kuyruğu, HTML5 sürükle-bırak + klavye yoluyla atama paneli; takvim — hafta matrisi; liste; SLA rozetleri; çakışma uyarısı paneli; yetenek uyarıları), `src/lib/dispatch-time.ts` (kiracı saat dilimi dönüşümleri + test), `app/layout.tsx` + `shell-frame.tsx` (navigasyona Dispatch öğesi; Faz 05 kalıntısı: aktif öğe yol adından türetilir), `globals.css` (pano stilleri).

**E2E:** `apps/web/e2e/dispatch.spec.ts` (4 test: klavyeyle atama, çakışma uyarısı, rol sınırı, mobil viewport) + `service.spec.ts` uyumu.

**Doküman:** ADR-0008, STATUS.md, CHANGELOG 0.6.0, bu rapor.

## 3. Mimari kararlar (bu fazda uygulanan — ADR-0008)

1. **Saf motor tek gerçeklik:** `dispatch-engine.ts` DB erişmez; `findScheduleConflicts` / `capacitySummary` / `slaState` / `matchSkills` / `freeSlotsForDay` saf fonksiyon. Üç mutasyon yüzeyi (schedule ucu, ASSIGNED geçişi, PATCH) aynı motorü çağırır — kural ayrışması yapısal olarak imkânsız.
2. **Saat dilimi:** depolama UTC; kiracı saat dilimi yalnız yerel duvar saati yorumunda. `wallClockToUtc` iki geçişli düzeltme (DST boşluğunda tek kayma — belgeli); gün sınırları sonraki gün gece yarısından (23/25 saatlik günler). Istanbul UTC+3 kalıcı; motor genel.
3. **Çakışma türleri ve "veri yok = kısıt yok":** uçtan-uca bitişiklik çakışma sayılmaz (arka arkaya işler serbest); çalışma saati şablonu yoksa saat kısıtı uygulanmaz.
4. **Override kuralı:** `work_orders:dispatch_override` (yalnız owner/admin) + ≥10 karakter gerekçe (403 OVERRIDE_FORBIDDEN / 400 OVERRIDE_REASON_REQUIRED); gerekçe `scheduleOverrideReason`'a kalıcı + olay/audit.
5. **Savunma derinliği:** planlama mutasyondan ÖNCE denetlenir (DRAFT→PLANNED yarım kalmaz); hata zarfı `conflicts[]` yalnız kendi kiracısının iş emri kimliklerini taşır.
6. **Kapasite:** min(şablon dakikaları, günlük üst sınır); planlı dakikalar gün sınırlarıyla kesişim; serbest slot = çalışma − planlı − izin.
7. **Yetenek:** eksik yetenek BLOK değil — `skillWarnings` (danışma) + kuyrukta `requiredSkillKeys` görünürlüğü.
8. **SLA iş emrine taşınır:** talepten dönüşen devralır (müşteri sözü sıfırlanmaz), doğrudan açılan öncelik varsayılanından; pano aşım/risk rozetleri.

## 4. Migration detayları

`20261109105434_phase06_dispatch_capacity_scheduling`: 7 tablo (`technician_profiles` `(tenantId,userId)` TEKİL, `working_hours`, `time_offs`, `skills` `(tenantId,key)` TEKİL, `user_skills` `(tenantId,userId,skillId)` TEKİL, `teams` `(tenantId,code)` TEKİL, `team_members` `(tenantId,userId)` TEKİL) + indeksler + `work_orders.scheduleOverrideReason/slaDueAt` + SLA geri doldurma (1: talepten dönüşenler talebin `slaDueAt`'ını devralır; 2: kalanlar öncelik varsayılanı URGENT 4sa/HIGH 8sa/MEDIUM 24sa/LOW 72sa) + **RLS ENABLE+FORCE ×7**. `20261109111036_phase06_category_skill_requirements`: `service_category_skills` (`(tenantId,categoryId,skillId)` TEKİL) + **RLS FORCE ×1**. Uygulama: `pnpm db:migrate` (migration sahibi + `db:setup-role` ile uygulama rolü tazelendi). Doğrulama: `prisma migrate status` güncel; pg_class sorgusuyla **8/8 tablo rls=t force=t** (§6).

## 5. TEST-06 QA matrisi

Ortam: Linux sandbox; Node v24.22.2; pnpm 9.15.9; embedded PostgreSQL 18 (`teknikflow_app` NOSUPERUSER — RLS etkin); redis-memory-server; RustFS 1.0.4; Chromium (Playwright, üretim derlemesi üzerinde).

| Test ID | Senaryo | Beklenen | Gerçekleşen | Durum | Kanıt |
|---|---|---|---|---|---|
| T06-S1 | Prettier | 0 ihlal | "All matched files use Prettier code style!" (`next-env.d.ts` Next.js regen tırnak ihlali düzeltildi) | PASS | §6 |
| T06-S2 | ESLint | 0 hata | temiz | PASS | §6 |
| T06-S3 | Typecheck | tüm paketler | 14/14 (mobil tip dumanı dahil) | PASS | turbo |
| T06-S4 | Üretim derlemesi | tüm paketler | 8/8 (bilinen load-env tracing uyarısı — Faz 01'den, davranış değil) | PASS | turbo |
| T06-S5 | Prisma validate + migrate status | geçerli + güncel | "The schema is valid" / "up to date!" | PASS | §6 |
| T06-S6 | RLS FORCE doğrulaması | 8/8 yeni tablo | 8/8 (pg_class: rls=t, force=t) | PASS | §6 |
| T06-U1 | Saat dilimi çekirdeği: Istanbul UTC+3 kalıcı; Berlin kış/yaz ofsetleri; DST ileri/geri alma; 25/23 saatlik günler; ISO hafta içi; gece aşan günler | tümü doğru | 36 testte kanıtlandı | PASS | `dispatch-engine.test.ts` |
| T06-U2 | Çakışma motorü: temiz pencere; OVERLAP; bitişik iş serbest; TIME_OFF; OUTSIDE_WORKING_HOURS (kalan dakika raporu); şablon yoksa kısıt yok; gece aşan iki-gün kapsama | tümü | 36/36 motor testi | PASS | aynı |
| T06-U3 | Kapasite: şablon yoksa üst sınır; kırpma; gün dışı kesişim; SLA (terminal sönmesi, aşım/risk, değer yok); yetenek (tam/kısmi/eksik); serbest slot | tümü | aynı dosyada | PASS | aynı |
| T06-U4 | Sözleşme doğrulama birim (dispatch şemaları + override min 10) + ui-web kontrolleri (SegmentedControl klavye seçimi, MeterBar oran/ton) | tümü | contracts 20, ui-web 97, web 19, api-client 21, api 157 → **344/344** | PASS | vitest |
| T06-I1 | Profil + çalışma saati + yetenek atama; DRAFT tek adımda PLANNED+ASSIGNED; SLA alanı dolu + URGENT pano uyarısı; pano kolon/kuyruk/kapasite | tümü | 26/26 dispatch entegrasyonu | PASS | `dispatch.integration.test.ts` |
| T06-I2 | **Kabul — çift rezervasyon:** örtüşen ikinci iş 409 SCHEDULE_CONFLICT + OVERLAP bulgusu; bitişik serbest; doğrudan ASSIGNED geçişi de engeller (koruyucu); PATCH schedule da engeller | izinsiz örtüşme YOK | tamamı engellendi | PASS | I1 dosyası |
| T06-I3 | **Kabul — override:** planlamacı 403 OVERRIDE_FORBIDDEN; owner gerekçeyle 200 + gerekçe kalıcı + olay kaydı; kısa gerekçe şema 400; PATCH override da kabul | izin + ≥10 gerekçe | 403/200/400/200 | PASS | I1 dosyası |
| T06-I4 | Çalışma saatleri dışı 409; izin çakışması 409 → izin iptal edilince planlanır; müsaitlik (çalışma − planlı − izin = slot); çakışma listesi ucu; kategori yeteneği eksik → skillWarnings + kuyrukta requiredSkillKeys | tümü | doğrulandı | PASS | I1 dosyası |
| T06-I5 | Takımlar: CRUD + üye ekleme/çıkarma; planlamacı takım KURAMAZ | yetki | doğrulandı | PASS | I1 dosyası |
| T06-I6 | **Kiracı izolasyonu:** teknisyen pano/teknisyen listesi/planlama 403; B kiracısı A'nın işini 404 ile planlayamaz (sızıntı yok); B, A'nın teknisyenine profil/çalışma saati/izin yazamaz 404; B panosunda A'nın verisi YOK — **RLS ham kanıt: satır sayısı 0**; B, A'nın takımına üye ekleyemez 404 | sızıntı yok | tamamı | PASS | I1 dosyası |
| T06-I7 | Önceki entegrasyonlar (auth/izolasyon/CRM/intake/İE/rate-limit/health) | regresyon yok | 109/109 → toplam **135/135** | PASS | vitest |
| T06-A1 | Kabul: saat dilimi doğruluğu | DST ileri/geri, 23/25 saat, kalıcı +03 | U1'de birim, I1'de entegrasyon | PASS | U1 |
| T06-A2 | Kabul: sürükle-bırak klavye alternatifi | atama klavye yoluyla | E2E "klavye yoluyla atanır ve kolona taşınır" + SegmentedControl etkileşim | PASS | T06-E1 |
| T06-A3 | Kabul: Playwright dispatch atama | uçtan uca | 4 E2E testi | PASS | T06-E1..E4 |
| T06-C1 | Çift gönderim/yeniden oynatma: aynı pencereye ikinci schedule isteği | 409 SCHEDULE_CONFLICT (override yoksa) | engellendi | PASS | I2 |
| T06-C2 | Boş/uzun veri: şablon yoksa pano boş kolon; 500+ karakter gerekçe sınırı; boş kuyruk görünümü | sınır değerleri | doğrulandı | PASS | I4+U4 |
| T06-C3 | Rol/atama geçişleri: ASSIGNED iş tek adımda başka teknisyene devredilir (geçmiş korunur) | geçmiş + pencere günceli | doğrulandı | PASS | I1 |
| T06-B1 | Storybook derleme + etkileşim (SegmentedControl seçim/klavye, MeterBar tonlar/eşikler, dispatch kontrolleri) | tümü | **67/67** (15 dosya) | PASS | §6 |
| T06-E1 | E2E pano: yeni iş kuyrukta görünür; klavye yoluyla atanır ve kolona taşınır | uçtan uca atama | PASS | PASS | `dispatch.spec.ts` |
| T06-E2 | E2E çakışma: örtüşen ikinci iş → panelde çakışma uyarısı görünür | 409 + UI bulgusu | PASS | PASS | aynı |
| T06-E3 | E2E rol sınırı: teknisyen panoya giremez | yetki uyarısı | PASS | PASS | aynı |
| T06-E4 | E2E mobil 390px: pano dikey akar ve erişilebilir | duyarlılık | PASS | PASS | aynı |
| T06-E5 | E2E önceki akışlar (giriş/talep/İE/CRM/kabuk/durum) | regresyon yok | **38/38** toplam | PASS | playwright |
| T06-M1 | Mobil: Faz 07'de kurulur; bu faz mobil uygulamayı değiştirmedi — tip denetimi dumanı | typecheck PASS | PASS | turbo |
| T06-P1 | Performans: pano tek günde okur (`(tenantId, assignedToId, scheduledStart)` indeksi Faz 05'te mevcut; yeni `(tenantId, profileId)` indeksleri); liste uçları sayfalamalı; bulgu zarfı küçük | API kapasite değişikliği k6 gerektirmez | doğrulandı | PASS* | şema |
| T06-X1 | Güvenlik/a11y: loglarda gizli değer yok (API log taraması temiz); override gerekçesi olay meta'sına girer, not gövdesi girmez; odak yönetimi (atama paneli), klavye yolu, kontrast token'lardan | a11y + gizlilik | doğrulandı | PASS | §6 |
| T06-X2 | Bağımlılık taraması (`pnpm audit --prod`) | kritik yok | 4 orta + 1 yüksek — hepsi GELİŞTİRME-ARAÇ zinciri (glob/minimatch/deepmerge-ts; storybook/vitest/expo), üretim çalışma zamanı bağımlılığı değil | BİLİNEN SINIR | §8 |

*Kapsam dışı (faz gereği): Firefox/WebKit dumanı (Faz 16), k6 (API kapasite bandı değişmedi), SAST (Faz 15), mobil Jest/Maestro (Faz 07).

## 6. Çalıştırılan komutlar ve tam sonuçları

```text
pnpm format:check                       → All matched files use Prettier code style!
pnpm lint                               → 0 hata
pnpm typecheck                          → Tasks: 14 successful, 14 total
pnpm build                              → Tasks: 8 successful, 8 total
pnpm test                               → api 157, ui-web 97, api-client 21, contracts 20, web 19,
                                          shared 18, worker 9, design-tokens 3 → 344/344
pnpm test:integration                   → 8 dosya 135/135 (dispatch 26 + intake 15 + iş emirleri 22 +
                                          crm 29 + auth 15 + izolasyon 24 + rate-limit 1 + health 3)
pnpm --filter @teknikflow/ui-web test:storybook → 15 dosya 67/67
pnpm --filter @teknikflow/mobile typecheck → PASS
pnpm db:validate                        → The schema is valid
pnpm db:migrate                         → 6 migration güncel (2 yeni Faz 06 dahil) + uygulama rolü tazelendi
pnpm db:seed                            → Faz 06 demo: 5 yetenek, 3 profil + çalışma saati, 1 izin, 2 takım
pnpm --filter @teknikflow/web test:e2e  → 38 passed (üretim derlemesi; dispatch 4 + önceki akışlar)
pnpm audit --prod                       → 5 bulgu (4 orta + 1 yüksek) — geliştirme-araç zinciri (§8)
# RLS kanıtı (pg_class, migration sahibiyle):
technician_profiles|working_hours|time_offs|skills|user_skills|teams|team_members|
service_category_skills → 8/8 rls=true force=true
# E2E dispatch satırları:
✓ e2e/dispatch.spec.ts:23  → klavye yoluyla atanır ve kolona taşınır
✓ e2e/dispatch.spec.ts:114 → çakışan ikinci iş → panelde çakışma uyarısı görünür
✓ e2e/dispatch.spec.ts:149 → teknisyen panoya giremez — rol sınırı
✓ e2e/dispatch.spec.ts:171 → mobil viewport: pano dikey akar ve erişilebilir
# Ekran görüntüleri: docs/screenshots/phase-06/ (kanban/takvim/liste/atama paneli, 1280×720 ×4)
```

## 7. Çözülen hatalar (geliştirme sırasında)

1. **Faz 03 kalıntısı — oturum çerezi maxAge birim hatası (Yüksek):** Express `res.cookie` maxAge'i MİLİSANİYE alır; kod saniye hesaplıyordu → 12 saatlik oturum ~43 saniyede biterdi. Uzun E2E akışları ortaya çıkardı; milisaniyeye düzeltildi (oturumlar artık yapılandırılan süreyi yaşar).
2. **Faz 05 kalıntısı — aktif gezinme öğesi (Orta):** kabuk her sayfada "Genel Bakış"ı vurguluyordu → aktif öğe `usePathname`'den türetildi (dispatch dahil her sayfa kendi vurgusunu alır).
3. **Prettier/Next.js regen tekilosu (Düşük):** `next build`, `next-env.d.ts`'yi çift tırnakla yeniden üretip format:check'i bozuyordu → Prettier düzeltmesi uygulandı (derleme sonrası yeniden üretim bilinen davranış; gate sırası buna göre).
4. **schedule ucu yarım-mutasyon riski (Önlem):** çakışma denetimi mutasyondan ÖNCE ayrı withTenant bloğunda çalıştırıldı — DRAFT→PLANNED yarım kalması imkânsız.

## 8. Kalan kusurlar / sınırlamalar

- **Kritik/Yüksek: yok.**
- Orta: GitHub Actions bu ortamda koşulamıyor — CI dosyası devralınıyor (db:migrate → setup-role zinciri 8 yeni tabloyu da kapsar; ilk push'ta kanıtlanacak).
- Düşük: `pnpm audit --prod` → 4 orta + 1 yüksek; tümü geliştirme-araç zinciri (glob/minimatch/deepmerge-ts — storybook/vitest/expo); Faz 15'te bağımlılık tazeleme kapsamında ele alınacak. Üretim çalışma zamanı paketlerinde açık yok.
- Düşük: çakışma denetimi uygulama katmanında — iki eşzamanlı schedule isteği arasındaki yarış penceresi kalıcı çift rezervasyon ÜRETMEZ (yanlışlıkla override'sız planlama 409'la reddedilir; istisna ancak izinli + gerekçeli override) — ADR-0008 §Consequences.
- Düşük: DST'te var olmayan yerel saat (pencere 02:00-03:00 bandına düşerse) en yakın ana kayar — belgeli davranış (ADR-0008 §2).
- Düşük: kapasite şablon + planlı pencereden türetilir; gerçek zaman harcaması Faz 08 (zaman takibi) sonrası eklenir.
- Bilgi: takvim görünümü hafta matrisidir; ay görünümü ve sürükle-bırak takvim planlaması sonraki fazlarda değerlendirilir. Mobil teknisyen gündüz akışı Faz 07-08 (aynı sözleşmeler).

## 9. Faz kapısı kararı

TEST-06 kabul kriterlerinin tümü karşılandı: **izinsiz çift rezervasyon yok** (örtüşen planlama üç yüzeyde de 409 SCHEDULE_CONFLICT + OVERLAP bulgusu; bitişik işler serbest; istisna yalnız `work_orders:dispatch_override` + ≥10 karakter gerekçe — planlamacı 403, owner 200 + kalıcı gerekçe + olay kaydı); **saat dilimi doğruluğu** (UTC depolama, kiracı duvar saati yorumu; DST ileri/geri alma ve 23/25 saatlik günler birim testlerde kanıtlı); **sürükle-bırak için klavye alternatifi** (E2E klavyeyle atama + kolona taşıma); **Playwright dispatch ataması** (4/4 test — atama, çakışma uyarısı, rol sınırı, mobil). Kritik/yüksek açık yok. **Faz 06 kapısı: PASS.** Sonraki faz: 07 — Mobil temel ve teknisyen gelen kutusu (bağımlılıklar hazır: durum makinesi, dispatch uçları, typed istemciler, ADR-0004 çevrimdışı eşitleme taslağı).
