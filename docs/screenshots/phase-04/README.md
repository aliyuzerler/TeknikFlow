# Faz 04 Ekran Görüntüleri

TEST-04 görsel kanıtları — üretim derlemesi (`next start`, :3000) + gerçek API (:4000) üzerinden Playwright/Chromium (2026-11-09). Tam rapor: `docs/reports/PHASE-04-REPORT.md`.

## Müşteri kayıt defteri

| Dosya | Açıklama |
|---|---|
| `web-customers-list.png` | `/app/customers` — arama çubuğu, tablo (Müşteri/Tür/Kişi/Lokasyon/Ekipman/Durum), demo veriler |
| `web-customers-search.png` | "marmara" araması — normalize duyarlı filtrelenmiş sonuç |
| `web-customers-new-drawer.png` | Yeni müşteri çekmecesi (ad/tür/vergi/kişi alanları) |
| `web-customer-detail.png` | Müşteri detayı — bilgiler, zaman çizelgesi, kişiler, lokasyonlar, ekipmanlar |
| `web-asset-new-drawer.png` | Ekipman ekleme çekmecesi (etiket/seri/lokasyon/kritiklik) |

## Ekipman envanteri

| Dosya | Açıklama |
|---|---|
| `web-assets-registry.png` | `/app/assets` — kiracı geneli envanter (AST-DM etiketleri, kritiklik rozetleri) |
| `web-assets-filtered.png` | Kritiklik=Yüksek filtresi uygulanmış görünüm |
| `asset-qr-ast-dm001.svg` | Varlık QR kodu (SVG) — derin bağlantı /a/AST-DM001 taşır |

## Mobil (390px)

| Dosya | Açıklama |
|---|---|
| `web-mobile-customers.png` | Müşteri listesi tek sütun |
| `web-mobile-customer-detail.png` | Müşteri detayı yığılış düzen |

## Yeniden üretme

```bash
pnpm infra:native && pnpm db:migrate && pnpm db:seed
pnpm --filter @teknikflow/web build && pnpm --filter @teknikflow/web start &
# Playwright ile (viewport 1440x900 / 390x844, deviceScaleFactor 2)
```
