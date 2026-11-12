#!/usr/bin/env node
// Local, read-only GUI inspection MCP bridge. Never exposes mouse/keyboard control.
// Requires a local X11 session and ImageMagick 'import'. No network listener.
import { spawnSync } from 'node:child_process';
import { statSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tools = [
  { name: 'desktop_status', description: 'Inspect local graphical session availability', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'desktop_screenshot', description: 'Capture local X11 desktop as an MCP image (no remote upload)', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
function status() {
  return { display: process.env.DISPLAY || null, wayland: Boolean(process.env.WAYLAND_DISPLAY), x11CaptureAvailable: Boolean(process.env.DISPLAY) && spawnSync('sh', ['-c', 'command -v import >/dev/null'], { timeout: 1500 }).status === 0 };
}
function capture() {
  if (!status().x11CaptureAvailable) throw new Error('X11 DISPLAY or ImageMagick import unavailable');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bastilla-desktop-'));
  try {
    const file = path.join(dir, 'screen.png');
    const result = spawnSync('import', ['-window', 'root', '-resize', '1280x800>', file], { timeout: 5000, maxBuffer: 4096, env: process.env });
    if (result.status !== 0 || result.error) throw new Error('Screenshot failed; verify X11 session permissions');
    const stat = statSync(file);
    if (stat.size > 4 * 1024 * 1024) throw new Error('Screenshot too large');
    return { content: [{ type: 'image', data: readFileSync(file).toString('base64'), mimeType: 'image/png' }] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function handle(req) {
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return reply({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32600, message: 'Invalid Request' } });
  if (req.id === undefined) return;
  const { id, method } = req;
  if (method === 'initialize') return reply({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'bastilla-desktop-local', version: '0.1.0' } } });
  if (method === 'ping') return reply({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return reply({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') {
    if (!tools.some(t => t.name === req.params?.name)) return reply({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } });
    try {
      const result = req.params.name === 'desktop_status'
        ? { content: [{ type: 'text', text: JSON.stringify(status()) }] }
        : capture();
      return reply({ jsonrpc: '2.0', id, result });
    } catch (error) {
      return reply({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: error.message }] } });
    }
  }
  reply({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 1024 * 1024) { buffer = ''; return; }
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  }
});
