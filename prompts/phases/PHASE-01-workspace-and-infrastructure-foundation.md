# PHASE 01 — Workspace and infrastructure foundation

## Goal
Deliver only this phase. Read `AGENTS.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, relevant rules and skills before coding.

## Implementation brief
Build the pnpm/Turborepo monorepo, apps/api NestJS, apps/web Next.js, apps/mobile Expo React Native, apps/worker, shared packages, Docker Compose PostgreSQL/Redis/MinIO, env templates, health checks, CI and seeded demo workspace. Keep business features out.

## Required steps
1. Inspect current repository and `docs/STATUS.md`; identify completed work and gaps.
2. Confirm data ownership, tenant scope, roles, API contracts, UI states and acceptance criteria before coding.
3. Implement schema/migration, backend domain logic, API contract, web/mobile UI as relevant, telemetry/audit and documentation.
4. Add Storybook stories for every new shared UI component and interaction tests; update design preview if the shell changes.
5. Add unit, integration, API authorization, Playwright and mobile tests as relevant. Test the primary path and failure/edge paths.
6. Run format, lint, typecheck, unit, integration, Storybook, Playwright, mobile tests where relevant, migration check and production build.
7. Update OpenAPI, `docs/STATUS.md`, changelog, known limitations and next phase dependencies.

## Acceptance criteria
Workspace builds; local dependencies start; health endpoints respond; docs explain setup; lockfile and CI exist.

## Constraints
- Do not implement later phases unless a small prerequisite is required; document any prerequisite.
- Do not use mock data in production code paths. Seed data is for demo/test only.
- Do not bypass permissions or tenant filters to make UI work.
- Never disable failing tests to report success.
- No secrets or real customer data in fixtures.

## Final report
List changed files, architecture decisions, migration details, commands and exact test results, unresolved defects, and whether the phase gate is passed. If a tool or test could not run, say so explicitly.
