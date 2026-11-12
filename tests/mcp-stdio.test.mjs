// Minimal MCP stdio smoke test; no OpenAI API, Copilot or cloud credentials.
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('local Bastilla MCP initializes and exposes safe tools', async (t) => {
  const child = spawn(process.execPath, ['scripts/bastilla-mcp-stdio.mjs'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); });
  let buffer = '';
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', data => { stderr += String(data).slice(0, 1000); });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let pos;
    while ((pos = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 1);
      try {
        const message = JSON.parse(line);
        const resolve = pending.get(message.id);
        if (resolve) { pending.delete(message.id); resolve(message); }
      } catch { /* let assertions report malformed output via timeout */ }
    }
  });
  let nextId = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('MCP timeout: ' + method + '; stderr=' + stderr));
    }, 5000);
    pending.set(id, value => { clearTimeout(timeout); resolve(value); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const init = await request('initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'bastilla-smoke-test', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'bastilla-local');
  assert.equal(init.result.protocolVersion, '2025-03-26');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await request('tools/list');
  assert.deepEqual(list.result.tools.map(tool => tool.name).sort(), ['agent_memory_read', 'git_status']);
  const status = await request('tools/call', { name: 'git_status', arguments: {} });
  assert.equal(status.result.isError, undefined);
  const parsed = JSON.parse(status.result.content[0].text);
  assert.equal(typeof parsed.branch, 'string');
  const invalid = await request('tools/call', { name: 'agent_memory_read', arguments: { agentId: '../private' } });
  assert.equal(invalid.result.isError, true);
});
