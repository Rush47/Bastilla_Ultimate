# Bastilla MCP with an already signed-in Codex CLI

This integration uses **Codex CLI as the MCP client** and Bastilla as a local stdio MCP server. It does not consume an OpenAI API key for MCP itself. Model calls made by Codex remain subject to the ChatGPT/Codex plan limits.

## Setup

From the repository root, install dependencies and check authentication:

```bash
npm install
codex login status
```

Create a random Bastilla operator token **in your local environment or secret manager**. Do not commit it:

```bash
export BASTILLA_API_TOKEN="$(openssl rand -hex 32)"
```

Register the local stdio MCP server:

```bash
codex mcp add bastilla -- npx tsx server/mcp-stdio.ts
codex mcp list
```

Run Codex from the Bastilla repository root so that `server/mcp-stdio.ts` resolves correctly. The MCP child process inherits `BASTILLA_API_TOKEN` from the parent shell. For persistent setup, put the token in a local secret store or service environment, **not** in tracked configuration or the `codex mcp add` command arguments. Re-export the same token before starting Codex.

The bridge offers only `git_status` and `agent_memory_read`. No arbitrary terminal execution, SQL writes, Git push or privilege escalation is exposed. A separate `BASTILLA_API_TOKEN` is required even when `codex login status` reports successful ChatGPT login. This separation is intentional.

To test the stdio protocol without invoking the Codex model:

```bash
printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"local-test","version":"1"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | npx tsx server/mcp-stdio.ts
```

## HTTP variant

The Express backend also exposes `POST /api/mcp` on the feature branch, protected by its existing API security middleware. A valid bearer token is required for `tools/call`. The HTTP endpoint is not a substitute for the stdio bridge when the Codex client and repository are on the same host. It is a JSON-RPC subset; full Streamable HTTP interoperability is not yet certified.

## Troubleshooting

- `codex login status` shows login but requests return 403/429: Codex authentication succeeded, but model usage is unavailable or rate-limited; MCP cannot bypass this.
- `tools/call` reports authentication error: ensure `BASTILLA_API_TOKEN` is exported in the **same environment that launches Codex**.
- `git_status` fails: run from a Git checkout and confirm Git is installed.
- `agent_memory_read` returns an empty object: no persisted memory was found; this does not prove the agent is running.
- `/api/mcp` returns 404: deploy the feature branch or merge the reviewed PR and restart the Express backend; a frontend-only AI Studio preview cannot host this server.
