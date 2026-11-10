# Changelog

## 0.9.0 — Phase 09: Inventory, van stock and parts consumption

- Stok çekirdeği (ADR-0011): append-only `stock_movements` defteri (RECEIVE/ISSUE/TRANSFER/RETURN/CONSUME/ADJUSTMENT; işaretli `quantityDelta`) + transactional `stock_balances` (depo × kalem × lot; `available = onHand − reservedQty`). Bakiye hareketle AYNI transaction'da; OUT tarafı `SELECT … FOR UPDATE` kilitli.
- Çift hareket engeli iki katman: istemci `movementKey` (kiracı başına tekil — yarış kaybedeni tüm transaction ile geri alınır, kazanan oynatılır `x-idempotent-replay: true`) + Faz 08 `x-idempotency-key` (iş emri parça ucunda aynı UUID iki amaca hizmet eder).
- Negatif stok onaysız olamaz: serbest bakiye yetersiz → 409 `NEGATIVE_STOCK_FORBIDDEN` + `details.available/requested`. Onaylı tek negatif yol sayım kapanışı ADJUSTMENT (stock:manage + audit); `stock:manage_limited` (planlamacı) düzeltme yazamaz.
- Katalog/depolar: SKU (kiracı tekil), NONE/LOT/SERIAL izleme, yeniden sipariş eşiği + düşük stok uyarısı; CENTRAL/BRANCH/VEHICLE depolar (araç deposu teknisyene bağlanır — `stock:issue_own` kaynağı), raf kodları; parti/seri (`expiresAt`, `costMinor`) — süresi geçen lot tüketime kapalı (`LOT_EXPIRED`), SERIAL tam sayı miktar (`SERIAL_QUANTITY_INVALID`).
- İş emri parça tüketimi — ATOMİK: CONSUME genel hareket ucunda sözleşmeyle YASAK; tek yol `POST /work-orders/:id/parts` (hareket + bakiye + rezervasyon + `work_order.part_consumed` olayı + audit tek transaction). Teknisyen kendi aracından (van otomatik çözüm), `stock:manage` ile seçilen depodan; rezervasyon içi tüketim kilidi düşürür.
- Rezervasyonlar: iş emri için stok kilidi (available düşer), serbest bırakma idempotent, tüketim durum makinesi (ACTIVE → PARTIALLY_CONSUMED → CONSUMED; RELEASED geri alma).
- Sayım (cycle count): OPEN sayım (depoda tek), satırlarda beklenen sunucuda dondurulur, ikinci gönderim günceller; CLOSE farklar için ADJUSTMENT'ları tek transaction'da üretir (negatif fark onaylı yol).
- Yürütme raporu genişletildi: `parts[]` + `partsCostMinor` (lot maliyetinden donan kuruş toplam) — web raporunda parça tablosu ve toplam satırı.
- Web: `/app/inventory` (genel bakış, katalog, depolar, hareket defteri — filtre/sayfalama), oluşturma formları (hareket formu sözleşme şemasıyla istemci doğrular, negatif stok hatası dürüst `available` gösterir), iş emri detayında Parçalar paneli (tüketim listesi + atomik tüketim), nav "Stok" (`stock:view` koşullu); `QuantityInput` paylaşılan bileşeni (4 ondalık, birim soneki, adım düğmeleri) + 4 Storybook hikâyesi.
- Mobil: araç stoğu cache (senkronizasyonda replace-all, kullanıcı bazlı), `parts.consume` outbox yürütücüsü (idempotency taşır; kalıcı reddi — stok aşımı vb. — 24 saat dondurma + teknisyene çakışma görünümü), iş emri detayında parça paneli (çevrimdışı kuyruğa alır, "Kuyruğa alındı" dürüst şerit), `listVanStock`/`consumePart` API istemcisi.
- 9 yeni tablo RLS FORCE (`pg_class` 9/9 kanıtı) + NULLS NOT DISTINCT tekil indeksler (lot'suz bakiye/sayım satırı tekilleşir); çapraz kiracı stok erişimi 404/RLS satır kanıtı; hata zarfı güvenli ayrıntı listesi genişletildi (`available/requested/lotId/countId/reservationId`).
- Demo tohum: 2 depo, 3 kalem (toplu/parti/seri), 2 lot, 5 deterministik hareket (`movementKey` sabit — tekrar seed'te çift yazım yok).
- Testler: 538 birim (+100) + 190 entegrasyon (+33 stok senaryosu) + 75 Storybook (+4) + 43 E2E (+5; pano tarihi kiracı saat dilimine alındı — UTC gece sınırı düzeltmesi) + 111 mobil (+10). Bilinen sınırlar raporda (sayım aralık hareketleri, satın alma siparişleri kapsam dışı, Maestro BLOCKED).
- TEST-09 kapısı: PASS (`docs/reports/PHASE-09-REPORT.md`).

## 0.8.0 — Phase 08: Technician job execution, GPS, media and signature

- Kanıt kapıları (ADR-0010): `IN_PROGRESS→COMPLETED` yalnız tüm zorunlu checklist maddeleri tamamlanınca (409 `EVIDENCE_MISSING` + hata zarfında `missing[]` eksik listesi); `COMPLETED→CLOSED` için ≥1 imza (409, `details.gate`). Kapılar geçiş transaction'ı içinde — yetki sınıfı denetiminden sonra, atomik.
- GPS kilometre taşları: `EN_ROUTE→ON_SITE` (ARRIVE) konum ZORUNLU — `source=GPS` koordinat ister; izin reddi/çevrimdışı geri dönüşü `source=MANUAL` + zorunlu `manualReason` (koordinatsız geçerli); `→COMPLETED` ayrılış (DEPARTED) opsiyonel konumla; append-only `work_order_visits` (recordedAt cihaz zamanından — geç senkronlarda varış saati gerçek kalır); diğer geçişlerde konum olay metadata'sında.
- Checklist: madde ekleme (planlama/ofis YA DA atanan teknisyen), tamamlama/geri alma (idempotent — aynı durum no-op), zorunlu maddeler tamamlama kapısına bağlı; her değişiklik olay akışı + audit.
- İşgücü kayıtları: TRAVEL/LABOR/WAITING; kullanıcı-iş başına tek AÇIK kayıt (409 `TIME_ENTRY_ALREADY_OPEN`); durdurma idempotent; dakika ceil; rapor `labor` özeti (Faz 06 kapasite tahmininin sahadaki gerçek karşılığı).
- İmza — ekle-güncelle-yok: JSON yol koordinatları (0..1 normalize `{x,y,t}`; SVG YOK → script enjeksiyon yüzeyi yok); düzeltme yeni satır + `correctionOfId`, eski satırın `supersededById` işaretçisi tek seferlik (içerik değişmez); ikinci düzeltme 409 `SIGNATURE_ALREADY_CORRECTED`; yetki `signature:capture` + kaynak düzeyi.
- Medya — ADR-0005 iki adımlı yükleme uygulaması: init (PENDING_UPLOAD + 10dk imzalı PUT) → istemci doğrudan RustFS'e → complete (HEAD + ilk 32 bayt magic-byte + boyut + MIME doğrulaması → READY | FAILED sınıflı kodla: `EMPTY_OBJECT`/`SIZE_LIMIT`/`MAGIC_BYTE_MISMATCH`); beyaz liste PHOTO jpeg/png 15MB, VIDEO mp4 200MB, DOCUMENT pdf 25MB; SVG reddi; opak kiracı-önekli nesne anahtarı, dosya adı yalnız metadata (path traversal sözleşme reddi); READY medyaya 5dk imzalı indirme URL'si; çift complete idempotent; PUT yapılmadan complete 409 `UPLOAD_NOT_RECEIVED`.
- Idempotency: `idempotency_keys` (kiracı, kullanıcı, anahtar) tekil — mobil outbox UUID'leriyle `x-idempotency-key`; iş mantığı + yanıt kaydı AYNI transaction'da (çökmede birlikte geri alınır); oynatma `x-idempotent-replay: true` + TAZE imzalı URL'ler; TTL 24 saat; eşzamanlı çift gönderimde tekil kısıt → kaybeden rollback.
- Mobil: GPS sağlayıcı soyutlaması (`expo-location` adapter'i App kabuğunda; izin reddi → manuel onay UI akışı); outbox yürütücüleri (transition/arrive/checklist/time/signature — ağ hatası üstel backoff, kalıcı 4xx 24 saat dondurma "sunucu kazanır"); saha yürütme paneli (eylem düğmeleri, checklist, süre, imza tuvali, konum kayıtları, medya); detay ekranı rapor çeker; SignaturePad (PanResponder, normalize noktalar).
- Web: varış bildiri çekmecesi (tarayıcı konumu → izin redliyken manuel onay + neden); EVIDENCE_MISSING eksik listesi/kapı mesajı dürüst gösterimi; yürütme paneli (checklist + süre + imza + kanıt); `/app/work-orders/:id/report` yürütme raporu (işgücü özeti, konum kayıtları ±m doğrulukla, checklist, süre, medya, imzalar SVG eskiz render'ı); SignaturePad (HTML canvas, erişilebilir) + Storybook etkileşim testi.
- api-client: execution typed istemcisi (idempotency başlığı + `replayed` bilgisi + EVIDENCE_MISSING `missing[]` alanı).
- 6 yeni tablo RLS FORCE (`pg_class` 6/6 kanıtı); 7 enum; kiracı izolasyonu entegrasyonla (çapraz-kiratı okuma/yazma 404).
- Testler: 37 sözleşme (+13) + 170 API birim (+13) + 157 entegrasyon (+18: execution) + 104 ui-web birim (+7) + 71 Storybook (+1 hikâye) + 99 mobil (+28) + 38 E2E (varış manuel onay + imza kapısı + rapor genişletildi).
- TEST-08 kapısı: PASS (`docs/reports/PHASE-08-REPORT.md`); Maestro yürütme emülatörsüz ortamda BLOCKED (Faz 07 kalıntısı — belgelendi).

## 0.7.0 — Phase 07: Mobile foundation and technician inbox
: Mobile foundation and technician inbox

- Expo mobil temel: React Navigation (native-stack) — oturum durumuna göre Giriş ya da uygulama akışı (Gelen Kutusu → İş Emri Detayı → Hesap); açılış/yükleme/boş/hata durumları; derin bağlantı `tfmobile://wo/{id}` → detay (geçersiz yol null — hiçbir ekrana taşınmaz).
- Güvenli oturum (ADR-0002 mobil akışı): tokenlar `expo-secure-store` (Keychain/Keystore) — SQLite/düz depo YOK; login (client: mobile + çoklu üyelik seçimi), erişim tokenı 401'de otomatik refresh + tek tekrar, refresh ölümünde temiz çıkış; logout sunucu refresh iptali + tüm yerel veri silme.
- Çevrimdışı açılış ayrıştırması: `me()` ağ hatası → son meta ile çevrimdışı oturum sürer (token silinmez); 401/contract → refresh yolu; "uygulama yeniden açma" kabulü bu yolla kanıtlı.
- Offline-first gelen kutusu: veri kaynağı yerel SQLite (expo-sqlite; sürücü soyutlaması — testler bellek-içi sürücü); pull `mine=true` (atanmış-filtre kabulü), kiracı değişiminde eski kiracı verisi fiziksel silinir; filtreler (Tümü/Aktif/Planlı/Tamamlanan); SLA rozetleri + planlama penceresi (Europe/Istanbul).
- Dürüst senkron şeridi: idle/syncing/synced/offline/error + kuyruk sayısı; netinfo ile bağlantı geri gelince otomatik çekme, pull-to-refresh; asla sahte "senkronize" yok (ADR-0004 §6).
- Outbox altyapı (Faz 08 yürütücüleri hazır bekler): idempotency anahtarı + queued→syncing→done|failed makinesi + üstel backoff (5s→5dk cap); `sync_outbox`/`sync_cursor`/`sync_meta` şeması OFFLINE_SYNC.md setine göre.
- API ön koşulu — cihaz yönetimi: mobil JWT'ye opsiyonel `fam` claim'i (login + rotasyon aile kimliği taşır); `GET /auth/sessions` WEB + MOBILE satırları (gruplu aileler, "bu cihaz" işareti); `DELETE /sessions/:id` aile düşürür; `revoke-all` mobil aileleri DAHIL kapatır → sonraki refresh 401 (IDOR 404 + aile ölümü entegrasyon kanıtlı); sözleşme `SessionListResponseSchema`.
- Mobil test altyapısı: jest-expo + jest 29 + RNTL 13 (React 19 çifti) — 12 dosya 71 test (istemci 13, oturum 8, cache/outbox 9, senkron 5, ekranlar/bileşenler 34, format/linking 6); Maestro akış dosyaları (login→inbox, relaunch kalıcılığı) — emülatörsüz ortamda yürütme BLOCKED (belgelendi).
- Web E2E regresyonu yok (38/38); Storybook 67/67; toplam 415 birim (+71) + 139 entegrasyon (+4).
- TEST-07 kapısı: PASS (`docs/reports/PHASE-07-REPORT.md`).

## 0.6.0 — Phase 06: Dispatch board, team capacity and scheduling

- Sevk motoru (ADR-0008): çakışma/kapasite/SLA/yetenek/serbest-slot kurallarının TEK gerçekliği veritabanı erişimi olmayan saf modülde (`dispatch-engine.ts` — 36 birim test); schedule ucu, doğrudan ASSIGNED geçişi ve PATCH schedule üç mutasyon yüzeyi de aynı motorü çağırır.
- Çift rezervasyon yok: örtüşen planlama 409 SCHEDULE_CONFLICT + OVERLAP bulgusu; uçtan-uca bitişik işler serbest; izin çakışması (TIME_OFF) 409 → izin iptal edilince planlanır; çalışma saati şablonu VARSA dışarı taşma (OUTSIDE_WORKING_HOURS, kalan dakika raporlu) 409 — şablon yoksa kısıt yok ("veri yok = kısıt yok").
- Çakışma üzerine planlama: `work_orders:dispatch_override` izni (yalnız owner/admin) + ≥10 karakter gerekçe; planlamacı 403 OVERRIDE_FORBIDDEN, kısa gerekçe şema 400; gerekçe `scheduleOverrideReason`'a kalıcı yazılır ve olay/audit akışına girer; bulgular hata zarfında `conflicts[]` ile (yalnız kendi kiracısının iş emri kimlikleri).
- Saat dilimi çekirdeği: depolama UTC, kiracı yerel duvar saati yalnız yorumda; iki geçişli ofset düzeltmesi — DST ileri/geri alması ve 23/25 saatlik günler doğru (Berlin 2026 testleri); Europe/Istanbul kalıcı UTC+3; çalışma saatleri ISO hafta içi + dakika aralığı şablonu.
- Kapasite ve müsaitlik: günlük kapasite = min(şablon, üst sınır); planlı dakikalar gün sınırlarıyla kesişim; kullanım % (`MeterBar`); serbest slotlar = çalışma − planlı − izin (`/dispatch/technicians/:id/availability`); gün çakışma listesi ucu.
- Tek adımda planla/ata: DRAFT→PLANNED(+ASSIGNED) tek uçtan; ASSIGNED iş başka teknisyene devredilir (atama geçmişi korunur); yetenek gereksinimi eksik teknisyende BLOK değil — `skillWarnings` + kuyrukta `requiredSkillKeys` görünürlüğü.
- Yetenek altyapısı: kiracı yetenek kataloğu + teknisyen seviyeleri + kategori gereksinimleri (`service_category_skills`); takımlar (kod tekil, takım lideri, üye ekleme/çıkarma — planlamacı takım kuramaz).
- SLA iş emrine taşındı: `work_orders.slaDueAt` migration'la geri dolduruldu — talepten dönüşen devralır (müşteri sözü sıfırlanmaz), doğrudan açılan öncelik varsayılanından; pano aşım/risk rozetleri (4 saat eşiği).
- Web pano `/app/dispatch`: kanban (teknisyen kolonları + planlama kuyruğu, HTML5 sürükle-bırak + tam klavye alternatifi), takvim (hafta matrisi), liste; SLA rozetleri; çakışma uyarısı paneli; kiracı saat dilimi dönüşüm kütüphanesi (testli).
- ui-web: SegmentedControl (klavye seçimli) + MeterBar bileşenleri + stories + etkileşim testleri; api-client: dispatch typed istemcisi.
- RBAC: `work_orders:dispatch_override` (owner/admin); teknisyen pano/teknisyen listesi/planlama 403; 8 yeni tablo RLS FORCE (pg_class 8/8 kanıtı; çapraz-kiracı yazma 404 + ham satır-0 kanıtı).
- Faz 03 kalıntısı düzeltildi: oturum çerezi maxAge saniye→milisaniye (12 saatlik oturum ~43 saniyede biterdi). Faz 05 kalıntısı: aktif gezinme öğesi yol adından türetilir.
- Testler: 344 birim (+64) + 135 entegrasyon (+26: dispatch) + 67 Storybook (+12) + 38 E2E (+4: pano atama klavyeyle/çakışma/rol/mobil).
- TEST-06 kapısı: PASS (`docs/reports/PHASE-06-REPORT.md`); 4 ekran görüntüsü `docs/screenshots/phase-06/`.

## 0.5.0 — Phase 05: Service intake and work-order lifecycle

- Servis talebi (intake) gelen kutusu: oluşturma (portal/ofis/e-posta/API kaynakları), arama/durum/öncelik filtreleri + sayfalama, SLA hedefi ve görünür aşım bayrağı; kategori kataloğu (kiracıya özel, çift anahtar 409) ve öncelik bazlı SLA politikaları (varsayılan katalog: Acil 4sa → Düşük 72sa; triyajda öncelik değişimi SLA'yı createdAt referansıyla yeniden hesaplar).
- Triyaj: öncelik/kategori/durum (NEW→IN_REVIEW) güncelleme; açıklama/eşya bağlama; terminal talepler değiştirilemez (409).
- Talep → iş emri dönüşümü: birebir (`requestId` tekil); schedule girilirse PLANLANMIŞ, yoksa TASLAK iş emri; ikinci dönüşüm 409 REQUEST_NOT_CONVERTIBLE; talep etkinlik geçmişi `crm_events` JSON-yol filtresiyle.
- İş emri durum makinesi (ADR-0007): 12 durum (taslak→planlandı→atandı→kabul→yolda→yerinde→devam→parça/müşteri bekleme→tamamlandı→kapatıldı + iptal), 24 izinli geçiş TEK gerçeklik tablosunda; birleşik geçiş ucu (409 INVALID_TRANSITION + izinli hedefler); yeniden açma ve geri alma dahil.
- Geçiş yetkisi 5 sınıf: planlama (create|dispatch), atama (dispatch), yürütme (complete VE atanan-veya-view_all — teknisyen yalnız KENDİ işini yürütür), kapatma (yönetici), iptal (neden kodu zorunlu: müşteri talebi/mükerrer/kapsam dışı/parça/plan çakışması/diğer + not).
- İş emri numaralandırma: WO-YYYY-NNNN — (kiracı, yıl) sayaç tablosunda atomik UPSERT-artış; (tenantId, workOrderNo) tekil indeks geri savunma; eşzamanlı oluşturmalar testte tekil.
- Atamalar: append-only geçmiş (ACTIVE/REMOVED); yeniden atama eski kaydı kaldırır; aynı teknisyene çift gönderim idempotent; atanabilir roller `complete|view_assigned` (finans/planlayıcı atanamaz); şube kapsamı atamada doğrulanır (BRANCH_SCOPE_MISMATCH).
- İyimser eşzamanlılık: `version` — düzenlemede zorunlu, geçişte opsiyonel → 409 VERSION_CONFLICT (çift gönderim/bayat sürüm koruması).
- Notlar: dahili/müşteri-görünür ayrımı (portalde Faz 12'de açılır); olay meta'sı gövde taşımaz (gizlilik).
- Olay akışı: `work_order_events` (created/state_changed/assigned/unassigned/cancelled/note_added/updated) + önemli adımlar müşteri/varlık zaman çizelgesine (`crm_events`) + audit kayıtları.
- RLS: 8 yeni tabloda FORCE politikaları (uygulama rolü dahil); çapraz-kiracı okuma/yazma/geçiş 404 + ham RLS kanıtı.
- Web: talep gelen kutusu (+yeni talep çekmecesi), talep detayı (bilgiler/triyaj/dönüşüm/iptal/etkinlikler), iş emri listesi (+yeni İE çekmecesi, durum filtresi), İE detayı (eylem paneli: durum makinesi düğmeleri yetkiye göre; planlama/atama çekmeceleri; notlar; atama geçmişi; zaman çizelgesi; düzenleme); yetkiye dayalı navigasyon (teknisyen: talepler gizli).
- ui-web: Timeline bileşeni (ton kodlu olay akışı, ol semantiği) + stories + etkileşim testleri; api-client: servis akışı typed istemcisi (liste/detay/mutasyonlar, girdi doğrulamalı hata sonuçları).
- Sözleşmeler: service.ts (enum'lar, şemalar, görünümler, liste zarfları, UI etiket haritaları, görünür geçiş tablosu — API makinesiyle birebirlik testli).
- Testler: 280 birim (+50) + 109 entegrasyon (+37: intake 15 + iş emirleri 22) + 55 Storybook (+4) + 34 E2E (+6: yaşam döngüsü/iptal/rol/mobil); E2E zinciri seri modda (fullyParallel RUN uyuşmazlığı çözüldü).
- TEST-05 kapısı: PASS (`docs/reports/PHASE-05-REPORT.md`); 8 ekran görüntüsü `docs/screenshots/phase-05/`.

## 0.4.0 — Phase 04: CRM, contacts, locations and equipment registry

- Müşteri kayıt defteri: CRUD (silme = arşivleme), normalize duyarlı arama (Türkçe İ/ı), durum filtresi, sayfalama; birincil kontakla birlikte oluşturma.
- Çift kayıt kuralları: nameNormalized (Türkçe duyarlı) tekil anahtar, vergi no, kişi e-postası, varlık etiketi, seri no (kısmi tekil indeks) — 409 + çakışan kaydın KENDİ kiracısındaki kimliği (details).
- Kişiler ve servis lokasyonları: tam CRUD; koordinat doğrulama; bağlı varlık koruması (LOCATION_IN_USE).
- Ekipman envanteri: üretici/model/seri/kritiklik; otomatik etiket (AST-XXXXXX — karışabilir karakter yok); üst-varlık hiyerarşisi; durum makinesi (ACTIVE/INACTIVE/RETIRED — silme = emeklilik); global + müşteri filtreli arama.
- Varlık geçmişi + müşteri zaman çizelgesi: tek `crm_events` kaynağı (RLS'li), her mutasyon transaction içinde olay yazar (status_changed:FROM:TO gibi anlamlı türler).
- QR varlık kimlikleri: SVG üretimi + kimlik doğrulamalı by-tag çözümleme (404 = sızıntı yok); derin bağlantı /a/{assetTag}.
- Varlık dokümanları: meta veri + kısa ömürlü imzalı PUT/GET URL'leri (RustFS gidiş-dönüş testli); kiracı-kapsamlı opak objectKey.
- CSV içe aktarma: başlık denetimli ayrıştırıcı (tırnak/çok satır), dry-run, dosya içi + DB çift kayıt denetimi, satır bazlı rapor, güvenli tekrar; import-template uç noktası.
- RBAC genişlemesi: customers:manage + assets:manage (owner/admin/dispatcher/service-manager); any-of okuma modu (view_all|view_limited); teknisyen view_assigned Faz 05'e kadar fail-closed.
- RLS: 6 yeni tabloda FORCE politikalar; FK'lı çapraz-kiracı referanslarına karşı servis katmanı doğrulaması.
- Web: müşteri listesi (arama/sayfalama/yeni müşteri çekmecesi), müşteri detayı (bilgiler/kişiler/lokasyonlar/ekipmanlar/zaman çizelgesi + ekleme çekmeceleri), ekipman envanteri (filtrelerle), yetkiye dayalı navigasyon.
- ui-web: Pager ('use client' + serileştirilebilir hrefTemplate — RSC güvenli) ve DetailList bileşenleri + stories/testler.
- E2E üretim derlemesinde koşar (dev derleme takılmaları kararsızlık üretiyordu); 28/28.
- TEST-04 kapısı: PASS (`docs/reports/PHASE-04-REPORT.md`); 10 ekran görüntüsü `docs/screenshots/phase-04/`.

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
