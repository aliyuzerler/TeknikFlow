# ADR-0001: Monorepo ve Araç Zinciri (pnpm + Turborepo)
- Status: Proposed
- Date: 2026-11-09

## Context
TeknikFlow dört uygulama (NestJS API, Next.js web, Expo mobil, worker) ve birden fazla paylaşılan paket (contracts, api-client, ui-web, design-tokens, config, shared) içeriyor. `docs/ARCHITECTURE.md` modüler monolit + ayrı kuyruk worker'ı öngörüyor; mikroservis erken aşamada reddedilmiş. Kod paylaşımı, tutarlı sürümleme ve tek komutla kalite kapısı (format/lint/typecheck/test/build) gerekiyor.

## Decision
pnpm workspaces + Turborepo ile tek repo (monorepo) kullanılır. Dizin düzeni README'deki öneriyle aynı olur:

```text
apps/{api,web,mobile,worker}
packages/{contracts,api-client,ui-web,design-tokens,config,shared}
infra/  # Docker Compose, CI, observability
```

- TypeScript strict, uçtan uca; tek formatter (Prettier) ve tek ESLint konfigürasyonu `packages/config` içinde paylaşılır.
- API testleri için tek runner (Vitest) seçilir ve proje boyunca tutarlı kalır (README: Jest/Vitest ikisinden biri).
- Paketler uygulamaların iç kodunu import edemez (bağımlılık yönü: apps → packages).
- CI: GitHub Actions; her PR'da format, lint, typecheck, unit, integration, build ve migration kontrolü.
- Sürümler resmi dokümantasyondan doğrulanarak sabitlenir; lockfile (pnpm-lock.yaml) commit edilir.

## Alternatives considered
- npm/yarn workspaces: daha yavaş kurulum, daha zayıf workspace protokolü; disk verimliliği için pnpm tercih edildi.
- Nx: güçlü ama daha ağır çerçeve; Turborepo daha az görüş bildirir ve mevcut plana yeterli.
- Ayrı repolar (polyrepo): paylaşılan sözleşmelerin sürüm senkronizasyonunu zorlaştırır; ekip boyutu için gerekmez.

## Consequences
(+) Tek kalite kapısı, tutarlı sözleşme paylaşımı, atomik çapraz-uygulama değişiklikleri.
(−) Repo boyutu ve CI süresi büyür (Turborepo önbelleğiyle yönetilir). pnpm kurulumu geliştirici ortamında ön koşul olur.

## Security/tenant impact
Doğrudan yok. `packages/contracts` içindeki Zod şemaları API sınırında doğrulama tek kaynağı olur; Prisma modelleri dışarı açılmaz.

## Migration/rollback considerations
Repo iskeleti Phase 01'de kurulur; araç zinciri değişikliği ileride gerekirse ADR ile kayıt altına alınır.
