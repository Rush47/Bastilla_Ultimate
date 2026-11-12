# AGENTS.md — Bastilla Ultimate

## Scope and source of truth
Repository: `Rush47/Bastilla_Ultimate`. Default branch: `main`.
This document applies to all contributors, including Gemini in Google AI Studio, Aria, Alex, Astyria and Aurelius. Follow the current repository implementation rather than assuming an AI Studio preview is deployed. Read `README.md`, `docs/AGENT_CONTROL_DESIGN.md` and `docs/DIAGNOSTICS_2026-11-12.md` before changes.

## Current verified architecture (as of 2026-11-12)
- Express/TypeScript server: `server.ts`; React/Vite frontend; SQLite persistence.
- Durable model-inference queue and mobile control panel landed in PR #5.
- `@openai/codex` CLI is installed as a dependency and login/status management exists; successful authentication status **does not** prove that model inference works.
- Queue supports Ollama or Gemini; no autonomous tool-execution worker is established merely by having agent profiles.
- Four agent names: Aria, Alex, Astyria, Aurelius. Their Linux users, independent processes, tools and GitHub permissions must be probed on the *actual deployment host*. Do not claim they exist or are online without proof.
- MCP previously returned HTTP 404 in diagnostics; do not label it fixed without protocol tests.
- The UI must remain usable on Android at 360px, 390px and 768px widths.

## Mission order
1. Preserve and verify runtime, database migrations, API authorization, existing mobile control panel.
2. Implement a minimal *real* MCP endpoint with `initialize`, `tools/list` and an allowlisted, auditable `tools/call`; require the same security policy as the operator API. Never expose unrestricted shell or secrets through MCP.
3. Implement isolated tool executors for agents, initially read-only diagnostics and test runs. Persist task ID, actor, action, exit code, timestamps and redacted logs. Distinguish process health, model availability and GitHub permissions.
4. Add explicit operator approval for any repository write, privileged operation, deployment or merge. Use a task branch and draft PR, not direct pushes to `main`.
5. Add integration tests and improve mobile diagnostics only after backend behavior is real.

## Constraints
- No fake responses, success percentages, account identities, installed model weights or synthetic telemetry presented as live data.
- No automatic privilege escalation, bypass of 403/429 limits, secret copying between Linux users, or disabling sandbox/security controls.
- Secrets only in environment or hosting secret storage; never commit `.env`, tokens or credentials.
- Preserve SQLite data and use additive migrations. Never delete snapshots/data without explicit review.
- Avoid unnecessary model calls: inspect changed files first, group independent file edits, reuse existing test fixtures and cache by commit SHA when safe.
- If a tool/provider is unavailable, record the actual error and mark it unavailable. Never silently fall back to a different model without reporting the provider used.

## Verification and delivery
Run `npm run lint`, `npm test`, `npm run build`, and `git diff --check` when possible. Record any skipped test and why. Do not claim host or model integration was tested when only fixtures ran.
Every implementation task must produce: changed paths, behavior before/after, tests with actual results, remaining deployment dependencies, and a draft PR. Do not merge automatically.

## Google AI Studio handoff
1. Sync latest `main` and review the open integration PR before editing.
2. Confirm whether the AI Studio environment supports backend processes and outbound connections; frontend preview alone is not a deployment.
3. Use `GEMINI_API_KEY` as a server secret if configured. Never ask to paste it into chat or source.
4. Prefer the existing queue and APIs. Implement small tested increments rather than generating a second backend.
5. Continue from the last verified commit without repeating PR #1, #2 or #5.
