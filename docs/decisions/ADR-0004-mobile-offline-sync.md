# ADR-0004: Mobil Çevrimdışı ve Senkronizasyon Modeli
- Status: Proposed
- Date: 2026-11-09

## Decision dahil Context için özet
`docs/OFFLINE_SYNC.md` ve `rules/06-mobile-offline.md` şartları: offline-first teknisyen akışları, yerel SQLite minimal snapshot, transactional outbox + idempotency key, retry/backoff, açık çatışma kuralları (last-write-wins yasak: stok, imza, iş emri kapanışı, ödeme), token'lar OS güvenli depoda, logout'ta yerel veri temizliği.

## Decision
**Yerel öncelikli + transactional outbox + sunucu-otoriter** modeli:

1. **Yerel depo (SQLite):** Yalnızca atanmış iş emri snapshot'ı ve gerekli taslaklar (`cached_work_order`, `cached_asset`, `cached_customer_minimal`, `draft_*`, `pending_attachment`, `sync_outbox`, `sync_cursor`, `sync_conflict` — `docs/OFFLINE_SYNC.md`'deki tablo seti). Form değişiklikleri anında yerel yazılır; ekran state'ine güvenilmez.
2. **Outbox işlemi:** Her işlem `idempotency_key` (UUID), `tenant_id`, `user_id`, entity ID, temel entity `version`, operasyon tipi, minimal payload, retry durumu taşır. Sunucu anahtarı tekilleştirir (dedupe) ve **canonical state + sync cursor** döndürür.
3. **Senkronizasyon:** Bağlantı gelince kuyruk sırayla, exponential backoff ile gönderilir. Aynı idempotency key'in tekrarı sunucuda güvenli (idempotent).
4. **Çatışma kuralları (alan bazlı):**
   - Not/checklist taslağı: güvenliyse alan düzeyinde birleştirme; değilse iki versiyon da kullanıcıya gösterilir.
   - İş emri durumu: sunucu durum makinesi kazanır; actionable çatışma döner.
   - Stok: sunucu kullanılabilirliği otoriter; çatışmada pending stock exception oluşur, asla sessizce eksili/negatif stok olmaz.
   - İmza: append-only; üzerine yazma yok; düzeltme ayrı olaydır.
   - Ödeme/fatura: asla offline'da finalize edilmez.
5. **Ekler:** Metadata senkronizasyonu ve ikili yükleme ayrı adımlar; mümkünse resumable/chunky upload. Zorunlu kanıt sunucuya ulaşmadan iş emri tam kapanamaz (tenant politikası istisna olabilir).
6. **Durum görünürlüğü:** UI her kayıtta local/queued/syncing/synced/conflict/failed durumunu gösterir — asla sahte "senkronize" gösterilmez.
7. **Güvenlik:** Token'lar SecureStore/Keychain/Keystore; yerel hassas veri platform desteği doğrulanınca şifreli; logout/iptalde offline snapshot süresi dolmuş sayılır.

## Alternatives considered
- Online-only mobil uygulama: saha gerçekliği (bodrum/depo/altyapı yokluğu) nedeniyle reddedildi; ürünün temel değeri.
- Last-write-wins senkronizasyonu: stok/imza/iş emri bütünlüğünü bozar; ürün ilkeleriyle çelişir.
- Firestore/Realm gibi BaaS senkronizasyonu: tenant izolasyonu ve sunucu tarafı iş kuralları (idempotent stok hareketi, durum makinesi) yerine geçilemez; PostgreSQL/Prisma mimarisinden kopar; reddedildi.

## Consequences
(+) Gerçek saha koşullarında çalışır; veri kaybı ve sessiz üzerine yazma yok.
(−) Test matrisi genişler: uçak modu, process kill/relaunch, çift senkronizasyon, çatışma yolları (Maestro + Jest/RNTL) zorunlu.

## Security/tenant impact
Outbox payload'ları tenant+kullanıcı kimlikli ve sunucuda üyelik doğrulamasından geçer. Cihaz kaybında oturum iptali (revoke) tüm veri erişimini keser.

## Migration/rollback considerations
Phase 07-08'de kurulur. Outbox şeması ilk mobil fazda oluşturulur; protokol değişiklikleri versiyonlu sync contract ile yönetilir.
