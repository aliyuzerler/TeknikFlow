# Changelog

## 0.1.1 — Phase 01: Workspace and infrastructure foundation

- Monorepo iskeleti kuruldu: pnpm 9 workspace + Turborepo; `apps/{api,web,mobile,worker}`, `packages/{contracts,api-client,ui-web,design-tokens,config,shared}`, `infra/`.
- `apps/api`: NestJS + `/health/live` + `/health/ready` (DB/Redis/S3 hazırlık, 503-degraded), Zod ortam doğrulaması, hata zarfı filtresi, `x-request-id`; Prisma şeması + `20261109014316_init` migration (yalnızca `app_settings` — iş modelleri kendi fazlarında).
- `apps/worker`: heartbeat (Redis) + `:4001/health`. `apps/web`: Next.js durum/kurulum sayfası (5 servis kartı + 16 faz tablosu). `apps/mobile`: Expo yer tutucu (Faz 07+).
- Altyapı: `infra/docker-compose.yml` (PostgreSQL 18 / Redis 7 / RustFS — MinIO OSS Nisan 2026'da arşivlendi, ADR-0005) ve Docker'sız `pnpm infra:native` (embedded PostgreSQL + redis-memory-server + RustFS; root'suz).
- Kalite altyapısı: Prettier + project-aware ESLint (NestJS `emitDecoratorMetadata` uyumlu) + strict TS (`tsconfig.json` tam kapsam / `tsconfig.build.json` emit) + Vitest (68 birim) + 3 entegrasyon + 5 Playwright E2E + GitHub Actions CI (quality + integration işleri).
- TEST-01 kapısı: PASS (`docs/reports/PHASE-01-REPORT.md`).

## 0.1.0 — Project blueprint
- Added TeknikFlow brand working concept and enterprise design reference.
- Added product requirements, architecture, data model, role matrix, API conventions, security, privacy, offline sync, performance, billing and deployment guidance.
- Added 16 sequential implementation phases and 16 detailed independent test prompts.
- Added Playwright, Storybook, React Native Testing Library, Maestro and k6 testing strategy.
