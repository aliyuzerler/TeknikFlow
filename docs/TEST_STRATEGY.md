# Test Strategy

## Tooling decision
- Web/unit: Vitest + React Testing Library (or Jest if the selected framework requires it; choose one and document ADR).
- API: Jest or Vitest + Supertest; integration with disposable PostgreSQL.
- Storybook: Storybook 8+ or compatible current stable release with `@storybook/addon-vitest` / test runner path verified at setup. Confirm official docs at implementation time; do not mix deprecated runners.
- Web E2E: Playwright.
- Mobile unit/component: Jest + React Native Testing Library.
- Mobile device E2E: Maestro.
- Load: k6.

## Required Playwright suites
1. Tenant owner signup, onboarding, invite teammate and seat limit.
2. Dispatcher receives request, creates/assigns work order, moves it on board.
3. Technician mobile/web fallback sees only assigned jobs.
4. Customer portal request, quote approval and service report access.
5. Inventory stock reservation/consumption and duplicate-submit protection.
6. Billing plan/seat change and entitlement rejection.
7. Cross-tenant denial on route, API, search, file and export.

## Required Storybook coverage
- Design primitives: color/tokens, typography, spacing, icon, button, input, select, date picker.
- Patterns: sidebar, topbar, metric card, data table, filter bar, status badge, timeline, drawer, confirm dialog, empty/error/skeleton, upload dropzone, signature pad, offline banner and sync status.
- Interaction tests: validation, selection, keyboard navigation, modal open/close, error retry, file validation and offline/conflict variants.

## CI gates
PR: format, lint, typecheck, unit, API integration, Storybook interaction, Playwright critical E2E, mobile checks when relevant, build and security/dependency scan. Nightly: wider browser/device matrix, k6 smoke, visual snapshots and full regression.
