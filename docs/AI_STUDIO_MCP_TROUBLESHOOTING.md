# Google AI Studio — MCP troubleshooting and architecture

Bastilla Ultimate must not require a local Linux process inside the AI Studio browser preview. A browser-only preview cannot spawn `codex mcp add`, execute `npx tsx server/mcp-stdio.ts`, or access a local Ollama daemon.

## Recommended topology

1. **Linux backend:** Run Bastilla's Express backend and local stdio MCP bridge. Configure `BASTILLA_API_TOKEN` in the backend environment. Keep Codex CLI login on this host only.
2. **Google AI Studio:** Use it for frontend development and Gemini integration. Point the frontend to the separately deployed backend over HTTPS, with explicit origin and authentication configuration.
3. **Fallback:** If MCP is unreachable, display "MCP unavailable" and preserve normal chat and queue functionality. Do not claim a successful handshake or agent execution.
4. **Codex:** `codex login status` verifies CLI authentication only, not availability of model requests. The CLI can be an MCP client but cannot donate its login session to arbitrary HTTP callers or Gemini.

## Diagnostics

After deploying the reviewed branch to the Linux host, authenticate to the backend and request `GET /api/mcp/status`. Its response distinguishes whether a token is configured and what tools are registered; `clientConnected: false` is a conservative placeholder, not a connection probe.

Test JSON-RPC locally (use a token from your secret store; never commit it):

```bash
curl -sS -X POST http://127.0.0.1:3000/api/mcp \
  -H "Authorization: Bearer $BASTILLA_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Adjust the port to your actual server port. The HTTP handler currently implements a JSON-RPC **subset**, not fully certified MCP Streamable HTTP, including transport session management and protocol negotiation. Do not register it as a fully compatible remote MCP endpoint until interoperability tests pass.

### Error matrix

| Symptom | Likely cause | Action |
| --- | --- | --- |
| HTTP 404 | Old deployment or wrong URL | Deploy branch and restart backend |
| HTTP 401 | Missing/invalid bearer token | Verify secret and API middleware |
| HTTP 403 | Origin mismatch or remote access without token | Configure backend URL and allowed origin |
| HTTP 415 | Missing JSON Content-Type | Set application/json |
| JSON-RPC -32601 | Unsupported method | Check client compatibility |
| CLI works but AI Studio fails | stdio is local-only | Use a separately deployed HTTPS backend |
| Codex 429 | Model usage limit | Wait or use Gemini/Ollama; MCP cannot bypass limits |

Never expose a token in the frontend bundle or Google AI Studio preview source. A browser-based integration needs an authenticated server-side proxy or session login. For production, use HTTPS and a narrowly scoped tool policy.
