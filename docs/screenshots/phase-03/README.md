# Faz 03 Ekran Görüntüleri

TEST-03 görsel kanıtları — web dev sunucusu (:3000) + gerçek API (:4000) üzerinden Playwright/Chromium (2026-11-09). Tam rapor: `docs/reports/PHASE-03-REPORT.md`.

## Kimlik akışları

| Dosya | Açıklama |
|---|---|
| `web-login.png` | `/login` — ortalanmış kimlik kartı, marka, e-posta/parola |
| `web-login-error.png` | Yanlış parola → API'nin genel hata uyarısı (sayım azaltma) |
| `web-signup.png` | `/signup` — kiracı kaydı (onboarding): firma adı, ad soyad, e-posta, parola |

## Korumalı kabuk (owner oturumu)

| Dosya | Açıklama |
|---|---|
| `web-protected-overview.png` | `/app/overview` — oturumdan türetilen kabuk: kullanıcı adı/rolü, kiracı kırıntısı, yetkiye dayalı menü |
| `web-users.png` | `/app/users` — üye tablosu (rol/şube kapsamı/durum) + davet formu + bekleyen davetler |
| `web-users-invite-created.png` | Davet sonrası: tek kullanımlık bağlantı bloğu + başarı bildirimi |
| `web-branches.png` | `/app/branches` — şube listesi (IST-MRKZ/ANK-SRVS) + yeni şube formu |

## Rol sınırı ve mobil

| Dosya | Açıklama |
|---|---|
| `web-technician-denied.png` | Teknisyen `/app/users`'a URL ile girerse: yetki uyarısı + yönetim menüsü gizli |
| `web-mobile-overview.png` | Mobil 390px — korumalı kabuk, hamburger menü |
| `web-mobile-users.png` | Mobil — kullanıcı yönetimi tek sütun |

## Yeniden üretme

```bash
pnpm infra:native && pnpm db:migrate && pnpm db:seed && pnpm dev
# Playwright ile: apps/web :3000 üzerinden (deviceScaleFactor 2)
```
