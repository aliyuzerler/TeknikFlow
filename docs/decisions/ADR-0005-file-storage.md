# ADR-0005: Dosya Depolama Stratejisi
- Status: Proposed
- Date: 2026-11-09

## Context
Ürün; servis fotoğrafları/videoları, imza görüntüleri, ekipman dokümanları, makbuzlar ve üretilmiş PDF raporlar tutar. `docs/ARCHITECTURE.md` + `docs/SECURITY_PRIVACY.md`: özel (private) S3-uyumlu bucket, tenant-scoped opak nesne anahtarları, kısa ömürlü imzalı URL'ler, MIME/magic-byte/boyut/doğrulama, karantina + malware tarama kancası, EXIF GPS temizliği, SVG/script payload koruması, geliştirmede MinIO.

## Decision
**S3-uyumlu özel obje deposu + imzalı URL + doğrulama hattı**:

1. **Depolama:** S3-uyumlu API (geliştirme/CI'da MinIO, üretimde yönetilen servis). Bucket asla herkese açık değil. Nesne anahtarları opak (UUID) ve tenant-scoped prefiksli; kullanıcı tarafından verilen dosya adı yalnızca metadata'da tutulur (path traversal engeli).
2. **Erişim:** API, tenant + rol yetkisi doğruladıktan sonra kısa ömürlü (örn. 5-15 dk) imzalı indirme/upload URL'si verir. İki adımlı upload: (a) metadata kaydı + imzalı upload URL'si, (b) ikili yükleme, (c) tamamlanma bildirimi + doğrulama.
3. **Doğrulama hattı:** gerçek MIME (magic byte), uzantı tutarlılığı, boyut limiti, izinli format listesi, video süresi limiti. Görseller re-encode edilip EXIF (GPS) temizlenir; orijinaller tenant politikasına göre opsiyonel saklanır. SVG yükleme riskli kabul edilir: içerik temizliği veya rasterize; script payload'ı reddedilir. Oversized decompression (dekomprimasyon bombası) koruması.
4. **Karantina:** Tarama kancası (hook) tamamlanana kadar nesne `FileObject` kaydında quarantined durumda kalır; tarama geçmezse silinir/erişilemez kalır.
5. **Rapor PDF'leri:** worker tarafından üretilir, aynı özel bucket'a yazılır, müşteri portalı imzalı URL ile dağıtır.

## Alternatives considered
- Veritabanında blob saklama (bytea): backup şişmesi, DB bağlantı havuzu işgali, imzalı URL imkânsız; reddedildi.
- Herkese açık bucket + tahmin edilmesi zor URL: "unguessable URL" bir erişim kontrolü değildir; reddedildi.
- Doğrudan istemciden sağlayıcıya yükleme (pre-signed PUT hariç): yetki/limit kontrolü sunucuda yapılamaz; iki adımlı akış tercih edildi.

## Consequences
(+) Ölçeklenebilir, ucuz depolama; erişim her zaman yetki kontrollü.
(−) MinIO/infra bağımlılığı (Docker); görüntü işleme kuyruğu (worker) maliyeti.

## Security/tenant impact
Yüksek: IDOR'ün en yaygın ikinci yüzeyi dosya erişimidir. İmzalı URL'ler tenant/rol doğrulaması sonrası verilir; çapraz-tenant indirme testleri zorunludur. Kimlik bilgisi/token loglanmaz.

## Migration/rollback considerations
Phase 01'de MinIO compose ile hazır edilir; `FileObject` şeması Phase 03-05'te kurulur. Sağlayıcı soyutlaması (S3 API) sayesinde MinIO → üretim sağlayıcısı geçişi yapılandırma değişikliğidir.
