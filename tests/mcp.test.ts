import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MCPServerManager, MCP_TOOLS } from "../server/mcp";

test("MCP exposes only read-only allowlisted tools", () => {
  const manager = new MCPServerManager(path.resolve(import.meta.dirname, ".."), "/tmp/unused.db");
  const listing = manager.listTools();
  assert.equal(listing.ok, true);
  assert.deepEqual(listing.tools.map(t => t.name).sort(), ["agent_memory_read", "git_status"]);
  assert.equal(MCP_TOOLS.some(t => t.name === "terminal_exec" || t.name === "sqlite_query"), false);
});

test("MCP denies missing token, legacy magic tokens and unsupported tools", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bastilla-mcp-"));
  const oldToken = process.env.BASTILLA_API_TOKEN;
  process.env.BASTILLA_API_TOKEN = "test-operator-token-not-a-real-secret";
  try {
    const manager = new MCPServerManager(path.resolve(import.meta.dirname, ".."), path.join(tmp, "db"));
    assert.throws(() => manager.executeTool("git_status", {}), /authenticated/);
    assert.throws(() => manager.executeTool("git_status", {}, "364_OMNIKLUCZ_ROOT"), /authenticated/);
    assert.throws(() => manager.executeTool("terminal_exec", { command: "id" }, process.env.BASTILLA_API_TOKEN), /Unknown|Nieznane/);
    assert.throws(() => manager.executeTool("agent_memory_read", { agentId: "../secrets" }, process.env.BASTILLA_API_TOKEN), /Invalid agent/);
    const result = manager.executeTool("git_status", {}, process.env.BASTILLA_API_TOKEN);
    assert.equal(result.ok, true);
    assert.equal(typeof result.branch, "string");
  } finally {
    if (oldToken === undefined) delete process.env.BASTILLA_API_TOKEN;
    else process.env.BASTILLA_API_TOKEN = oldToken;
    rmSync(tmp, { recursive: true, force: true });
  }
});
