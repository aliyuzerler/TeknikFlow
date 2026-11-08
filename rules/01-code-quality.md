# Code Quality Rules
- TypeScript strict; no implicit any; avoid `any` except at a guarded third-party boundary with a comment.
- ESLint + Prettier; consistent imports; small focused modules.
- Domain/application layer owns invariants. UI and controller contain no business policy.
- Validate every API request and external provider payload.
- Use typed errors and stable error codes.
- No silent catch, empty catch, disabled lint or ignored TypeScript errors to make CI green.
- Prefer composition, explicit dependencies and testable pure functions.
