# TEST 09 — Inventory, van stock and parts consumption

Act as an independent QA lead. Do not modify production logic just to satisfy a test. Read the phase prompt, global Definition of Done and current implementation. First inspect package scripts and actual test setup; use only real commands from the repository.

## Test plan
1. **Static quality:** formatter check, ESLint, TypeScript typecheck, dependency/build check and migration validation.
2. **Unit tests:** cover domain rules, state transitions, validation, formatting, permission decisions and boundary values introduced in this phase.
3. **API/integration:** run against isolated test database/services; verify success, validation errors, forbidden/unauthorized, conflict, idempotent retry and transaction rollback.
4. **Tenant isolation:** create Tenant A and B. Attempt read/list/search/update/delete/export/download and background-job access across tenant boundaries. Every unauthorized attempt must fail without leaking existence or metadata.
5. **Storybook:** start Storybook in CI/test mode; render all changed components and their default/loading/empty/error/disabled/responsive states. Run interaction tests for primary actions, keyboard navigation, dialog focus and validation. Capture visual snapshots for changed core components where configured.
6. **Playwright web E2E:** run seeded test tenant on Chromium. Validate the complete user flow for this phase, refresh/reopen persistence, role boundary and responsive viewport (desktop + mobile web). Use accessible selectors. Capture trace, screenshot and console/network errors on failure. Run Firefox/WebKit smoke if configured.
7. **Mobile:** for mobile phases, run Jest + React Native Testing Library and Maestro on emulator/device. Include offline/airplane mode, process relaunch, permission denied, duplicate sync and low-network conditions as applicable. For non-mobile phases, run existing mobile smoke suite to detect regressions if the app is affected.
8. **Performance:** inspect query counts, list pagination, payload size, bundle change and slow paths. Run k6 scenario if API capacity or high-volume behavior changed.
9. **Security/accessibility:** inspect logs for secrets/PII, run configured SAST/dependency scan, keyboard/focus and contrast checks on affected UI.

## Phase-specific acceptance
No duplicate movement; no unapproved negative stock; serial/lot traceability; atomic consume; offline conflict visible; cross-tenant inventory denial.

## Negative and edge cases
- Empty data and long text/large customer name.
- Slow API, network loss, timeout and retry.
- Double-click/double-submit and replayed idempotency key.
- User without permission and user from another tenant.
- Stale version/concurrent update where relevant.
- Locale/timezone and daylight-saving boundaries where dates are used.

## Output format
Provide a test matrix with: Test ID, scenario, expected result, actual result, status, evidence path. Summarize exact commands, pass/fail/skipped counts, browser/device versions and environment. List defects by severity with reproducible steps. The phase is **PASS** only if all critical acceptance tests pass and no critical/high defect remains. Otherwise mark **FAIL/BLOCKED** and provide the smallest remediation plan. Never fabricate test results.
