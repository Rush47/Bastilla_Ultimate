import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MCPServerManager, MCP_TOOLS } from "../server/mcp";

test("MCP server lists registered tools", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bastilla-mcp-"));
  const dbPath = path.join(tmp, "bastilla.db");
  try {
    const manager = new MCPServerManager(path.resolve(import.meta.dirname, ".."), dbPath);
    const listing = manager.listTools();
    assert.equal(listing.ok, true);
    assert.equal(listing.tools.length, MCP_TOOLS.length);
    assert.equal(listing.tools.some((t) => t.name === "sqlite_query"), true);
    assert.equal(listing.tools.some((t) => t.name === "terminal_exec"), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("MCP server executes terminal_exec and git_status securely", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bastilla-mcp-"));
  const dbPath = path.join(tmp, "bastilla.db");
  try {
    const manager = new MCPServerManager(path.resolve(import.meta.dirname, ".."), dbPath);
    const res = manager.executeTool("git_status", {}, "364_OMNIKLUCZ_ROOT");
    assert.equal(res.ok, true);
    assert.equal(typeof res.branch, "string");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
