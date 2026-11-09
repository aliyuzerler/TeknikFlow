# ADR-0003: Tenant İzolasyonu Stratejisi
- Status: Accepted (Phase 03 uygulaması)
- Date: 2026-11-09

## Context
TeknikFlow çok kiracılı (multi-tenant) bir SaaS. Aynı veritabanında farklı firmaların (tenant) verileri saklanacak. `docs/ARCHITECTURE.md` ve `docs/SECURITY_PRIVACY.md` gereksinimleri: her tenant kaydında `tenant_id NOT NULL`, sunucu tarafında üyelikten türetilen tenant bağlamı, composite unique key'ler `(tenant_id, business_key)`, yüksek riskli tablolarda PostgreSQL RLS savunma derinliği, zorunlu çapraz-tenant testleri (IDOR dahil).

## Decision
**Paylaşımlı şema + `tenant_id` sütunu** modeli, üç katmanlı savunma ile:

1. **Uygulama katmanı (birincil):** Tenant bağlamı, doğrulanmış oturum/üyelik kaydından request-scoped bir `TenantContext` olarak kurulur. Tüm Prisma erişimi tenant-scoped repository / uygulama servisi üzerinden yapılır; ham global sorgu yasaklanır (lint kuralı + kod incelemesi).
2. **Veritabanı katmanı (savunma derinliği):** Yüksek riskli tenant tablolarında (work order, müşteri, varlık, dosya, faturalama) PostgreSQL Row-Level Security (RLS) etkinleştirilir; `app.current_tenant_id` session değişkeni ile bağlantı başına scope'lanır. Prisma, transaction içinde değişkeni ayarlayan scoped client kullanır.
3. **Şema kuralları:** Tüm tenant-owned tablolarda `tenant_id` + composite index'ler `(tenant_id, status, created_at)` vb.; iş anahtarlı unique constraint'ler composite `(tenant_id, work_order_no)`, `(tenant_id, sku)`, `(tenant_id, asset_tag)`. Arka plan işleri tenant ID taşır ve işletim anında üyeliği yeniden doğrular.

Çapraz-tenant reddi testleri CRUD, arama, dosya indirme, export, job ve billing yüzeylerinde zorunludur.

## Alternatives considered
- Tenant başına ayrı veritabanı/şema: izolasyon güçlü ama migration/backup/operasyon yükü 16 fazlık MVP'de ağır; bağlantu havuzu karmaşası; reddedildi (Enterprise "dedicated deployment" opsiyonu ileride değerlendirilebilir).
- Sadece uygulama katmanı filtrelemesi (RLS yok): tek hata tüm tenant verisini sızdırabilir; savunma derinliği isteği karşılanmaz.
- Postgres dışı NoSQL: ilişkisel bütünlük (stok hareketleri, iş emri geçmişi) ve RLS ihtiyacı nedeniyle uygun değil.

## Consequences
(+) Operasyonel basitlik, tek migration hattı, çapraz-tenant analitik/platform admin için pratik.
(−) RLS + Prisma entegrasyonu dikkat ister (pool'lanmış bağlantıda session değişkeni transaction'a bağlı olmalı); test veritabanında RLS senaryoları da kurulmalı.

## Security/tenant impact
Kritik — ürünün en önemli güvenlik gereksinimi. IDOR ve çapraz-tenant erişim testleri her fazın kalite kapısına dahildir.

## Migration/rollback considerations
Phase 03'te kurulur; RLS ilk aşamada yüksek riskli tablolara uygulanır, kademeli genişletilir. RLS politikaları migration ile yönetilir; geri almak şema migration'ı ister.
