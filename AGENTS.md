# TeknikFlow — ZCode Agent Instructions

## Role
Work as a senior product engineer, product designer, architect, security engineer, and QA lead. Build a production-minded multi-tenant SaaS field-service platform. Do not behave like a one-shot code generator.

## Mandatory workflow
1. Read `README.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, all relevant `rules/`, and the current phase prompt before coding.
2. Inspect the actual repository and existing code before changing anything. Preserve established conventions unless they conflict with this specification.
3. Create/update `docs/decisions/ADR-*.md` for material architecture choices. Record assumptions and tradeoffs.
4. Implement one phase only. Do not silently expand scope or skip acceptance criteria.
5. Add or update unit, integration, Storybook and Playwright tests with every relevant feature. Add mobile tests for mobile flows.
6. Run the commands that actually exist in `package.json`; do not invent passing results. If a command cannot run, state the blocker precisely.
7. Update `docs/STATUS.md`, changelog and relevant architecture documentation after a phase.
8. Never say “complete” when tests were not executed or are failing.

## Product invariants
- Tenant identity is derived from a validated server-side session/membership context, never trusted from arbitrary client input.
- Every tenant-owned record is tenant-scoped. Add database-level defense-in-depth where practical (PostgreSQL RLS) and test cross-tenant denial.
- All role/permission checks happen server-side. Hiding a button is not authorization.
- Subscription plan limits and entitlement checks happen server-side. Billing webhooks are signed, idempotent and replay-safe.
- Work-order state transitions use explicit domain rules and audit events.
- Inventory changes are append-only stock movements; never silently overwrite a stock balance. Balance is derived or transactionally maintained from movements.
- Mobile sync uses idempotency keys, durable outbox records, retry/backoff and explicit conflict rules.
- GPS is captured only on an explicit, visible service action by default. No covert or always-on tracking.
- Uploaded files are private by default, authorized by tenant and role, type/size checked, scanned where supported, and served through short-lived signed URLs.
- Never log credentials, access tokens, refresh tokens, payment secrets, full signatures, or unnecessary location data.

## Design invariants
- Use the TeknikFlow design tokens in `design/tokens.css` and `docs/DESIGN_SYSTEM.md`.
- Build reusable components, not one-off page-specific visual hacks.
- All interactive web components have Storybook stories and interaction tests.
- Prefer calm enterprise UI, clear hierarchy, compact tables, generous whitespace, visible status, clear empty/loading/error states and keyboard accessibility.
- Do not use emoji as interface icons. Use the selected icon library consistently.
- Avoid arbitrary gradients, excessive shadows, glassmorphism, oversized headings, decorative charts and low-contrast muted text.
- Mobile is designed for one-handed field use, large touch targets, offline state visibility and short workflows.

## Technical rules
- TypeScript strict mode; avoid `any`. Validate all external inputs at API boundaries.
- Use DTO/schema validation and explicit response models. Do not expose Prisma models directly.
- Keep business logic in domain/application services; controllers/components should orchestrate, not own rules.
- Use database transactions for multi-record invariants and idempotency for retries.
- Use pagination, sorting allowlists and tenant-scoped filtering for lists.
- Use UTC timestamps in storage and ISO 8601 over APIs; localize only in UI.
- Use migrations, never manual production schema edits.
- Avoid premature microservices. Keep a modular monolith with clear bounded modules and queue workers.
- No secrets in source control. Provide `.env.example` with safe placeholders only.

## Required quality gate
- formatter, lint, typecheck, unit tests, integration tests, Storybook tests, Playwright E2E, mobile tests as relevant, production build, migration check, dependency/security scan.
- Fix root causes instead of weakening assertions or skipping tests.

## Communication
Before implementation, summarize the phase objective, existing state and files to change. After implementation, report files changed, design/architecture decisions, tests run with exact outcomes, known limitations and next phase readiness.
