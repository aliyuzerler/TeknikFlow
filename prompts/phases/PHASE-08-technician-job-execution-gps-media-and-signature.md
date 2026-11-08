# PHASE 08 — Technician job execution, GPS, media and signature

## Goal
Deliver only this phase. Read `AGENTS.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, relevant rules and skills before coding.

## Implementation brief
Implement accept/en-route/check-in/on-site/in-progress/completion flow, explicit GPS capture milestones, checklist, notes, time, photo/video, signature canvas, report preview and offline outbox.

## Required steps
1. Inspect current repository and `docs/STATUS.md`; identify completed work and gaps.
2. Confirm data ownership, tenant scope, roles, API contracts, UI states and acceptance criteria before coding.
3. Implement schema/migration, backend domain logic, API contract, web/mobile UI as relevant, telemetry/audit and documentation.
4. Add Storybook stories for every new shared UI component and interaction tests; update design preview if the shell changes.
5. Add unit, integration, API authorization, Playwright and mobile tests as relevant. Test the primary path and failure/edge paths.
6. Run format, lint, typecheck, unit, integration, Storybook, Playwright, mobile tests where relevant, migration check and production build.
7. Update OpenAPI, `docs/STATUS.md`, changelog, known limitations and next phase dependencies.

## Acceptance criteria
Permission denied/manual fallback, GPS accuracy metadata, airplane mode, duplicate sync, media retry and signature append-only behavior pass tests.

## Constraints
- Do not implement later phases unless a small prerequisite is required; document any prerequisite.
- Do not use mock data in production code paths. Seed data is for demo/test only.
- Do not bypass permissions or tenant filters to make UI work.
- Never disable failing tests to report success.
- No secrets or real customer data in fixtures.

## Final report
List changed files, architecture decisions, migration details, commands and exact test results, unresolved defects, and whether the phase gate is passed. If a tool or test could not run, say so explicitly.
