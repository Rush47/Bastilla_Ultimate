import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DesktopWindowInfo {
  id: string;
  desktop: string;
  pid: number | null;
  title: string;
}

export interface DesktopScreenshotResult {
  mimeType: "image/png";
  base64: string;
  width: number;
  height: number;
  display: string;
  sessionId: string;
  capturedAt: string;
  byteSize: number;
}

export interface DesktopAuditEntry {
  id: string;
  timestamp: string;
  agentId: string;
  tool: string;
  args: Record<string, any>;
  ok: boolean;
  summary: string;
}

export interface DesktopStatusReport {
  display: string | null;
  wayland: boolean;
  x11SessionActive: boolean;
  x11CaptureAvailable: boolean;
  xauthorityPath: string | null;
  displayAccessError: string | null;
  resolution: { width: number; height: number } | null;
  activeWindow: string | null;
  tools: {
    import: boolean;
    xdotool: boolean;
    wmctrl: boolean;
    xprop: boolean;
    xdpyinfo: boolean;
    xvfb: boolean;
    x11vnc: boolean;
    novnc: boolean;
  };
  sessionIsolated: boolean;
  sessionId: string | null;
  vncRunning: boolean;
  vncPort: number | null;
  novncUrl: string | null;
  aiControlEnabled: boolean;
  activeAgent: string | null;
  lastCaptureAt: string | null;
  lastCaptureSessionId: string | null;
  auditLog: DesktopAuditEntry[];
  checkedAt: string;
}

const SAFE_KEY_MAP: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  backspace: "BackSpace",
  delete: "Delete",
  del: "Delete",
  space: "space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  page_up: "Page_Up",
  pagedown: "Page_Down",
  page_down: "Page_Down",
  super: "Super_L",
  win: "Super_L",
};

function normalizeKeyCombo(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed.length > 32) return null;
  const parts = trimmed.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;
  const mapped: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();
    if (i < parts.length - 1) {
      if (lower === "ctrl" || lower === "control") mapped.push("ctrl");
      else if (lower === "alt") mapped.push("alt");
      else if (lower === "shift") mapped.push("shift");
      else if (lower === "super" || lower === "meta") mapped.push("super");
      else return null;
    } else {
      if (SAFE_KEY_MAP[lower]) mapped.push(SAFE_KEY_MAP[lower]);
      else if (/^F([1-9]|1[0-2])$/i.test(part)) mapped.push(part.toUpperCase());
      else if (/^[a-zA-Z0-9]$/.test(part)) mapped.push(part);
      else return null;
    }
  }
  return mapped.join("+");
}

async function hasBinary(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${cmd} >/dev/null 2>&1`], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

export class DesktopSessionManager {
  private isolatedDisplay: string | null = null;
  private sessionId: string | null = null;
  private aiControlEnabled = false;
  private activeAgent: string | null = null;
  private vncPort = 5900;
  private xvfbProc: ChildProcess | null = null;
  private wmProc: ChildProcess | null = null;
  private vncProc: ChildProcess | null = null;
  private lastCapture: { capturedAt: string; sessionId: string; base64: string; width: number; height: number } | null = null;
  private auditLog: DesktopAuditEntry[] = [];
  private actionTimestamps: number[] = [];

  private recordAudit(agentId: string, tool: string, args: Record<string, any>, ok: boolean, summary: string) {
    this.auditLog.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      agentId,
      tool,
      args,
      ok,
      summary,
    });
    if (this.auditLog.length > 80) {
      this.auditLog.length = 80;
    }
  }

  private getEffectiveDisplay(): string | null {
    if (this.isolatedDisplay) return this.isolatedDisplay;
    const envDisplay = String(process.env.DISPLAY || "").trim();
    return envDisplay || null;
  }

  private buildX11Env(display: string | null): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (display) env.DISPLAY = display;
    return env;
  }

  private enforceControlGate(agentId: string) {
    if (!this.aiControlEnabled) {
      throw new Error("Sterowanie pulpitem przez AI jest wstrzymane. Włącz je jawnie w panelu Pulpitu AI.");
    }
    if (!this.isolatedDisplay) {
      throw new Error("Brak odizolowanej sesji X11 dla AI. Uruchom najpierw izolowaną sesję pulpitu.");
    }
    const now = Date.now();
    this.actionTimestamps = this.actionTimestamps.filter((ts) => now - ts < 10_000);
    const lastTs = this.actionTimestamps[this.actionTimestamps.length - 1] || 0;
    if (now - lastTs < 120) {
      throw new Error("Przekroczono limit częstotliwości akcji GUI (min. 120 ms między operacjami).");
    }
    if (this.actionTimestamps.length >= 25) {
      throw new Error("Przekroczono limit 25 akcji GUI na 10 sekund.");
    }
    this.actionTimestamps.push(now);
    this.activeAgent = agentId;
  }

  async getStatus(): Promise<DesktopStatusReport> {
    const display = this.getEffectiveDisplay();
    const wayland = Boolean(process.env.WAYLAND_DISPLAY);
    const xauthorityPath = process.env.XAUTHORITY || (existsSync("/root/.Xauthority") ? "/root/.Xauthority" : null);

    const [importOk, xdotoolOk, wmctrlOk, xpropOk, xdpyinfoOk, xvfbOk, x11vncOk] = await Promise.all([
      hasBinary("import"),
      hasBinary("xdotool"),
      hasBinary("wmctrl"),
      hasBinary("xprop"),
      hasBinary("xdpyinfo"),
      hasBinary("Xvfb"),
      hasBinary("x11vnc"),
    ]);
    const novncOk = existsSync("/usr/share/novnc/vnc.html") || existsSync("/usr/share/novnc/vnc_lite.html");

    let x11SessionActive = false;
    let displayAccessError: string | null = null;
    let resolution: { width: number; height: number } | null = null;
    let activeWindow: string | null = null;

    if (display) {
      const env = this.buildX11Env(display);
      if (xdpyinfoOk) {
        try {
          const { stdout } = await execFileAsync("xdpyinfo", ["-display", display], { timeout: 2000, env });
          x11SessionActive = true;
          const match = stdout.match(/dimensions:\s+(\d+)x(\d+)\s+pixels/);
          if (match) {
            resolution = { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
          }
        } catch (err: any) {
          displayAccessError = String(err?.stderr || err?.message || "Brak dostępu do sesji X11.").trim().slice(0, 220);
        }
      } else if (xpropOk) {
        try {
          await execFileAsync("xprop", ["-display", display, "-root", "_NET_SUPPORTING_WM_CHECK"], { timeout: 2000, env });
          x11SessionActive = true;
        } catch (err: any) {
          displayAccessError = String(err?.stderr || err?.message || "Brak dostępu do DISPLAY.").trim().slice(0, 220);
        }
      }

      if (x11SessionActive && xdotoolOk) {
        try {
          const { stdout: winOut } = await execFileAsync("xdotool", ["getactivewindow", "getwindowname"], { timeout: 1500, env });
          const clean = winOut.trim();
          if (clean) activeWindow = clean.slice(0, 120);
        } catch {
          activeWindow = "Pulpit X11 (brak aktywnego okna)";
        }
      }
    } else {
      displayAccessError = wayland
        ? "Aktywna sesja Wayland bez mostu X11 DISPLAY — użyj izolowanej sesji Xvfb dla AI."
        : "Brak aktywnej zmiennej DISPLAY. Uruchom izolowany pulpit AI (:99).";
    }

    const vncRunning = Boolean(
      this.vncProc && this.vncProc.exitCode === null && !this.vncProc.killed
    );

    return {
      display,
      wayland,
      x11SessionActive,
      x11CaptureAvailable: Boolean(display && x11SessionActive && importOk),
      xauthorityPath,
      displayAccessError,
      resolution,
      activeWindow,
      tools: {
        import: importOk,
        xdotool: xdotoolOk,
        wmctrl: wmctrlOk,
        xprop: xpropOk,
        xdpyinfo: xdpyinfoOk,
        xvfb: xvfbOk,
        x11vnc: x11vncOk,
        novnc: novncOk,
      },
      sessionIsolated: Boolean(this.isolatedDisplay && x11SessionActive),
      sessionId: this.sessionId,
      vncRunning,
      vncPort: vncRunning ? this.vncPort : null,
      novncUrl: vncRunning && novncOk
        ? "/api/desktop/novnc/vnc.html?autoconnect=1&resize=scale&path=api/desktop/vnc-ws"
        : null,
      aiControlEnabled: this.aiControlEnabled,
      activeAgent: this.activeAgent,
      lastCaptureAt: this.lastCapture && this.lastCapture.sessionId === this.sessionId
        ? this.lastCapture.capturedAt
        : null,
      lastCaptureSessionId: this.lastCapture && this.lastCapture.sessionId === this.sessionId
        ? this.lastCapture.sessionId
        : null,
      auditLog: this.auditLog.slice(0, 25),
      checkedAt: new Date().toISOString(),
    };
  }

  async startIsolatedSession(agentId = "aria"): Promise<DesktopStatusReport> {
    if (this.isolatedDisplay && this.xvfbProc && this.xvfbProc.exitCode === null) {
      return this.getStatus();
    }

    const [xvfbOk, x11vncOk, fluxboxOk] = await Promise.all([
      hasBinary("Xvfb"),
      hasBinary("x11vnc"),
      hasBinary("fluxbox"),
    ]);
    if (!xvfbOk) {
      throw new Error("Brak binarium Xvfb w systemie Linux.");
    }

    const displayNum = 99;
    const display = `:${displayNum}`;
    const xvfb = spawn(
      "Xvfb",
      [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"],
      { detached: true, stdio: "ignore" }
    );
    xvfb.unref();
    this.xvfbProc = xvfb;
    this.isolatedDisplay = display;
    this.sessionId = `desk-${Date.now()}`;
    this.lastCapture = null; // Never reuse screenshot from previous session
    this.activeAgent = agentId;

    // Wait briefly for Xvfb socket to initialize
    const env = this.buildX11Env(display);
    let ready = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        await execFileAsync("xdpyinfo", ["-display", display], { timeout: 1000, env });
        ready = true;
        break;
      } catch {}
    }
    if (!ready) {
      await this.stopIsolatedSession();
      throw new Error("Xvfb uruchomiono, ale gniazdo X11 :99 nie odpowiedziało.");
    }

    if (fluxboxOk) {
      const wm = spawn("fluxbox", ["-display", display], { detached: true, stdio: "ignore", env });
      wm.unref();
      this.wmProc = wm;
    }

    // Set a dark violet desktop backdrop if ImageMagick convert/xsetroot or xterm is present
    if (await hasBinary("xsetroot")) {
      await execFileAsync("xsetroot", ["-display", display, "-solid", "#130f26"], { timeout: 1500, env }).catch(() => {});
    }

    if (x11vncOk) {
      const vnc = spawn(
        "x11vnc",
        [
          "-display",
          display,
          "-listen",
          "127.0.0.1",
          "-rfbport",
          String(this.vncPort),
          "-forever",
          "-shared",
          "-nopw",
          "-quiet",
        ],
        { detached: true, stdio: "ignore", env }
      );
      vnc.unref();
      this.vncProc = vnc;
      await new Promise((r) => setTimeout(r, 350));
    }

    this.recordAudit(agentId, "desktop_session_start", { display, resolution: "1280x800" }, true, `Uruchomiono izolowaną sesję X11 ${display} + VNC 127.0.0.1:${this.vncPort}`);
    return this.getStatus();
  }

  async stopIsolatedSession(): Promise<DesktopStatusReport> {
    this.aiControlEnabled = false;
    this.activeAgent = null;
    this.lastCapture = null;
    for (const proc of [this.vncProc, this.wmProc, this.xvfbProc]) {
      if (proc && proc.exitCode === null) {
        try {
          proc.kill("SIGTERM");
        } catch {}
      }
    }
    this.vncProc = null;
    this.wmProc = null;
    this.xvfbProc = null;
    this.isolatedDisplay = null;
    this.sessionId = null;
    this.recordAudit("operator", "desktop_session_stop", {}, true, "Zatrzymano izolowaną sesję pulpitu AI i wyczyszczono zrzuty.");
    return this.getStatus();
  }

  setAiControlEnabled(enabled: boolean, agentId?: string): { aiControlEnabled: boolean; activeAgent: string | null } {
    this.aiControlEnabled = Boolean(enabled);
    if (!enabled) {
      this.activeAgent = null;
      this.recordAudit("operator", "desktop_ai_stop", {}, true, "Zatrzymano sterowanie pulpitem przez AI.");
    } else {
      this.activeAgent = agentId || "aria";
      this.recordAudit(this.activeAgent, "desktop_ai_enable", {}, true, `Włączono kontrolowane sterowanie GUI dla agenta ${this.activeAgent}.`);
    }
    return { aiControlEnabled: this.aiControlEnabled, activeAgent: this.activeAgent };
  }

  getLatestCachedScreenshot(): DesktopScreenshotResult | null {
    if (!this.lastCapture || !this.sessionId || this.lastCapture.sessionId !== this.sessionId || !this.isolatedDisplay) {
      return null;
    }
    return {
      mimeType: "image/png",
      base64: this.lastCapture.base64,
      width: this.lastCapture.width,
      height: this.lastCapture.height,
      display: this.isolatedDisplay,
      sessionId: this.lastCapture.sessionId,
      capturedAt: this.lastCapture.capturedAt,
      byteSize: Buffer.byteLength(this.lastCapture.base64, "base64"),
    };
  }

  async captureScreenshot(agentId = "aria"): Promise<DesktopScreenshotResult> {
    const status = await this.getStatus();
    if (!status.x11CaptureAvailable || !status.display) {
      throw new Error(status.displayAccessError || "Przechwytywanie X11 niedostępne. Uruchom izolowany pulpit AI.");
    }
    const env = this.buildX11Env(status.display);
    const dir = mkdtempSync(path.join(os.tmpdir(), "bastilla-desk-"));
    try {
      const outPath = path.join(dir, "screen.png");
      await execFileAsync(
        "import",
        ["-display", status.display, "-window", "root", "-resize", "1280x800>", outPath],
        { timeout: 5000, env }
      );
      const buf = readFileSync(outPath);
      if (buf.length > 4 * 1024 * 1024) {
        throw new Error("Zrzut ekranu przekracza dopuszczalny limit 4 MB.");
      }
      const base64 = buf.toString("base64");
      const width = status.resolution?.width || 1280;
      const height = status.resolution?.height || 800;
      const capturedAt = new Date().toISOString();
      const sid = this.sessionId || `host-${status.display}`;
      this.sessionId = sid;
      this.lastCapture = { capturedAt, sessionId: sid, base64, width, height };
      this.recordAudit(agentId, "desktop_screenshot", { display: status.display }, true, `Zrzut ekranu ${width}x${height} (${buf.length} B)`);
      return {
        mimeType: "image/png",
        base64,
        width,
        height,
        display: status.display,
        sessionId: sid,
        capturedAt,
        byteSize: buf.length,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async listWindows(): Promise<DesktopWindowInfo[]> {
    const status = await this.getStatus();
    if (!status.display || !status.x11SessionActive) {
      return [];
    }
    if (!status.tools.wmctrl) {
      return [];
    }
    try {
      const { stdout } = await execFileAsync("wmctrl", ["-lp"], {
        timeout: 2000,
        env: this.buildX11Env(status.display),
      });
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/);
          const id = parts[0] || "";
          const desktop = parts[1] || "0";
          const pidNum = parseInt(parts[2] || "", 10);
          const title = parts.slice(4).join(" ") || "(Bez tytułu)";
          return {
            id,
            desktop,
            pid: Number.isNaN(pidNum) ? null : pidNum,
            title,
          };
        });
    } catch {
      return [];
    }
  }

  async focusWindow(windowIdOrTitle: string, agentId = "aria") {
    this.enforceControlGate(agentId);
    const clean = String(windowIdOrTitle || "").trim();
    if (!clean || clean.length > 120) {
      throw new Error("Podaj poprawny identyfikator lub tytuł okna.");
    }
    const env = this.buildX11Env(this.isolatedDisplay);
    if (/^0x[0-9a-f]+$/i.test(clean)) {
      await execFileAsync("wmctrl", ["-i", "-a", clean], { timeout: 2500, env });
    } else {
      await execFileAsync("wmctrl", ["-a", clean], { timeout: 2500, env });
    }
    this.recordAudit(agentId, "desktop_window_focus", { target: clean }, true, `Aktywowano okno ${clean}`);
    return { focused: clean };
  }

  async mouseMove(x: number, y: number, agentId = "aria") {
    this.enforceControlGate(agentId);
    const status = await this.getStatus();
    const maxW = status.resolution?.width || 1280;
    const maxH = status.resolution?.height || 800;
    const ix = Math.round(Number(x));
    const iy = Math.round(Number(y));
    if (!Number.isFinite(ix) || !Number.isFinite(iy) || ix < 0 || iy < 0 || ix > maxW || iy > maxH) {
      throw new Error(`Współrzędne poza zakresem ekranu (${maxW}x${maxH}): (${x}, ${y}).`);
    }
    await execFileAsync("xdotool", ["mousemove", "--sync", String(ix), String(iy)], {
      timeout: 2500,
      env: this.buildX11Env(this.isolatedDisplay),
    });
    this.recordAudit(agentId, "desktop_mouse_move", { x: ix, y: iy }, true, `Przesunięto kursor na (${ix}, ${iy})`);
    return { x: ix, y: iy, resolution: { width: maxW, height: maxH } };
  }

  async mouseClick(x: number, y: number, button: "left" | "middle" | "right" = "left", doubleClick = false, agentId = "aria") {
    const moved = await this.mouseMove(x, y, agentId);
    const btnCode = button === "right" ? "3" : button === "middle" ? "2" : "1";
    const args = doubleClick ? ["click", "--repeat", "2", "--delay", "60", btnCode] : ["click", btnCode];
    await execFileAsync("xdotool", args, {
      timeout: 2500,
      env: this.buildX11Env(this.isolatedDisplay),
    });
    this.recordAudit(agentId, "desktop_mouse_click", { x: moved.x, y: moved.y, button, doubleClick }, true, `Kliknięcie ${button}${doubleClick ? " (2x)" : ""} w (${moved.x}, ${moved.y})`);
    return { ...moved, button, doubleClick };
  }

  async mouseScroll(direction: "up" | "down" | "left" | "right", clicks = 3, agentId = "aria") {
    this.enforceControlGate(agentId);
    const safeClicks = Math.min(Math.max(1, Math.round(Number(clicks) || 3)), 15);
    const btn = direction === "up" ? "4" : direction === "down" ? "5" : direction === "left" ? "6" : "7";
    await execFileAsync("xdotool", ["click", "--repeat", String(safeClicks), btn], {
      timeout: 2500,
      env: this.buildX11Env(this.isolatedDisplay),
    });
    this.recordAudit(agentId, "desktop_mouse_scroll", { direction, clicks: safeClicks }, true, `Przewinięto ${direction} (${safeClicks}x)`);
    return { direction, clicks: safeClicks };
  }

  async keyboardType(text: string, agentId = "aria") {
    this.enforceControlGate(agentId);
    const clean = String(text || "");
    if (!clean || clean.length > 500) {
      throw new Error("Tekst musi mieć od 1 do 500 znaków.");
    }
    await execFileAsync("xdotool", ["type", "--delay", "12", "--clearmodifiers", "--", clean], {
      timeout: 5000,
      env: this.buildX11Env(this.isolatedDisplay),
    });
    this.recordAudit(agentId, "desktop_keyboard_type", { length: clean.length }, true, `Wpisano ${clean.length} znaków`);
    return { typedLength: clean.length };
  }

  async keyboardPress(key: string, agentId = "aria") {
    this.enforceControlGate(agentId);
    const combo = normalizeKeyCombo(key);
    if (!combo) {
      throw new Error(`Niedozwolony klawisz lub kombinacja: "${key}".`);
    }
    await execFileAsync("xdotool", ["key", "--clearmodifiers", combo], {
      timeout: 2500,
      env: this.buildX11Env(this.isolatedDisplay),
    });
    this.recordAudit(agentId, "desktop_keyboard_press", { key: combo }, true, `Naciśnięto klawisz ${combo}`);
    return { key: combo };
  }
}

export const desktopSessionManager = new DesktopSessionManager();

/**
 * Lightweight zero-dependency RFC 6455 WebSocket-to-TCP bridge forwarding
 * authenticated noVNC browser frames directly to loopback x11vnc (127.0.0.1:5900).
 */
export function bridgeAuthenticatedVncWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  vncPort = 5900
) {
  const key = req.headers["sec-websocket-key"];
  if (!key || Array.isArray(key)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const acceptKey = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  const requestedProto = String(req.headers["sec-websocket-protocol"] || "");
  const protoHeader = requestedProto.includes("binary")
    ? "Sec-WebSocket-Protocol: binary\r\n"
    : "";

  const upstream = net.connect({ host: "127.0.0.1", port: vncPort });

  upstream.once("connect", () => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
        protoHeader +
        `\r\n`
    );

    let wsBuffer: Buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);

    const decodeFrames = () => {
      while (wsBuffer.length >= 2) {
        const firstByte = wsBuffer[0];
        const secondByte = wsBuffer[1];
        const opcode = firstByte & 0x0f;
        const masked = Boolean(secondByte & 0x80);
        let payloadLen = secondByte & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (wsBuffer.length < 4) return;
          payloadLen = wsBuffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (wsBuffer.length < 10) return;
          payloadLen = Number(wsBuffer.readBigUInt64BE(2));
          offset = 10;
        }

        if (masked && wsBuffer.length < offset + 4) return;
        const maskOffset = offset;
        if (masked) offset += 4;
        if (wsBuffer.length < offset + payloadLen) return;

        const payload = Buffer.from(wsBuffer.subarray(offset, offset + payloadLen));
        if (masked) {
          const mask = wsBuffer.subarray(maskOffset, maskOffset + 4);
          for (let i = 0; i < payload.length; i++) {
            payload[i] ^= mask[i & 3];
          }
        }
        wsBuffer = wsBuffer.subarray(offset + payloadLen);

        if (opcode === 0x8) {
          // Close
          upstream.end();
          socket.end();
          return;
        } else if (opcode === 0x9) {
          // Ping -> Pong
          const pong = Buffer.alloc(2 + payload.length);
          pong[0] = 0x8a;
          pong[1] = payload.length;
          payload.copy(pong, 2);
          socket.write(pong);
        } else if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
          upstream.write(payload);
        }
      }
    };

    socket.on("data", (chunk: Buffer) => {
      wsBuffer = wsBuffer.length ? Buffer.concat([wsBuffer, chunk]) : chunk;
      decodeFrames();
    });

    upstream.on("data", (chunk: Buffer) => {
      if (socket.destroyed) return;
      const len = chunk.length;
      let header: Buffer;
      if (len < 126) {
        header = Buffer.from([0x82, len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x82;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      socket.write(Buffer.concat([header, chunk]));
    });
  });

  const cleanup = () => {
    if (!upstream.destroyed) upstream.destroy();
    if (!socket.destroyed) socket.destroy();
  };

  upstream.on("error", cleanup);
  upstream.on("close", cleanup);
  socket.on("error", cleanup);
  socket.on("close", cleanup);
}
