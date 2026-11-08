# ADR-0006: Faturalama Sağlayıcı Soyutlaması
- Status: Proposed
- Date: 2026-11-09

## Context
SaaS abonelik/faturalama, Türkiye'de sağlayıcı/sözleşme/vergi koşullarına tabi. `docs/ARCHITECTURE.md` + `docs/BILLING_AND_PLANS.md`: `BillingProvider` arayüzü, geliştirmede mock sağlayıcı, imzalı + idempotent + replay-safe webhook'lar, abonelik durum makinesi (`trialing → active → past_due → grace_period → suspended`, `active → canceled`), sunucu tarafında hesaplanan entitlement'lar, plan verisi konfigüre edilir (kodda sabit değil).

## Decision
1. **`BillingProvider` arayüzü (adapter deseni):** createCustomer, createCheckout/PaymentIntent, changeSubscription, cancelSubscription, fetchSubscription, verifyWebhook, parseWebhook. Gerçek sağlayıcı seçimi `BILLING_PROVIDER` env'i ile yapılır; MVP/geliştirme ortamında **MockBillingProvider** deterministik test senaryoları üretir.
2. **Webbook güvenliği:** imza + zaman damgası doğrulaması; provider event ID ile dedupe (`ProviderWebhookEvent` tablosunda unique); replay koruması; ödeme başarısı yalnızca doğrulanmış webhook veya sunucu tarafı mutabakat (reconciliation) ile kesinleşir — frontend yönlendirmesi kanıt sayılmaz.
3. **Abonelik durum makinesi:** durum geçişleri domain katmanında açık kurallarla; her değişiklik kaynak ve provider event ID ile kayıt altına alınır. Deneme süresi, plan değişikliği, grace period, seat artışı (anında) / azaltması (yenilemede) yapılandırılabilir.
4. **Entitlement'lar:** `PlanEntitlement(key, value, unit, hard/soft limit)` veri olarak tutulur; `EntitlementService` abonelik durumu + seat + kullanımı değerlendirip sunucu tarafında uygular. UI limitleri açıklar, uygulamaz.
5. **Koruyucu ilkeler:** downgrade veri/ek silmez; limit aşımı yaratmayı kısıtlar ve export yolu sunar. Ödeme başarısızlığında tenant verisi asla otomatik silinmez. Kart PAN/CVV saklanmaz; provider-hosted/tokenize akış kullanılır.

## Alternatives considered
- Doğrudan tek sağlayıcı entegrasyonu (hard-wire): Türkiye pazarı ve koşullar değişken; sağlayıcı değişimini pahalı yapar; reddedildi.
- Webhook'suz sadece istemci bildirimi: sahte ödeme bildirimi riski; reddedildi.
- Harici abonelik yönetim SaaS'i: tenant/entitlement modeli ürün çekirdeğinde kalması gereken iş mantığı (limitler API'de uygulanacak); kısmi yardımcı olabilir ama çekirdek soyutlama yine gerekli.

## Consequences
(+) Sağlayıcı bağımsızlığı; deterministik testler (mock provider); güvenli webhook hattı.
(−) Soyutlama katmanı bakım maliyeti; gerçek sağlayıcı seçimi canlıya çıkmadan ayrıca doğrulanmalı (sözleşme, vergi, webhook koşulları — Türkiye'deki güncel koşullar ayrı araştırma konusu).

## Security/tenant impact
Yüksek: webhook sızdırma/spoofing, replay, entitlement bypass tehditlerine karşı imza, dedupe, sunucu tarafı kontrol. Faturalama olayları audit logda; ödeme sırları loglanmaz.

## Migration/rollback considerations
Phase 14'te kurulur. Mock provider CI'da kalıcı; gerçek sağlayıcı adapter'ı ayrı faz/onay ile. Abonelik durumu migration'ları geri dönüşümlü tasarımlanır (veri kaybı yok).
