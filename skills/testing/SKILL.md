# Skill: Quality Engineering

## Test pyramid
- Unit: domain rules, formatters, permissions, state machines.
- Integration: API + real test DB, queue, storage adapter.
- Storybook: render states and interaction; accessibility checks where tooling supports.
- Playwright: web end-to-end; Chromium primary, Firefox/WebKit smoke when supported.
- Mobile: Jest/RNTL + Maestro device workflows.
- Contract: OpenAPI/schema and provider webhook fixtures.

## Playwright rules
Use `getByRole`, `getByLabel`, `getByTestId` only when semantic selectors are not viable. Use isolated seeded tenants and test users. Validate cross-tenant access denial, billing entitlements and core work-order journey. Capture trace on failure.

## Storybook rules
Every design-system component has stories for default, variants, loading, disabled, error and responsive where relevant. Add interaction tests for form validation, menu/dialog, table selection, upload states, offline banner and status changes. Test keyboard focus and accessible labels.

## Reporting
Report test command, test count, pass/fail/skipped, browser/device, environment, and blocker. Never fabricate output.
