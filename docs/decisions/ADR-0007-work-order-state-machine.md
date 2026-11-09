# ADR-0007: İş Emri Durum Makinesi, Numaralandırma ve SLA Modeli
- Status: Accepted (Phase 05 uygulaması)
- Date: 2026-11-09

## Context
PRD §5, iş emri yaşam döngüsünü 12 durumla tanımlar (draft → planned → assigned → accepted → en route → on site → in progress → waiting parts/customer → completed pending approval → closed, ve cancelled). Gereksinimler: geçişler doğrulanır ve denetlenir; numara kiracı içinde tekil (`(tenant_id, work_order_no)`); talep→iş emri dönüşümü birebir; iptal nedeni sınıflı kodla; SLA öncelik bazlı hesaplanır. Teknisyen yalnız atanmış işleri yürütür ("Assigned only" — docs/ROLES_PERMISSIONS.md), kapatma yönetici yetkisindedir. Faz 06 (dispatch/takvim), 07-08 (mobil yürütme) ve 10 (PM üretimi) aynı makineyi paylaşacaktır — ayrışma riski gerçek.

## Decision
1. **Tek gerçeklik durum makinesinde:** Geçiş tablosu (`apps/api/src/service/work-order-state.ts`) saf modüldür; her kural `from/to/action/authority` taşır. Servis ve testler aynı tabloyu kullanır. Sözleşme paketi görünür hedef listesini (`WORK_ORDER_TRANSITION_TARGETS`) UI etiketleriyle paylaşır; iki tablo arasındaki tutarlılık API birim testiyle kanıtlanır. Kendine geçiş (A→A) geçersizdir; CLOSED/CANCELLED terminaldir.
2. **Geçiş yetkisi 5 sınıf:** PLANNING (create|dispatch), DISPATCH (dispatch), EXECUTION (complete VE (view_all VEYA aktif atanan)), CLOSE (complete VE view_all), CANCEL (create|dispatch). Bu, ROLES_PERMISSIONS matrisini birebir yansıtır: teknisyen kendi işini yürütür, kapatamaz; planlayıcı atar, yürütmez; finans görüntüler, dokunamaz.
3. **Birleşik geçiş ucu:** `POST /work-orders/:id/transition {to, ...}` — tek giriş kapısı; eyleme özgü parametreler (assigneeUserId/reasonCode/schedule) şemayla doğrulanır. Geçersiz geçiş 409 INVALID_TRANSITION + izinli hedef listesiyle döner (istemci UI'yi kendini düzeltir).
4. **Numara üretimi:** `WO-YYYY-NNNN`; `(tenantId, year)` sayaç tablosunda `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` ile ATOMİK artış (kiracı-kapsamlı transaction içinde, RLS'e tabi). `(tenantId, workOrderNo)` tekil indeks geri savunma. Eşzamanlı oluşturmaların numaraları tekildir (entegrasyon testi: 5 paralel → 5 farklı numara).
5. **İyimser eşzamanlılık:** `version` alanı; PATCH beklenen sürüm ister, geçiş isteğinde opsiyonel — uyuşmazlık 409 VERSION_CONFLICT.
6. **Atama geçmişi:** append-only `work_order_assignments` (ACTIVE/REMOVED); yeniden atama eski kaydı REMOVED yapar. Aynı teknisyene çift gönderim idempotent (yeni kayıt üretilmez).
7. **SLA:** öncelik başına çözüm süresi (dakika) kiracı politikasında (`sla_policies`), yoksa varsayılan katalog (URGENT 4sa/HIGH 8sa/MEDIUM 24sa/LOW 72sa). `slaDueAt` talebin createdAt referansından deterministik hesaplanır; öncelik değişince aynı referansla yeniden hesaplanır. Aşım bayrağı okuma anında türetilir (terminal durumlarda aşım yok).
8. **Olay akışı:** `work_order_events` append-only (created/state_changed/assigned/unassigned/cancelled/note_added/updated); meta veri güvenlidir (neden kodu, kimlik — asla not gövdesi). Müşteri/varlık zaman çizelgesine önemli adımlar `crm_events`'e de yazılır (tek kaynak ilkesi).
9. **Notlar:** `work_order_notes` dahili/müşteri-görünür ayrımıyla; CUSTOMER portalde (Faz 12) açılır.

## Alternatives considered
- Durum başına ayrı uçlar (/accept, /en-route...): 12×uç, yetki/eylem çakışması ve "kabul edilebilir geçişler" sözleşmesinin dağılması → reddedildi (tek uç, tek doğrulama).
- Durum makinesini veritabanında (trigger/kısıt) işlemek: Prisma + migration yönetimi karmaşası, test edilebilirlik düşer; RLS zaten satır düzeyinde korur → reddedildi.
- Numara için UUID veya sequence-per-tenant ayrı nesnesi: UUID okunabilir değil; global sequence kiracılar arası sızıntı (numara tahmini) riski → kiracı+yıl sayacı seçildi.
- SLA takvimi (iş günleri/saatleri) hesabı: MVP'den ağır; politikalar dakika bazlı, takvim duyarlılığı Faz 13'e not edilir.

## Consequences
(+) Tüm geçişler tek yerden denetlenebilir ve test edilebilir (12×12 tam matris birim testte kanıtlanır); mobil/web aynı sözleşmeyi paylaşır.
(+) Atomik sayaç eşzamanlı oluşturmada delik yok (tekil indeks + koşum testli).
(−) Birleşik uç gövdesi hedefe göre değişir (şema `superRefine` ile çözülür).
(−) Talep SLA'sı takvim duyarlı değil (gece/hafta sonu fark etmez) — bilinçli MVP sınırlaması.

## Security/tenant impact
Geçiş yetkisi kaynak düzeyi denetimle birleşir: view_assigned kullanıcısı için aktif atama kontrolü DB sorgusuyla; çapraz-kiracı geçiş/okuma 404 (varlık sızıntısı yok, entegrasyon testli). Yeni 8 tablo RLS FORCE (uygulama rolü dahil) — migration SQL'de kanıtlanır.

## Migration/rollback considerations
Migration `20261109092257_phase05_service_intake_work_orders`: 8 tablo + RLS politikaları; geri alım migration'la. Sayaç tablosu tohumda mevcut maksimuma senkronlanır (numara çakışması olmadan devamlılık).
