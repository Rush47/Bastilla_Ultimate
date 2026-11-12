import readline from "node:readline";
import path from "node:path";
import { MCPServerManager } from "./mcp";

// Local stdio MCP bridge for an already authenticated Codex CLI.
// Codex login is independent from Bastilla's operator token.
const root = path.resolve(process.env.BASTILLA_PROJECT_ROOT || process.cwd());
const manager = new MCPServerManager(root, process.env.BASTILLA_DB_PATH || path.join(root, "data", "bastilla.db"));
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(value: unknown) { process.stdout.write(JSON.stringify(value) + "\n"); }
input.on("line", line => {
  if (!line.trim()) return;
  let request: any;
  try { request = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    send({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32600, message: "Invalid Request" } }); return;
  }
  if (request.id === undefined) return; // Notifications do not receive replies.
  const id = request.id;
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
  if (request.method === "initialize") {
    reply({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "bastilla-ultimate", version: "1.0.0" } }); return;
  }
  if (request.method === "ping") { reply({}); return; }
  if (request.method === "tools/list") {
    reply({ tools: manager.listTools().tools.map(t => ({
      name: t.name, description: t.description,
      inputSchema: { type: "object", properties: t.parameters.properties, ...(t.parameters.required ? { required: t.parameters.required } : {}) },
    })) }); return;
  }
  if (request.method === "tools/call") {
    const name = request.params?.name;
    if (typeof name !== "string" || !manager.listTools().tools.some(t => t.name === name)) {
      fail(-32602, "Unknown tool"); return;
    }
    try {
      const result = manager.executeTool(name, request.params?.arguments || {}, process.env.BASTILLA_API_TOKEN);
      reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch (error) {
      reply({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Tool failed" }] });
    }
    return;
  }
  fail(-32601, "Method not found");
});
