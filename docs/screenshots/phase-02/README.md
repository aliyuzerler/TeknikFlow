# Faz 02 Ekran Görüntüleri

TEST-02 görsel kanıtları — üretim derlemesi (`next start`, :3000) ve Storybook statik sunumu (:6010) üzerinden Playwright/Chromium ile yakalandı (2026-11-09). Tam rapor: `docs/reports/PHASE-02-REPORT.md`.

## Web kabuğu (üretim derlemesi)

| Dosya | Açıklama |
|---|---|
| `web-overview-desktop.png` | `/app/overview` — 1440px: kenar çubuğu, üst çubuk, kırıntı, metrik kartları, iş emri tablosu, SLA/ekip panelleri (demo veri) |
| `web-overview-mobile.png` | `/app/overview` — 390px mobil kırılım: tek sütun, hamburger menü |
| `web-overview-mobile-drawer.png` | Mobil gezinme çekmecesi açık: marka + bölümü gezinme, karartma katmanı, kapat düğmesi |
| `web-status-page.png` | `/` durum sayfası: "Tüm sistemler hazır" bandı, 5 servis kartı (hepsi Çalışıyor), 16 faz tablosu (01-02 Tamamlandı) |

## Storybook (statik derleme)

| Dosya | Story |
|---|---|
| `storybook-app-shell.png` | `Kabuk/AppShell` — Yönetim Paneli Önizlemesi (1440px) |
| `storybook-app-shell-mobile.png` | `Kabuk/AppShell` — Mobil Görünüm (390px) |
| `storybook-side-drawer.png` | `Diyalog/Yan Panel` — açık çekmece (odak tuzağı + kapat düğmesi) |
| `storybook-confirm-dialog.png` | `Diyalog/Onay Kutusu` — açık onay diyaloğu (danger tonu) |
| `storybook-buttons.png` | `Temel/Düğme` — tüm varyantlar + yükleniyor durumu |
| `storybook-input-validation.png` | `Temel/Girdi` — doğrulama hatası durumu |
| `storybook-status-badges.png` | `Temel/Durum Rozeti` — tüm tonlar + ikonlu |
| `storybook-metric-cards.png` | `Yapı/Kart ve Panel` — metrik kartları |
| `storybook-data-table.png` | `Yapı/Veri Tablosu` — varsayılan tablo |
| `storybook-feedback-states.png` | `Yapı/Sayfa Yapıları` — boş/yükleniyor/hata geri bildirimleri |
| `storybook-brand.png` | `Yapı/Marka` — marka işareti + wordmark |

## Yeniden üretme

```bash
pnpm build && pnpm --filter @teknikflow/web start &          # :3000 üretim sunucusu
pnpm --filter @teknikflow/ui-web storybook:build
pnpm --filter @teknikflow/ui-web storybook:serve &           # :6010 statik Storybook
# Playwright ile sayfa görüntüleri (viewport 1440x900 / 390x844, deviceScaleFactor 2)
```
