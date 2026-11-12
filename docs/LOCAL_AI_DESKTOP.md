# Local AI desktop inspection (Bastilla Ultimate)

Codex CLI starts `scripts/desktop-bridge.mjs` through the repository's `.codex/config.toml`. It uses MCP stdio, with no TCP listener, cloud service or API key.

## Requirements
- Linux with a running X11 session (`DISPLAY` and appropriate Xauthority)
- Node.js 22+
- ImageMagick `import` executable for screenshots (`sudo apt install imagemagick` on Debian)
- The Codex process must have permission to read the graphical session.

## Tools
- `desktop_status`: reports DISPLAY, Wayland detection, and whether X11 screenshot capture is available.
- `desktop_screenshot`: returns a resized PNG as an MCP image, in memory. Temporary file is removed immediately.

Run `node scripts/desktop-bridge.mjs` for manual MCP JSON-RPC inspection, or `npx codex mcp list` to see the configured bridge.

**Limits:** The bridge does not create a desktop, install TigerVNC/noVNC, click, type, run shell commands or authorize agents to control the host. It only inspects the existing X11 display. A Wayland-only session requires a separate capture backend. Screenshot contents may include sensitive information: use a dedicated agent session with no private applications or credentials visible. Keep VNC bound to loopback and require authentication if added later.
