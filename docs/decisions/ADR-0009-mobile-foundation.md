# ADR-0009: Mobil Temel — Güvenli Oturum, Çevrimdışı Öncelikli Gelen Kutusu ve Cihaz Yönetimi
- Status: Accepted (Phase 07 uygulaması)
- Date: 2026-11-09

## Context
Faz 07, teknisyen mobil uygulamasının temelini kurar: Expo navigasyonu, güvenli kimlik doğrulama (login/refresh/rotate/revoke/logout), kiracı farkında oturum, yalnız-atanmış işlerin gelen kutusu, çevrimdışı önbellek şeması, senkron durumu, bildirim yönlendirmesi ve açılış/yükleme/hata durumları. Kabul: giriş-yenileme-iptal-çıkış, atanmış-filtre, uygulama yeniden açma, token düz depoda YOK, RNTL + Maestro dumanı. ADR-0002 mobil akışı (JWT + dönen refresh aileleri) Faz 03'ten hazır; ADR-0004 çevrimdışı model Proposed durumda. Zorluklar: (1) `GET /auth/sessions` ve `revoke-all` yalnız WEB oturumlarını kapsıyordu — mobil cihazlar listede görünmüyor ve toplu iptal onları öldürmüyordu (cihaz kaybı senaryosunun kabul yolu); (2) çevrimdışı açılışta "me() başarısız" oturumsuzluk DEMEK DEĞİL — ağ hatası ile token geçersizliği ayrıştırılmalı; (3) cache anahtarları tenant+kullanıcı kimlikli olmalı (cihazda çok kiracılı veri karışması imkânsız olmalı).

## Decision
1. **Cihaz yönetimi (API ön koşulu):** Mobil JWT'ye opsiyonel `fam` claim'i eklenir (login + her rotasyon `familyId` taşır). `GET /auth/sessions` WEB satırlarına MOBILE satırları ekler (refresh aileleri familyId bazında gruplu; etkinlik = "rotasyonlanmamış + iptal edilmemiş" satır varlığı; `lastUsedAt` = son rotasyon zamanı — aile satırında lastUsed yok, en yakın dürüst gösterge). `DELETE /sessions/:id` hem oturum hem aile kimliğini kabul eder (IDOR kontrolü: sessionId∪familyId ∈ kullanıcı); `revoke-all` mobil aileleri DAHİL kapatır. Sözleşmeye `SessionListResponseSchema` eklendi (kind enum'u Faz 03'ten MOBILE'i zaten taşıyordu).
2. **Token deposu:** `expo-secure-store` (iOS Keychain / Android Keystore) — erişim + refresh token + oturum meta'sı (userId, tenantId, kimlik) SecureStore'da; SQLite/düz preferences YASAK (ADR-0004 §7). Meta güvenli depoda tutulur ki çevrimdışı açılış kimliği göstersin; bozuk meta JSON güvenli null döner.
3. **Bootstrap ayrıştırması:** `me()` ağ hatası (network/timeout) → ÇEVRİMDIŞI oturum sürer (meta ile); 401/contract → client otomatik refresh dener (401→refresh→tek tekrar); refresh de başarısız → tokenlar silinir, signed-out (onSignedOut ile cache temizliği). Ağ hatası ASLA token temizliğine yol açmaz — "uygulama yeniden açma" kabulü bunu kanıtlar.
4. **Çevrimdışı-öncelikli gelen kutusu:** Ekranın veri kaynağı YEREL SQLite'tır (offline-first); sunucudan çekme (pull) `mine=true` ile atanmış işleri getirir ve cache'i kiracı filtresiyle tazeler. Kiracı değişiminde eski kiracının satırları + lastSyncAt'ı silinir (cihazda kiracı karışması yok). Filtreler (Tümü/Aktif/Planlı/Tamamlanan) istemci tarafında; atama filtresi sunucuda zorunlu.
5. **Senkron durumu dürüsttür (ADR-0004 §6):** idle/syncing/synced/offline/error şeridi; kuyruk sayısı görünür; asla sahte "senkronize" gösterilmez. Netinfo aboneliği bağlantı geri gelince otomatik çeker; pull-to-refresh elle tetikler.
6. **Outbox altyapısı Faz 07'de, yürütücüler Faz 08'de:** `sync_outbox` idempotency anahtarı + durum makinesi (queued→syncing→done|failed) + üstel backoff (5s→…→5dk cap) hazırdır; operasyon yürütücü seti boştur (mobil mutasyon Faz 08'de). Boş sette drain no-op'tur ve kuyruğu bozmaz.
7. **Sürücü soyutlaması:** Depo mantığı (cache, outbox, senkron) sürücüden bağımsız arayüzle (`CacheDriver`) yazılır; üretim expo-sqlite, testler bellek-içi sürücü — SQL değil DAVRANIŞ test edilir; sqlite sürücü ince adaptördür (DDL + CRUD, mantık yok).
8. **Navigasyon + bildirim yönlendirmesi:** React Navigation native-stack; oturum durumuna göre Login ya da uygulama akışı (Inbox → WorkOrderDetail → Account). Derin bağlantı `tfmobile://wo/{id}` → detay ekranı; geçersiz yol hiçbir ekrana taşınmaz (parse null).
9. **Mobil test altyapısı:** jest-expo + jest 29 + RNTL 13 (React 19 uyumlu çift) — 12 dosya 71 test; Maestro akış dosyaları (login→inbox, relaunch kalıcılığı) hazır; emülatör gerektiren yürütme bu ortamda BELGELENDİ (aşağıda sınırlama).

## Alternatives considered
- `me()` ağ hatasını oturum kapanışı saymak: saha gerçekliğinde (bodrum/depoda açılış) kullanıcı gereksiz giriş ekranına düşer — reddedildi (çevrimdışı oturum + meta).
- React Navigation yerine elle state-navigatör: bildirim yönlendirmesi ve Faz 08-12 akışları (nested ekranlar, deep link) için standart kütüphane güvenli — reddedildi.
- expo-router: SDK 58 ile ek native bağımlılık zinciri; Faz 07 ihtiyacını native-stack karşılar — sonraki fazlarda değerlendirilir.
- Meta'yı SQLite'ta tutmak: token ilkesiyle çelişir (tek hassas veri çukuru SecureStore) — reddedildi.
- E2E rate limit: tam paket tek IP'den ~20 giriş denemesi yapıyor; üretim varsayılanı (10/300s) E2E ortamında `AUTH_RATE_LIMIT_MAX=50` ile gevşetilir (yalnız test süreci env'i; depo/varsayılanlar değişmez) — limanter mantığı integration testinde gerçek limitlerle kanıtlanır.
- jest 30 + RNTL 14: Expo winter runtime'ının lazy global kurulumu jest-30 "between tests" require guard'ına takılıyor (12/12 paket açılış hatası) → jest 29 + RNTL 13 + react-test-renderer 19 çifti seçildi (SDK 58 varsayılanı).

## Consequences
(+) Cihaz kaybı akışı uçtan uca kapanır: listede görünür → tekil/toplu iptal → refresh yolu ölür (entegrasyon testli: IDOR 404, aile ölümü, revoke-all).
(+) Çevrimdışı açılış kullanıcısını engellemez; liste önbellekten açılır, bağlantıda otomatik tazeleme.
(−) `fam` claim'i JWT'ye eklendi — eski tokenlarda yoktur (opsiyonel claim; doğrulama katı değil, guard yalnız string ise taşır).
(−) Mobil oturum `lastUsedAt` son rotasyon zamanıdır — gerçek "son kullanım" alanı aile tablosunda yoktur; gerekirse Faz 08'de migration eklenir.
(−) Maestro yürütmesi bu ortamda imkânsız (emülatör/cihaz yok) — akış dosyaları hazır; yürütme geliştirme ortamında/ Faz 16'da.
(−) Gelen kutusu salt-okunur: kabul/yol/yerinde/checklist/foto/imza Faz 08 — ekranda eylem yok, detay salt-okunur snapshot.

## Security/tenant impact
Token'lar SecureStore'da (Keychain/Keystore) — SQLite/düz metin yok; logout/revoke tüm yerel veriyi (SecureStore + SQLite cache) siler. Cache anahtarları kullanıcı+tenant kimlikli; kiracı değişimi eski veriyi fiziksel siler. `fam` claim'i sunucuda yalnız kendini doğrulayan kullanıcının cihaz listesi için kullanılır (IDOR 404 entegrasyon testli). Bildirim gövdesi hassas veri taşımaz (OFFLINE_SYNC.md ilkesi). Login hata mesajları kiracı sayımına izin vermez (Faz 03 ilkesi aynen).

## Migration/rollback considerations
Veritabanı migration YOK (yalnız API davranışı + mobil istemci). `fam` claim'i opsiyoneldir — eski mobil tokenlar geçerliliğini sürdürür; refresh sonrası yeni tokenlar claim'i taşır. Geri alma: claim'in çıkarılması tek commit; liste/iptal davranışı aile varlığıyla geriye dönük uyumlu.
