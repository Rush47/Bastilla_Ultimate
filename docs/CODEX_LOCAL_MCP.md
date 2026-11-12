# Bastilla Ultimate — Codex CLI without Copilot

This repository configures a local MCP stdio server in `.codex/config.toml`.
No Cloud Run URL, Google Cloud account, Gemini key, or GitHub Copilot subscription is required to run the local MCP server.

## Start in GitHub Codespaces

```bash
git pull --ff-only origin main
node --version
node --test tests/mcp-stdio.test.mjs
npx codex mcp list
npx codex login
npx codex
```

The MCP server is launched by Codex as `node scripts/bastilla-mcp-stdio.mjs`. Its two read-only tools are:
- `git_status`: current branch and working tree status
- `agent_memory_read`: JSON memory from `home/{aria,alex,astyria,aurelius}/memory.json`

Codex CLI login is separate from the ChatGPT website's custom MCP connector feature. Logging in does not make the MCP server available inside the ChatGPT mobile application.

## Troubleshooting

- If `npx codex` cannot be found, run `npm install` in the repository and retry.
- If Codex cannot see the server, run `npx codex mcp list` from the repository root and inspect `.codex/config.toml`.
- If the smoke test fails, copy the error output. The test uses Node.js only and does not consume LLM tokens.
- The MCP bridge is read-only by design. Codex may edit repository files through its own file tools, subject to its normal approval controls.
- Do not commit authentication files, API keys, or `~/.codex/auth.json`.

## Mission after limits renew

Ask Codex to check `bastilla_local`, inspect Git status and each agent's memory, then review the Ollama backend, queue processing and GUI. Request a short diagnostic report and minimal targeted tests before making changes.
