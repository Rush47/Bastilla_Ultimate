# MCP incident history and recovery plan (2026-11-12)

This is a retrospective of previously observed integration failures, not proof of a current live deployment.

## What was already tried
- 2026-11-01: local MCP `initialize`, `tools/list` and `ping` returned HTTP 200. AI Studio URLs sometimes redirected HTTP 302 to a cookie/session gate; `/api/mcp` on other deployments returned 404.
- 2026-11-02: local health and JSON-RPC calls passed, but external Cloudflare DNS/connection and authenticated ChatGPT session were unverified.
- 2026-11-10: local `/mcp` and `/sse` tests succeeded in an earlier SVL/Bastilla project. Cloudflare Workers had a health route but no configured live Linux backend (`BACKEND_URL`/`BACKEND_TOKEN` absent). A temporary trycloudflare.com tunnel was unreliable.
- 2026-11-10: different components expected `MCP_AUTH_TOKEN` and `SVL_MCP_TOKEN`, producing inconsistent auth configuration. Cloud Run deployment was blocked by billing setup. An AI Studio preview is not a substitute for an always-on Linux/Ollama backend.
- 2026-11-12: Bastilla Ultimate's newly committed MCP module offered unsafe unrestricted tools and accepted absent or magic tokens. Draft PR #7 restricts the tool allowlist, requires `BASTILLA_API_TOKEN`, mounts `/api/mcp`, and adds a local stdio bridge.

These are observations across **different repositories and environments**. Do not assume earlier 12-tool results apply to Bastilla Ultimate, whose current allowlist has only two tools.

## Decision
Do not attempt to fix the preview by adding another unauthenticated public tunnel or copying CLI login tokens into browser JavaScript. Use local stdio MCP on the same Linux host as the signed-in Codex CLI. Keep `BASTILLA_API_TOKEN` server-side. AI Studio can display frontend and call a separately deployed authenticated API; it cannot inherit the host's CLI login.

## Verification gates
1. `npm run lint && npm test && npm run build` in a clean checkout of PR #7.
2. Local `npx tsx server/mcp-stdio.ts`: initialize, tools/list, ping, notification (no response), authenticated read-only tool call, denial without token.
3. `codex login status` then `codex mcp list` on the **same host**; this confirms registration, not model availability.
4. Backend `GET /api/mcp/status` and POST JSON-RPC over loopback with valid bearer; confirm missing token is rejected.
5. Remote HTTPS deployment: check that URL reaches the actual Express backend, no 302 cookie redirects, correct origin policy and no secret in browser code.
6. If a remote MCP client requires full Streamable HTTP, implement and test session/Accept/protocol behavior rather than claiming this JSON-RPC subset is compliant.
7. Do not merge until tests and review pass; no automatic main pushes.

## What remains unverified
No end-to-end AI Studio-to-Bastilla MCP connection, active Ollama, Gemini key, working autonomous Linux agents, or successful Codex inference is established by this PR.
