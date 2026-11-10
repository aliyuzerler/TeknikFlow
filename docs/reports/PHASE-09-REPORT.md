# PHASE 09 REPORT — Inventory, van stock and parts consumption

- Date: 2026-11-10
- Phase prompt: `prompts/phases/PHASE-09-inventory-van-stock-and-parts-consumption.md`
- Test matrix: `prompts/tests/TEST-09-inventory-van-stock-and-parts-consumption.md`
- ADR: `docs/decisions/ADR-0011-inventory-movement-ledger.md` (Accepted)
- Gate: **PASS**

## 1. Scope delivered

- **Katalog (SKU)**: `stock_items` — sku (kiracı başına tekil), ad, birim, `tracking_mode` (NONE/LOT/SERIAL), yeniden sipariş eşiği, aktiflik; arama + sayfalama (allowlist'li sorgu sözleşmesi).
- **Depolar/raflar**: `warehouses` (CENTRAL/BRANCH/VEHICLE — araç deposu teknisyene `assignedToId` ile bağlanır), `stock_bins` (depo başına raf kodu tekil).
- **Parti/seri**: `stock_lots` — lotNo (kalem başına tekil), serialNo, `expiresAt`, `costMinor`; LOT/SERIAL hareketlerinde lot zorunlu, NONE'da yasak; süresi geçen lot tüm hareketlere kapalı (`LOT_EXPIRED`; sayım düzeltmesi hariç).
- **Hareket defteri (append-only)**: `stock_movements` — RECEIVE/ISSUE/TRANSFER/RETURN/CONSUME/ADJUSTMENT; pozitif `quantity` + işaretli `quantityDelta`; `movementKey` (kiracı başına tekil) çift hareket engeli; iz referansı (`work_order`/`stock_count`).
- **Bakiye**: `stock_balances` (depo × kalem × lot) hareketle aynı transaction'da güncellenir; `available = onHand − reservedQty`; NULLS NOT DISTINCT tekil indeksler.
- **Rezervasyonlar**: iş emri için stok kilidi; serbest bırakma idempotent; tüketim kilidi düşürür.
- **Sayım (cycle count)**: OPEN → satır (beklenen sunucuda dondurulur, ikinci gönderim günceller) → CLOSE (farklar için ADJUSTMENT'lar tek transaction'da; negatif fark onaylı tek yol).
- **İş emri parça tüketimi**: `POST /work-orders/:id/parts` — ATOMİK (hareket + bakiye + rezervasyon + olay + audit tek transaction); teknisyen kendi aracından (van otomatik), ofis/depocu `stock:manage` ile seçilen depodan; idempotency başlığı hem API oynatma hem movementKey.
- **Rapor/maliyet**: yürütme raporuna `parts[]` + `partsCostMinor` (lot maliyetinden donan kuruş hassasiyetli toplam); web rapor sayfasında parça tablosu + toplam satırı.
- **API yüzeyi**: `packages/contracts/src/inventory.ts` (zod; TR etiketli sabitler), `apps/api/src/inventory/` (engine saf fonksiyonlar + service + parts service + 2 controller + module), `packages/api-client/src/inventory-client.ts` (typed, idempotency başlıklı).
- **Web**: `/app/inventory` (genel bakış + düşük stok + son hareketler), `/app/inventory/items|warehouses|movements` (liste + oluşturma formları; hareket formunda sözleşme şeması ile istemci doğrulama), iş emri detayında Parçalar paneli, raporda parça/maliyet; nav "Stok" bölümü (`stock:view` koşullu).
- **Mobil**: araç stoğu cache (`van-stock-cache`, senkronizasyonla replace-all), `parts.consume` outbox yürütücüsü (idempotency + kalıcı reddi çakışma görünümü), iş emri detayında parça paneli (çevrimdışı kuyruğa alır), `consumePart` eylemi.
- **Tohum**: demo kiracıya 2 depo, 3 kalem (toplu/parti/seri), 2 lot, 5 deterministik hareket (`movementKey` sabit UUID'ler — tekrar seed'te çift yazım yok).
- **Storybook**: `QuantityInput` (4 ondalık girdi, birim soneki, adım düğmeleri) + 4 hikâye (varsayılan/adım/geçersiz-devre dışı/ondalık sınırı) + etkileşim testleri; `ui-web.css` token'lı stiller.

## 2. Changed files (özet)

- `apps/api/prisma/schema.prisma` (+9 model, +5 enum), `migrations/20261110131850_phase09_inventory_van_stock_parts/migration.sql` (tablo + FK + indeks + NULLS NOT DISTINCT + **9 tablo RLS FORCE**).
- `packages/contracts/src/inventory.ts` (yeni), `inventory.test.ts` (yeni), `execution.ts` (rapor `parts`+`partsCostMinor`), `index.ts`.
- `apps/api/src/inventory/` (yeni modül: `inventory-engine.ts` + test, `inventory-views.ts`, `inventory.service.ts`, `work-order-parts.service.ts`, `inventory.controller.ts`, `work-order-parts.controller.ts`, `inventory.module.ts`), `app.module.ts`, `execution/execution.service.ts` (rapor parça bölümü), `common/error-envelope.filter.ts` (güvenli ayrıntı allowlist'ine `available/requested/lotId/countId/reservationId`), `prisma/seed.ts` (seedDemoInventory).
- `packages/api-client/src/inventory-client.ts` (yeni), `index.ts`.
- `packages/ui-web/src/components/quantity-input.{tsx,stories.tsx,test.tsx}`, `ui-web.css`, `index.ts`.
- `apps/web`: `app/app/inventory/**` (4 sayfa + 3 form), `work-orders/[id]/parts-panel.tsx`, `page.tsx`, `report/page.tsx`, `app/app/layout.tsx` (nav), `src/components/shell-frame.tsx` (nav yolu), `e2e/inventory.spec.ts` (yeni), `e2e/dispatch.spec.ts` (pano tarihi kiracı saat dilimine alındı — TEST-09 §8 sınır düzeltmesi).
- `apps/mobile`: `src/api/client.ts` (listVanStock/consumePart), `src/sync/outbox-executors.ts` (+parts.consume), `src/screens/execution-actions.ts` (+consumePart), `src/sync/sync-service.ts` (+vanStock best-effort), `src/cache/van-stock-cache.ts`+test, `src/components/parts-panel.tsx`+test, `screens/work-order-detail-screen.tsx`, önceden var olan 3 tip hatası `execution-actions.test.ts`'te düzeltildi.
- `docs/`: ADR-0011, bu rapor, `STATUS.md`, `CHANGELOG.md`.

## 3. Architecture decisions

ADR-0011 (özet): append-only defter + transactional bakiye; iki katmanlı çift hareket engeli (movementKey tekil + idempotency_keys); satır kilidi (`SELECT … FOR UPDATE`) ile negatif stok kapısı — onaylı tek negatif yol sayım kapanışı ADJUSTMENT; CONSUME yalnız iş emri iç geçidinden; maliyet lot'tan donar; sayım iki aşamalı, kapanışta tek düzeltme.

## 4. Migration details

- `20261110131850_phase09_inventory_van_stock_parts` — 9 tablo, 5 enum, FK'lar (tenant/item/lot/warehouse/work_order/user), performans indeksleri; **NULLS NOT DISTINCT** tekil indeksler (`stock_balances`, `stock_count_lines` — lot'suz satır tekilleştirme); **9 tablo RLS FORCE** (`pg_class` kanıtı: 9/9 `relrowsecurity ∧ relforcerowsecurity` — entegrasyon testi T-09-33).
- `prisma validate` ✓; `migrate deploy` ✓; `migrate status`: "Database schema is up to date!" (8 migration).

## 5. Commands and exact results

Ortam: Linux sandbox; Node v24.22.2; pnpm 9.15.9; PostgreSQL 18 (embedded, native), Redis 7, RustFS 1.0.4 (Docker yok — `infra/native`).

| Komut | Sonuç |
|---|---|
| `pnpm format` | ✓ (değişiklik yok — temiz) |
| `pnpm lint` | ✓ 0 hata (3 kullanılmayan sembol düzeltildi) |
| `pnpm typecheck` | ✓ 14/14 paket (0 hata) |
| `pnpm build` | ✓ 8/8 task (api/web/mobile/worker/paketler) |
| `pnpm test` (birim) | ✓ **538 test**: contracts 56 (+16) · api 192 (+22: engine 30 içerir) · ui-web 109 (+5) · mobile 111 (+12) · web 19 · api-client 21 (+21 dosya düzeyi) · shared 18 · worker 9 · design-tokens 3 |
| `pnpm test:integration` | ✓ **190/190** (10 dosya; +33 stok senaryosu) |
| `pnpm --filter @teknikflow/ui-web test:storybook` | ✓ **75/75** (17 dosya; +4 QuantityInput hikâyesi) |
| `npx playwright test` (apps/web) | ✓ **43/43** (chromium; +5 stok E2E) |
| `pnpm --filter @teknikflow/mobile test` | ✓ **111/111** (18 dosya; +10: parts panel 6, van cache 2, executor 4) |
| `pnpm db:validate` / `migrate status` | ✓ şema geçerli; "Database schema is up to date!" |
| Bağımlılık güvenlik taraması | Bu fazda yeni runtime bağımlılığı eklenmedi (mevcut pnpm audit temizliği Faz 01'de kuruldu) |

**TEST-09 kabul ölçütleri → kanıt (entegrasyon testi satır referansları):**

| Kabul ölçütü | Kanıt |
|---|---|
| No duplicate movement | Aynı `movementKey` ikinci gönderim → `x-idempotent-replay: true`, DB'de 1 satır, bakiye değişmez (T: "aynı movementKey ile tekrar"); iş emri parçasında idempotency oynatma (T: "aynı idempotency anahtarıyla ikinci gönderim") |
| No unapproved negative stock | TRANSFER aşımı → 409 `NEGATIVE_STOCK_FORBIDDEN` + `details.available`, defterde yarım yazma yok; araç aşımı aynı; rezervasyon kilidi serbest tüketimi engeller; ADJUSTMENT (sayım) onaylı tek negatif yol — `stock:manage_limited` genel uçta düzeltme yazamaz (servis yetki denetimi) |
| Serial/lot traceability | LOT'suz hareket 409 `LOT_REQUIRED`; hareket detayı `lotNo` taşır; lot bağlı bakiye satırı; süresi geçmiş lot 409 `LOT_EXPIRED`; SERIAL kesirli miktar 409 `SERIAL_QUANTITY_INVALID` |
| Atomic consume | Tüketim 201 → bakiye + iş emri olayı + parça listesi + rapor maliyeti tutarlı; aşım → 409 + bakiye VE defter sayacı değişmez |
| Offline conflict visible | Mobil `parts.consume` yürütücüsü 409 → `retryable=false` + mesaj → outbox 24 saat dondurma + teknisyene çakışma görünümü (executor testi + OFFLINE_SYNC ilkesi); çevrimdışı tüketim "Kuyruğa alındı" dürüst bilgilendirme (RNTL) |
| Cross-tenant inventory denial | B token'la A kalemi 404; A deposuna hareket 404; B bakiye listesinde A SKU'su yok; RLS FORCE pg_class 9/9; B bağlamında A hareket satırı görünmez |
| RBAC | Teknisyen kalem oluşturamaz (403); teknisyen merkez depodan tüketemez (403); atanmamış teknisyen iş emrine parça yazamaz (403); `stock:manage_limited` ADJUSTMENT 403 |

## 6. Web/mobile test coverage (özet)

- **E2E (5 yeni)**: genel bakış metrikleri + defter; katalog arama süzgeci; depo listesi (araç stoğu); hareket formu RECEIVE → 201 → yenilemede kalıcı + katalog toplamı artışı; raporda parça bölümü varlığı.
- **Mobil (10 yeni)**: parça paneli (liste/lot zorunlu/çevrimdışı kuyruk/rapor maliyeti/boş durum/kapalı iş emri gizleme), van cache (replace-all + kullanıcı izolasyonu), executor (anahtar taşıma/kalıcı reddi/replay).
- **Storybook (4 yeni)**: yazım ondalık sınırı, adım düğmeleri, geçersiz/devre dışı durumlar.

## 7. Known limitations

1. **Sayım aralık hareketleri**: satır gönderimi ile kapanış arasındaki ara hareketler `expectedQty` dondurulmuş değere göre düzeltme üretir; kapanış sonrası bakiye "sayılan" değere birebir eşit olmayabilir (ADR-0011 §5 Consequences). Kapanış anında yeniden kilit + hedefe çekme ileride eklenebilir.
2. **Satın alma siparişleri (PurchaseOrder/Supplier/ReplenishmentRequest)**: DATA_MODEL'de tanımlı ama faz kapsamında değil (prompt brief'i saymıyor) — Ticari akışla (Faz 11) değerlendirilecek; RECEIVE hareketi bugün manuel/ithalat girişi olarak çalışır.
3. **Maestro (mobil E2E)**: emülatörsüz sandbox'ta yürütülemedi — **BLOCKED** (Faz 07'den kalıntı; RNTL kapsamı mobil akışları karşılar).
4. **OpenAPI üretimi**: API_CONVENTIONS "CI'da OpenAPI üretimi ve kırılmazlık denetimi" hedefi ortak altyapıdır; bu fazda zod sözleşmeleri (istek/yanıt tek gerçeklik) + tip uygunluk testleriyle karşılanır — ayrı OpenAPI artefaktı üretim altyapısı henüz yok (Faz 01'den beri bilinen toplu kalıntı).
5. **`stock:issue_own` deployer dışı kendi aracı kısıtı**: teknisyen başka bir araç deposuna RETURN/ISSUE yazamaz (kaynak=araç koruması servis katmanında); kiracı geneli transfer için `stock:manage` gerekir.
6. **k6 performans senaryosu**: API kapasite profili bu fazda değişmedi (liste uçları sayfalı + indeksli; hareket uçları tek satır transaction) — k6 çalıştırılmadı (TEST-09 §8 "if changed" koşulu).

## 8. Next phase dependencies

- Faz 10 (Önleyici bakım) iş emirleri bu fazın CONSUME ucunu (kalıp yağ değişimi vb.) ve sayım penceresi bildirimlerini kullanabilir.
- Faz 11 (Teklif/gider): parça maliyeti `partsCostMinor`/`unitCostMinor` ile faturalanabilir iş kalemi kaynağı hazır; satın alma siparişleri bu fazın RECEIVE hareketiyle hizalanmalı.
- Faz 12 (Portal): rapor sayfasındaki parça tablosu müşteriye açılırken `costMinor` alanları gizlenmelidir (maliyet müşteri görünümüne sızmamalı).
