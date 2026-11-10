# ADR-0010: Saha Yürütme Kanıt Mimarisi (GPS, Medya, İmza, Idempotency)

- Status: Accepted
- Date: 2026-11-10
- Phase: 08

## Context
Faz 08, teknisyenin sahada ürettiği KANITI (varış GPS'i, checklist, işgücü, fotoğraf/video, müşteri imzası) iş emri yaşam döngüsüne bağlar. Üç zorlayıcı kısıt: (1) mobil saha ağı kopmaya uğrar (uçak modu, çift dokunuş, geç senkron) — çift kanıt kaydı kabul edilemez; (2) kanıt, hizmet bedelinin ve SLA'nın dayanağıdır — "iş bitti" ve "iş kapandı" iddiası doğrulanabilir olmalı; (3) imza ve GPS gibi hassas veriler kiracı izolasyonu ve script-enjeksiyon saldırı yüzeyleri yaratır.

## Decision

### 1. Kanıt kapıları (evidence gates) — durum makinesine bağlı doğrulama
- `IN_PROGRESS → COMPLETED` yalnızca TÜM zorunlu (`required=true`) checklist maddeleri tamamlanınca izinli; aksi halde **409 `EVIDENCE_MISSING`** + eksik madde listesi (hata zarfında `missing[]`).
- `COMPLETED → CLOSED` için en az bir imza; yoksa **409 `EVIDENCE_MISSING`** (`details.gate='CLOSED'`).
- Kapılar `transitionWorkOrder` içinde kiracı-kapsamlı transaction'da sorgulanır (yetki sınıfı denetiminden SONRA) — geçiş ile kontrol atomiktir.
- Medya `PENDING_UPLOAD` kalması kapatmayı VARSAYILAN olarak engellemez (kiracı politikası genişletme noktası; OFFLINE_SYNC.md "pending-evidence closure" notu).

### 2. GPS kilometre taşları — append-only `work_order_visits`
- `EN_ROUTE → ON_SITE` (ARRIVE) geçişi konum ZORUNLU kılar: `source=GPS` koordinat ister; izin reddi/çevrimdışı için `source=MANUAL` + `manualReason` (≥2 karakter) — koordinatsız da varış gerçeği kayıt altında.
- `→ COMPLETED` ayrılış (DEPARTED) kaydı opsiyonel konumla düşer. Diğer geçişlerde konum yalnızca olay metadata'sında.
- `recordedAt`, CİHAZ zamanından (`capturedAt`) alınır: geç senkronlarda varış saati gerçek kalır.

### 3. İmza — yol koordinatları, ekle-güncelle-yok
- Saklama biçimi: **JSON nokta dizileri** (0..1 normalize `{x,y,t}`), SVG DEĞİL → script-enjeksiyon yüzeyi ve bağımlılık yok.
- Append-only: hatalı imza `correctionOfId` referring eden YENİ satırla düzeltilir; eski satırın `supersededById` işaretçisi tek seferlik güncellenir, içerik asla değişmez. İkinci düzeltme → **409 `SIGNATURE_ALREADY_CORRECTED`**.
- Yetki: `signature:capture` VE kaynak düzeyi (`view_all` YA DA atanmış).

### 4. Medya — ADR-0005'in uygulaması (iki adımlı)
- `init` → imzalı PUT (10 dk) → istemci doğrudan RustFS/S3'e yükler → `complete` → sunucu HEAD + ilk 32 bayt GET ile **magic-byte/boyut/MIME** doğrular → `READY` | `FAILED` (sınıflı kod: `EMPTY_OBJECT`, `SIZE_LIMIT`, `MAGIC_BYTE_MISMATCH`).
- Beyaz liste: PHOTO=jpeg/png (15 MB), VIDEO=mp4 (200 MB), DOCUMENT=pdf (25 MB). SVG bilinçli olarak reddedilir. Nesne anahtarı opak UUID, kiracı önekli; dosya adı yalnızca metadata.
- QUARANTINED durumu malware-tarama kancası için hazır (worker fazı).

### 5. Idempotency — `idempotency_keys`
- Mobil outbox her işleme UUID üretir (`x-idempotency-key`); sunucu `(tenantId, userId, key)` tekil satırında KANONİK yanıtı saklar ve oynatır (`x-idempotent-replay: true`). TTL 24 saat.
- İş mantığı + anahtar kaydı AYNI transaction'da: çökmede ikisi birlikte geri alınır (çift imza yüzeyi kapalı). Eşzamanlı çift gönderimde tekil kısıt → kaybeden rollback, kazananın yanıtı oynatılır.
- Yanıta yeniden üretilmesi gereken alanlar (imzalı URL'ler) oynatmada TAZE üretilir.

### 6. İşgücü — `time_entries` (Faz 06 kapasite tahmininin sahadaki karşılığı)
- TRAVEL/LABOR/WAITING tipleri; kullanıcı-iş emri başına tek AÇIK kayıt (409 `TIME_ENTRY_ALREADY_OPEN`); dakika yuvarlaması ceil (müşteriye yansıyan süre konservatif).
- Rapor `labor` özetinde tür bazında toplam + açık kayıt bayrağı.

## Alternatives considered
- **Kanıt kapılarını yalnızca istemci UI'sında zorlamak**: sunucu atlanabilir; reddedildi.
- **İmzayı base64 resim / SVG olarak saklamak**: boyut + script enjeksiyonu + bağımlılık; nokta dizisi hem ham kanıt hem yeniden çizilebilir; reddedildi.
- **İmza düzeltmesini UPDATE ile yapmak**: denetlenebilirlik kaybı; append-only + işaretçi korundu.
- **Idempotency'yi Redis'te tutmak**: TTL kaybında yeniden işlenir + transaction izolasyonu yok; Postgres tekil kısıtı kalıcı ve atomik; reddedildi.
- **Medyayı API gövdesinden geçirmek**: büyük payload'lar API'yi işgal eder ve bellek bütçesini aşırır; presigned PUT zaten ADR-0005'te kararlaşılmıştı.

## Consequences
(+) "İş bitti/kapandı" iddiası doğrulanabilir kanıtla bağlı; mobil çift gönderim güvenli; GPS izin reddi operasyonu durdurmaz (dürüst geri dönüş).
(−) Mobil sahte saat (`capturedAt`) sunucudaclamp edilmez — istismar raporlanabilir ama engellenmez (bilinen sınır, §Sınırlar).
(−) `idempotency_keys` tablosu düzenli temizlik ister (TTL süresi geçenler tembel silinir).

## Security/tenant impact
Yüksek: 6 yeni RLS FORCE tablosu (`pg_class` ile kanıtlandı); imzalı medya URL'leri 5 dakikalık ömürle, yalnız yetkili görüntüleyiciye; dosya adı yolu/geçiş karakterleri içeremez (path traversal reddi sözleşmede); GPS hassas verisi yalnız kiracı kapsamında ve raporda — asla loglarda.

## Migration/rollback considerations
`20261110085651_phase08_execution_gps_media_signature`: 7 enum + 6 tablo + indeksler + FK zinciri + RLS FORCE blokları. Geri alma: tablolar DROP edilerek faz 07 sonrasına dönülür; iş emri çekirdeği değişmez (yalnız transition girdisine opsiyonel `location` eklendi).
