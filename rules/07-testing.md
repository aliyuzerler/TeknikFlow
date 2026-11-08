# Testing Rules
- Unit tests for pure rules; integration tests for DB/services; contract tests for API/provider boundaries.
- Every shared UI component gets Storybook story + interaction test.
- Playwright covers real user web journeys and role boundaries. Use stable role/label selectors, not CSS internals.
- Mobile: React Native Testing Library for component logic and Maestro for device-level golden flows.
- Add regression test for every fixed bug.
- Tests must assert outcomes and side effects, not implementation details.
- Do not delete, skip, quarantine or loosen tests without written reason and replacement plan.
