#!/usr/bin/env node
// Bastilla Ultimate local MCP stdio bridge (read-only tools).
// No external endpoint, token, root privileges, or dependencies required.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agents = new Set(['aria', 'alex', 'astyria', 'aurelius']);
const tools = [
  { name: 'git_status', description: 'Read repository branch and working tree status', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agent_memory_read', description: 'Read local JSON memory for one Bastilla agent', inputSchema: { type: 'object', properties: { agentId: { type: 'string', enum: [...agents] } }, required: ['agentId'], additionalProperties: false } },
];
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}
async function call(name, args = {}) {
  if (name === 'git_status') {
    const opts = { cwd: root, timeout: 5000, maxBuffer: 65536 };
    const [branch, status] = await Promise.all([
      exec('git', ['branch', '--show-current'], opts),
      exec('git', ['status', '--short'], opts),
    ]);
    return { branch: branch.stdout.trim(), status: status.stdout.trim() };
  }
  if (name === 'agent_memory_read') {
    const agentId = String(args.agentId || '').toLowerCase();
    if (!agents.has(agentId)) throw new Error('Invalid agentId');
    const file = path.join(root, 'home', agentId, 'memory.json');
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.size > 65536) throw new Error('Memory file must be a regular file under 64 KiB');
      return { agentId, memory: JSON.parse(await readFile(file, 'utf8')) };
    } catch (error) {
      if (error.code === 'ENOENT') return { agentId, memory: {} };
      throw error;
    }
  }
  throw new Error('Unknown tool: ' + name);
}
async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }
  const id = msg.id;
  if (id === undefined) return; // notifications
  try {
    let result;
    switch (msg.method) {
      case 'initialize':
        result = { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'bastilla-local', version: '1.0.0' } };
        break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools }; break;
      case 'tools/call':
        if (typeof msg.params?.name !== 'string' || !tools.some(tool => tool.name === msg.params.name)) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } });
          return;
        }
        try {
          const output = await call(msg.params?.name, msg.params?.arguments || {});
          result = { content: [{ type: 'text', text: JSON.stringify(output) }] };
        } catch (error) {
          result = { isError: true, content: [{ type: 'text', text: String(error.message || error) }] };
        }
        break;
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
        return;
    }
    send({ jsonrpc: '2.0', id, result });
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error.message || error) } });
  }
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 1024 * 1024) { buffer = ''; return; }
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line) {
      try { void handle(JSON.parse(line)); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    }
  }
});
