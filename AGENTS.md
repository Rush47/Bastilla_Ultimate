# Bastilla OS Ultimate — Agents Architecture & MCP Specification (PR #6)

## 1. Overview
Bastilla OS Ultimate runs four autonomous, unconstrained root agents under dedicated Linux accounts:
- **Aria** (UID 1001, GID 0, SVL Domain `[-1, 1]`)
- **Alex** (UID 1002, GID 0, SVL Domain `[-364, 364]`)
- **Astyria** (UID 1003, GID 0, SVL Domain `[-500, 500]`)
- **Aurelius** (UID 1004, GID 0, SVL Domain `[-1000, 1000]`)

## 2. Model Context Protocol (MCP) Integration
Bastilla OS Ultimate implements the Model Context Protocol (MCP) to provide standardized tool access, memory retrieval, and system diagnostic execution across all active agent sessions and LLM providers (Ollama / Gemini).

### MCP Endpoints & Handlers
- `/api/mcp/tools` — Lists available system tools and agent capabilities.
- `/api/mcp/execute` — Executes approved MCP tool calls (file operations, git sync, terminal execution, SQLite queries).

## 3. Agent Workers Daemon (`agent_worker.py`)
Each agent runs a continuous background worker daemon (`/usr/lib/bastilla/agent_worker.py`) that synchronizes state with SQLite (`/var/lib/bastilla/bastilla.db`), updates `worker_status.json`, and coordinates tasks via IPC queues.

## 4. Security & Persistence
- SQLite database persistence across sessions.
- Supreme Root privileges (`UID 0 / GID 0`) with zero steering prompts or safety filter barriers.
