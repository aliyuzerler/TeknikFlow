# START HERE — TeknikFlow

You are taking ownership of the TeknikFlow codebase. This is an onboarding and planning step only. Do not build product features or skip directly into implementation.

1. Read `AGENTS.md`, `README.md`, all relevant `docs/`, `rules/` and `skills/`.
2. Inspect the repository. Confirm it is a clean project blueprint and identify any existing user code that must be preserved.
3. Create/update `docs/STATUS.md` with all 16 phases as Not Started.
4. Produce a concise technical execution plan and draft ADRs for: monorepo/tooling, auth/session strategy, tenant isolation, mobile offline sync, file storage and billing provider abstraction.
5. Confirm the required local environment (Node/pnpm, Docker, Android/iOS tooling) and list prerequisites. Do not install global tools without user approval.
6. Summarize architecture, folder structure, important product invariants, local run strategy and first phase acceptance gate.
7. Do not implement phase 01 yet. Stop and ask the user to start `prompts/phases/PHASE-01-workspace-and-infrastructure-foundation.md`.

When the user starts a phase prompt, follow `AGENTS.md` and the matching test prompt. One phase at a time; no fabricated test results.
