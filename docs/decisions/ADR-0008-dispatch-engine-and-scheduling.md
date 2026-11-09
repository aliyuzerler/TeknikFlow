# ADR-0008: Dispatch Planlama Motoru, Kapasite ve Zaman Dilimi Politikası
- Status: Accepted (Phase 06 uygulaması)
- Date: 2026-11-09

## Context
Faz 06, sevk tahtasını (kanban/takvim/liste), teknisyen müsaitliğini (çalışma saatleri şablonu + izinler), çakışma denetimini, kapasite göstergesini ve yetenek eşleştirmesini kurar. Kabul ölçütleri: **izinsiz çift rezervasyon yok** (override ancak `work_orders:dispatch_override` izni + gerekçeyle), **saat dilimi doğruluğu**, **sürükle-bırak için klavye alternatifi**. Zorluklar: (1) çakışma kuralları hem `POST /dispatch/schedule/:id` hem doğrudan `ASSIGNED` geçişi hem `PATCH /work-orders/:id` yüzeylerinde korunmalı — üç yüzeyde ayrı kural yazmak kaçınılmaz olarak ayrışır; (2) çalışma saatleri kiracı yerel saatidir ama depolama UTC'dir — DST geçişleri (23/25 saatlik günler) yanlış pencere üretebilir; (3) ADR-0007'deki durum makinesi DRAFT→PLANNED→ASSIGNED geçişlerini tanımlar — dispatch bu makinenin ÜSTÜNE kurulur, onu tekrar etmez.

## Decision
1. **Tek gerçeklik saf motorda:** `apps/api/src/service/dispatch-engine.ts` — veritabanı erişimi YOK; çakışma tespiti (`findScheduleConflicts`: OVERLAP / TIME_OFF / OUTSIDE_WORKING_HOURS), kapasite (`capacitySummary`), SLA durumu (`slaState`), yetenek eşleşmesi (`matchSkills`) ve serbest slot (`freeSlotsForDay`) saf fonksiyonlar. Servis katmanı (`schedule-conflicts.service.ts`) girdileri yükler; üç mutasyon yüzeyi de aynı motoru çağırır. Birim testler motoru doğrudan, entegrasyon testleri uçtan uca kanıtlar.
2. **Saat dilimi politikası:** Depolama UTC; kiracı saat dilimi yalnız "yerel duvar saati" yorumunda (çalışma saatleri, pano günü). `wallClockToUtc` iki geçişli ofset düzeltmesiyle DST'te doğru anı üretir; var olmayan yerel saat (ileri alma boşluğu) en yakın çözülebilir ana oturur. Gün sınırları SONRAKİ günün yerel gece yarısından türetilir → 23/25 saatlik günler doğru (Berlin 2026 testleriyle kanıtlı). Europe/Istanbul kalıcı UTC+3 (DST yok); motor geneldir — kiracı saat dilimi yapılandırılabilirdir.
3. **Çakışma türleri:** OVERLAP = aynı teknisyenin terminal-olmayan işiyle örtüşme (uçtan-uca bitişiklik çakışma DEĞİL — arka arkaya işler serbest); TIME_OFF = aktif izin örtüşmesi; OUTSIDE_WORKING_HOURS = çalışma şablonu VARSA kapsanmayan dakika. **Şablon yoksa saat kısıtı uygulanmaz** ("veri yok = kısıt yok") — teknisyen temiz başlar, yönetici şablonu tanımladıkça kurallar devreye girer.
4. **Override kuralı:** Çakışmayla planlama `work_orders:dispatch_override` izni VE ≥10 karakter gerekçe ister (403 OVERRIDE_FORBIDDEN / 400 OVERRIDE_REASON_REQUIRED). Gerekçe `work_orders.scheduleOverrideReason`'a kalıcı yazılır ve olay/audit akışına girer. Planlamacı (dispatcher) override edemez — yalnız owner/admin (RBAC matrisi).
5. **Savunma derinliği:** Çakışma denetimi üç yüzeyde: (a) schedule ucu mutasyondan ÖNCE 409 döner (DRAFT→PLANNED yarım kalmaz); (b) doğrudan `ASSIGNED` geçişinde koruyucu denetim; (c) PATCH schedule'da koruyucu denetim. Hata zarfı (`SCHEDULE_CONFLICT`) bulguları `conflicts[]` ile taşır — yalnız beyaz listeli alanlar (kendi kiracısının iş emri kimlikleri; sızıntı yok).
6. **Kapasite modeli:** Günlük kapasite = min(şablon dakikaları, `dailyCapacityMinutes`); planlı dakikalar gün sınırlarıyla kesişim; kullanım %. Serbest slotlar = çalışma pencereleri − planlı işler − izinler (`/dispatch/technicians/:id/availability`).
7. **Yetenek eşleştirme:** Kiracı yetenek kataloğu (`skills`), teknisyen yetenekleri (`user_skills` + seviye), kategori gereksinimleri (`service_category_skills`). Eksik yetenek engel DEĞİL — `skillWarnings` (danışma) döner; pano kuyruğu `requiredSkillKeys` gösterir; atama `score` ile bilgilendirir (yanlış-atanma önlemi insan kararı, otomatik blok değil).
8. **SLA iş emrine taşınır:** Migration `work_orders.slaDueAt`'ı geri doldurur — talepten dönüşenler talebin değerini DEVRALIR (müşteri sözü dönüşümle sıfırlanmaz), doğrudan açılanlar öncelik varsayılanından hesaplanır. Pano `slaState` ile aşım/risk rozetleri üretir.
9. **Pano UX:** Kanban (teknisyen kolonları + planlama kuyruğu, HTML5 sürükle-bırak), takvim (hafta matrisi), liste. Sürükle-bırakın tam klavye alternatifi vardır (atama paneli + klavye yolu — Playwright kanıtlı); teknisyen rolü panoya giremez (403 — sunucu ve UI tutarlı).

## Alternatives considered
- Kural setini veritabanında (trigger/exclusion constraint): b-tree aralıklarının `tstzrange && EXCLUDE` çözümü çakışmayı DB'de kanıtlar ama izin şablonu/izin/çalışma saati birleşimi çok tablolu — trigger'da tekrar uygulama mantığı yazılır, test edilebilirlik düşer → uygulama katmanı + üç yüzey koruması seçildi (RLS zaten kiracıyı korur).
- Çakışma tespitini `work-orders` servisine gömmek: iki modül arası kopya — ADR-0007'nin "tek gerçeklik saf modül" ilkesi dispatch'e genişletildi.
- Kapasiteyi hareket bazlı (work-log) hesaplamak: Faz 08 (zaman takibi) öncesi veri yok; şablon + planlı pencere MVP için yeterli — Faz 08 sonrası gerçek doluluk eklenebilir.
- Eksik yetenekte atamayı bloklamak: saha gerçekliğinde kurallar esnektir (yedek teknisyen); uyarı + görünürlük seçildi, sert blok reddedildi.
- Takvim kütüphanesi (FullCalendar vb.): pano tek hafta matrisi + kolonlar; kütüphane bağımlılığı ve stil uyumsuzluğu gereksiz — token tabanlı kendi bileşenleri kullanıldı.

## Consequences
(+) Üç mutasyon yüzeyi tek motoru paylaşır — kural ayrışması yapısal olarak imkânsız; motor saf olduğundan DST/çakışma matrisi birimde eksiksiz test edilir (36 test).
(+) Override gerekçesi kalıcı + denetlenebilir — "neden çakışma kabul edildi" sorusu veriyle yanıtlanır.
(−) Çakışma denetimi uygulama katmanında — iki eşzamanlı schedule isteği pencere kilitlenmesi yok, yarış anında motorsal değil; tekil önemsiz ve sonraki denetim düzeltir (iş emri versiyonu PATCH'lerde korur). Kalıcı çift rezervasyon ancak override ile mümkün — izin + gerekçe iziniyle.
(−) Şablonsuz teknisyende saat kısıtı sessizdir — pano "şablon yok" görünümüyle belirtir; operasyon süreç şablon doldurmaya yönlendirir.
(−) DST'te var olmayan saat penceresi başına bir kez kayma — çalışma pencereleri 02:00-03:00 bandına pratikte düşmez; davranış belgeli.

## Security/tenant impact
8 yeni tablo (technician_profiles, working_hours, time_offs, skills, user_skills, teams, team_members, service_category_skills) RLS ENABLE+FORCE — uygulama rolü dahil tüm roller kiracı politikasına tabi; pg_class sorgusuyla 8/8 kanıtlandı. Çapraz-kiracı profil/çalışma saati/izin/takım yazma 404 (varlık sızıntısı yok, entegrasyon testli); B kiracısı A'nın satırlarını RLS'te ham sorguda 0 görür. Bulgular zarfı yalnız kendi kiracısının kayıtlarını taşır. `dispatch_override` izni yalnız owner/admin'de (RBAC matrisi); teknisyen pano/teknisyen listesi 403.

## Migration/rollback considerations
Migration 1 `20261109105434_phase06_dispatch_capacity_scheduling`: 7 tablo + `work_orders.scheduleOverrideReason/slaDueAt` + SLA geri doldurma (talep devri → öncelik varsayılanı) + RLS ×7. Migration 2 `20261109111036_phase06_category_skill_requirements`: `service_category_skills` + RLS. Geri alım migration'la; SLA doldurma deterministik (yeniden koşuda aynı sonuç) — seed tohumu idempotent.
