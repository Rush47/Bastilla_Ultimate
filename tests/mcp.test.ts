import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    assert.equal("branch" in result, true);
  } finally {
    if (oldToken === undefined) delete process.env.BASTILLA_API_TOKEN;
    else process.env.BASTILLA_API_TOKEN = oldToken;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MCP agent memory does not follow symlinks or read global fallback", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bastilla-mcp-memory-"));
  const oldToken = process.env.BASTILLA_API_TOKEN;
  process.env.BASTILLA_API_TOKEN = "test-operator-token-not-a-real-secret";
  try {
    const manager = new MCPServerManager(tmp, path.join(tmp, "db"));
    writeFileSync(path.join(tmp, "memory.json"), JSON.stringify({ secret: "global-not-for-agent" }));
    const empty = manager.executeTool("agent_memory_read", { agentId: "aria" }, process.env.BASTILLA_API_TOKEN);
    assert.deepEqual(empty, { ok: true, agentId: "aria", memory: {} });
    mkdirSync(path.join(tmp, "home", "aria"), { recursive: true });
    symlinkSync(path.join(tmp, "memory.json"), path.join(tmp, "home", "aria", "memory.json"));
    assert.throws(() => manager.executeTool("agent_memory_read", { agentId: "aria" }, process.env.BASTILLA_API_TOKEN), /regular file/);
  } finally {
    if (oldToken === undefined) delete process.env.BASTILLA_API_TOKEN;
    else process.env.BASTILLA_API_TOKEN = oldToken;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MCP stdio bridge handles initialize, notifications, ping, tools/list, and authenticated tools/call", async () => {
  const { execFileSync } = await import("node:child_process");
  const root = path.resolve(import.meta.dirname, "..");
  const inputLines = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "codex-cli", version: "0.120.0" } } }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "git_status", arguments: {} } }),
  ].join("\n") + "\n";

  // 1. Without BASTILLA_API_TOKEN: tools/call returns isError: true
  const outUnauth = execFileSync(process.execPath, ["--import", "tsx", path.join(root, "server/mcp-stdio.ts")], {
    cwd: root,
    input: inputLines,
    env: { ...process.env, BASTILLA_API_TOKEN: "" },
    encoding: "utf8",
  }).trim().split("\n").map(line => JSON.parse(line));

  assert.equal(outUnauth.length, 4); // notification produces no reply
  assert.equal(outUnauth[0].id, 1);
  assert.equal(outUnauth[0].result.protocolVersion, "2025-03-26");
  assert.equal(outUnauth[1].id, 2);
  assert.deepEqual(outUnauth[1].result, {});
  assert.equal(outUnauth[2].id, 3);
  assert.deepEqual(outUnauth[2].result.tools.map((t: any) => t.name).sort(), ["agent_memory_read", "git_status"]);
  assert.equal(outUnauth[3].id, 4);
  assert.equal(outUnauth[3].result.isError, true);

  // 2. With BASTILLA_API_TOKEN: tools/call succeeds
  const outAuth = execFileSync(process.execPath, ["--import", "tsx", path.join(root, "server/mcp-stdio.ts")], {
    cwd: root,
    input: inputLines,
    env: { ...process.env, BASTILLA_API_TOKEN: "stdio-test-operator-token-secret" },
    encoding: "utf8",
  }).trim().split("\n").map(line => JSON.parse(line));

  assert.equal(outAuth[3].id, 4);
  assert.equal(outAuth[3].result.isError, undefined);
  const parsedToolResult = JSON.parse(outAuth[3].result.content[0].text);
  assert.equal(parsedToolResult.ok, true);
  assert.equal(typeof parsedToolResult.branch, "string");
});
