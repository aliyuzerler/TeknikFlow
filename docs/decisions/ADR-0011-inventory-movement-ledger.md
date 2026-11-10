# ADR-0011: Stok Hareket Defteri ve Bakiye Bakımı (Append-Only Ledger)

- Status: Accepted
- Date: 2026-11-10
- Phase: 09

## Context

Faz 09 katalog/SKU, depolar (merkez/şube/araç), parti/seri izleme, hareketler, rezervasyonlar, sayım (cycle count) ve iş emri parça tüketimini getirir. Zorlayıcı kısıtlar:

1. **Çift hareket kabul edilemez** — mobil saha ağı kopar (uçak modu, çift dokunuş, geç senkron); bir tüketimin deftere İKİ KEZ yazılması maliyeti ve stok gerçeğini bozar (J2 yolculuğu, OFFLINE_SYNC çatışma ilkesi).
2. **Negatif stok onaysız olamaz** —DATA_MODEL.md: "Enforce non-negative inventory by transaction and appropriate locking/version strategy; allow negative only if tenant policy explicitly permits and audit records it."
3. **Bakiye deftere tabi olmalı** — AGENTS.md değişkeni: "Inventory changes are append-only stock movements; never silently overwrite a stock balance. Balance is derived or transactionally maintained from movements."
4. **Atomik tüketim** — iş emri parça tüketimi tek işlemde: hareket + bakiye + rezervasyon kilidi + iş emri olayı; yarım yazma (hareket yazıldı bakiye kalmadı) yüzeyi kapalı olmalı.
5. **Eşzamanlılık** — iki teknisyen aynı araç stoğundan aynı anda tüketirse bakiye yarışı (lost update) kabul edilemez.

## Decision

### 1. Append-only defter + transactional bakiye (melez model)

- `stock_movements` **append-only**: satırlar asla güncellenmez/silinmez. Her satır `movement_type`, pozitif `quantity`, kiracı-geneli **işaretli** `quantity_delta` (RECEIVE +q, CONSUME −q, TRANSFER/ISSUE/RETURN 0 — küresel toplam değişmez, depo dengeleri from/to ile taşınır) ve iz referansı (`reference_type='work_order' | 'stock_count'`, `reference_id`) taşır.
- `stock_balances` (depo × kalem × lot) hareketle **AYNI transaction**'da güncellenir (AGENTS.md "transactionally maintained" koluna) — her listede defterden türetme maliyeti yerine O(1) okuma; denetim sorguları defterle bakiye tutarlılığını doğrulayabilir.
- `lot_id=null` satırlar (toplu/NONE kalemler) için **NULLS NOT DISTINCT** tekil indeksler migration'da elle kurulur (`stock_balances_wh_item_lot_key`, `stock_count_lines_count_item_lot_key`) — NULL'lu satır tekilleşir, eşzamanlı yaratım yarışı kapalıdır. Prisma şeması bu indeksleri üretmez (bilinçli drift — RLS ve kısmi indeksler Faz 03'ten beri aynı yöntemle migration'da kurulur).

### 2. Çift hareket engeli — iki katman

- **movementKey**: istemci üretimi UUID, `(tenantId, movementKey)` tekil indeks. Hızlı yol: aynı anahtar varsa satır oynatılır (`replayed=true` + `x-idempotent-replay` başlığı). Eşzamanlı yarışta kaybeden transaction'ın tamamı geri alınır (bakiye yarım yazma yok), kazananın satırı oynatılır.
- **idempotency_keys (Faz 08)**: iş emri parça ucunda aynı UUID hem API oynatma anahtarı hem movementKey olarak kullanılır — uçak modu kurtarmasında TEK defter satırı.

### 3. Negatif stok kapısı — satır kilidi ile

- OUT tarafı bakiye satırı `SELECT … FOR UPDATE` ile kilitlenir (`lockBalance`); `available = onHand − reservedQty` kontrolü kilit altında yapılır. Yetersizse **409 `NEGATIVE_STOCK_FORBIDDEN`** + `details.available/requested`.
- **Onaylı tek negatif yol** sayım kapanışı `ADJUSTMENT`'tır (OUT yönü kapıyı atlar; bakiye satırı yoksa negatif değerle yaratılır) — sayım fiziksel gerçek bildirir ve `stock:manage` + audit kaydı ile denetlenir. Genel hareket ucunda ADJUSTMENT yalnız `stock:manage` (ROLES_PERMISSIONS "Limited" planlamacı düzeltme yazamaz).
- Rezervasyon içi tüketim serbest bakiyeyi değil KİLİDİ düşürür (`reservedQty` azalır) — rezervasyon sahibi dışındaki tüketim rezerve stoku yiyemez.

### 4. Atomik iş emri tüketimi — iç geçit

- CONSUME hareketi genel `/inventory/movements` ucunda **sözleşme düzeyinde yasak** (z.enum'da yok) + motor `isGenericEndpointType` savunması. Tek yol `POST /work-orders/:id/parts` (`work-order-parts.service`), `InventoryService.applyMovementForParts` iç geçidinden geçer: hareket + bakiye + rezervasyon ilerlemesi + `work_order.part_consumed` olayı + audit TEK kiracı transaction'ında.
- Depo çözümü: `warehouseId` verilmezse teknisyenin **kendi araç deposu** (VEHICLE, `assignedToId=kullanıcı`) otomatik seçilir; `stock:manage` olmadan başka depo seçimi 403 (ROLES "Assigned van issue/use").
- Lot/seri: LOT/SERIAL izleme modunda `lotId` zorunlu (409 `LOT_REQUIRED`), NONE'da lot yasak (409 `LOT_FORBIDDEN`), SERIAL'de miktar tam sayı (409 `SERIAL_QUANTITY_INVALID`), süresi geçmiş lot tüm hareket türlerine kapalı (409 `LOT_EXPIRED` — sayım düzeltmesi hariç: fire yazımı gerekir).
- Maliyet: tüketim anında lot `costMinor` hareket satırına **donar** (`unitCostMinor`); rapor `partsCostMinor = Σ quantity × unitCost` (kuruş tam sayı — asla float).

### 5. Sayım — iki aşamalı, kapanışta tek düzeltme

- `StockCount` OPEN → satırlar toplanır (beklenen miktar SUNUCUDA satır anındaki bakiyeden dondurulur); aynı (kalem, lot) ikinci gönderim son gözlemi günceller (append yok — sayım anlık gözlemdir).
- CLOSE: sayılmış satırlar için `ADJUSTMENT` hareketleri TEK transaction'da üretilir (kısmi kapanış yok); sayılmayan satır düzeltmez; kapalı sayıma satır/kapanış 409.

## Consequences

- (+) Çift hareket, yarım yazma ve bakiye yarışı üç yüzey kapalı; negatif stok yalnız denetlenmiş sayım yolundan.
- (+) Rapor/pano maliyeti defterden (CONSUME satırları) türetir — teknik borç yok.
- (−) Sayım satırı ile kapanış arası ara hareketler `expectedQty` dondurulmuş değere göre delta üretir; kapanış sonrası bakiye "sayılan" değere birebir eşit olmayabilir (ara hareketlerin etkisi korunur). Bu bilinçli sadeleştirme; ileride kapanış anında yeniden kilit + hedefe çekme ile geliştirilebilir (known limitation raporda).
- (−) Bakiye tablosu defterle tutarlılığı transaction disiplinine borçludur; doğrudan SQL güncellemesi denetimsiz tutarsızlık yaratabilir — yalnız servis katmanı yazmalıdır (RLS FORCE zaten kiracı dışını keser).

## Alternatives considered

- **Tam türetme (balance tablosu yok)**: her sorgu defterin toplamı — yazma yarışı yok ama liste/pano sorguları ağırlaşır ve negatif stok kapısı her okumada yeniden hesaplanır; transactional bakım + satır kilidi daha sade.
- **Tetikleyici (DB trigger) ile bakiye bakımı**: mantık veritabanına gömülür, servis katmanı ve testler körleşir; repo ilkesi iş mantığını domain servislerde tutar.
- **Sadece idempotency_keys (movementKey'siz)**: yarış kaybedeni anahtar kaydından oynar; iki farklı istemcinin aynı fiziksel işlemi iki anahtarla göndermesi engellenmez — defter tekil kısıtı ikinci savunmadır.
