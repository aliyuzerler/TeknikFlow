# PHASE 03 — Identity, tenant isolation, RBAC and onboarding

## Goal
Deliver only this phase. Read `AGENTS.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, relevant rules and skills before coding.

## Implementation brief
Implement tenant signup/invitation, auth/session, memberships, branch setup, roles/permissions, branch/resource scopes, plan entitlement skeleton, platform admin separation and audit logging. Add server-derived tenant context and PostgreSQL RLS defense-in-depth for selected core tables.

## Required steps
1. Inspect current repository and `docs/STATUS.md`; identify completed work and gaps.
2. Confirm data ownership, tenant scope, roles, API contracts, UI states and acceptance criteria before coding.
3. Implement schema/migration, backend domain logic, API contract, web/mobile UI as relevant, telemetry/audit and documentation.
4. Add Storybook stories for every new shared UI component and interaction tests; update design preview if the shell changes.
5. Add unit, integration, API authorization, Playwright and mobile tests as relevant. Test the primary path and failure/edge paths.
6. Run format, lint, typecheck, unit, integration, Storybook, Playwright, mobile tests where relevant, migration check and production build.
7. Update OpenAPI, `docs/STATUS.md`, changelog, known limitations and next phase dependencies.

## Acceptance criteria
Auth flows work; permission matrix enforced server-side; all CRUD/search/file test routes reject cross-tenant access; session revoke works.

## Constraints
- Do not implement later phases unless a small prerequisite is required; document any prerequisite.
- Do not use mock data in production code paths. Seed data is for demo/test only.
- Do not bypass permissions or tenant filters to make UI work.
- Never disable failing tests to report success.
- No secrets or real customer data in fixtures.

## Final report
List changed files, architecture decisions, migration details, commands and exact test results, unresolved defects, and whether the phase gate is passed. If a tool or test could not run, say so explicitly.
