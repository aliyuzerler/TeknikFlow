# ADR-0002: Kimlik Doğrulama ve Oturum Stratejisi
- Status: Accepted (Phase 03 uygulaması)
- Date: 2026-11-09

## Context
Üç farklı istemci yüzeyi var: web paneli (tarayıcı), React Native mobil uygulama ve müşteri portalı (web). `docs/ARCHITECTURE.md` ve `docs/SECURITY_PRIVACY.md` şunları şart koşuyor: Argon2id parola hash'i, MFA-hazır hesap modeli, web'de HttpOnly+SameSite cookie + CSRF koruması, mobilde kısa ömürlü access token + dönen (rotating) refresh token, token ailesi yeniden kullanım tespiti, oturum listeleme/iptal, revoke-all-sessions.

## Decision
Tek `auth` modülü, iki oturum taşıyıcı tipi:

1. **Web (panel + müşteri portalı):** HttpOnly, Secure, SameSite=Lax cookie ile opak oturum. State-changing isteklerde CSRF token + Origin kontrolü. Oturum kaydı `Session` tablosunda; aktif oturumlar listelenebilir ve iptal edilebilir.
2. **Mobil:** kısa ömürlü access token (JWT, ~10 dk) + rotating refresh token aileleri (`RefreshTokenFamily`). Token'lar SecureStore/Keychain/Keystore'da. Yeniden kullanım tespitinde aile iptal edilir.
3. **Ortak:** Argon2id (güncel önerilen parametreler), e-posta doğrulama, hash'lenmiş tek kullanımlık sıfırlama/davet tokenları, genel (enumeration azaltıcı) auth hata mesajları, login/reset/invite/MFA uçlarında rate limit. MFA modeli hesapta hazır; platform admin için zorunlu, tenant owner için opsiyonel.
4. Tenant kimliği **daima** sunucu tarafında üyelik (membership) kaydından türetilir; istemciden gelen tenant kimliği yalnızız doğrulanan bir seçici olarak ele alınır (bkz. ADR-0003).
5. Platform destek erişimi (impersonation): neden kodlu, süreli, onaylı ve audit kayıtlı.

## Alternatives considered
- Her yerde JWT-only stateless: oturum iptali/revoke-all zorlaşır; CSRF/getting cookie faydaları kaybolur; reddedildi.
- Tek tip kimlik doğrulama (sadece cookie) mobil native istemcide CSRF gerektirmeyen, token tabanlı akışa göre daha hantal; reddedildi.
- Auth0/Clerk gibi dış IdP: MVP'de faturalama/tenant modeli ve Türkiye yerelleştirmesi için esneklik kaybı; maliyet; şimdilik ertelendi (ileri sürümde değerlendirilebilir).

## Consequences
(+) Her yüzey için en uygun güvenlik modeli; iptal edilebilir oturumlar; MFA geçişi hazır.
(−) İki taşıyıcı tipinin test yüzeyi büyür (CSRF, token rotasyonu, aile iptali testleri zorunlu).

## Security/tenant impact
Kritik. Kimlik bilgileri, access/refresh token ve imza içerikleri asla loglanmaz. Oturumdan türetilen tenant bağlamı tüm yetki kontrollerinin temelidir.

## Migration/rollback considerations
Phase 03'te kurulur. Token ömürleri/parametreler yapılandırılabilir tutulur; taşıyıcı tipi başına ayrı middleware olduğundan biri kaldırılsa diğeri çalışmaya devam eder.
