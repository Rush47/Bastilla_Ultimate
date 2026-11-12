import express from "express";
import { createServer as createViteServer } from "vite";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { installApiSecurity, redact } from "./server/security";
import { MCPServerManager } from "./server/mcp";
import { AGENTS, TaskQueue } from "./server/task-queue";
import { agentAccess } from "./server/agent-access";
import { CodexAuthManager, CodexError } from "./server/codex";
import {
  GoogleGenAI,
  GenerateContentResponse,
} from "@google/genai";
import {
  SVLSystemKernel,
  TopologicalInfinityEngine,
} from "./src/utils/svlKernel";

dotenv.config();

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const KERNEL_DIR = path.join(PROJECT_ROOT, "distro/bastilla-overlay");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.BASTILLA_HOST || "127.0.0.1";
if (!["127.0.0.1", "localhost", "::1"].includes(HOST) && !process.env.BASTILLA_API_TOKEN?.trim()) {
  throw new Error("Dostęp zdalny wymaga BASTILLA_API_TOKEN w sekretach serwera.");
}
const DB_PATH = path.resolve(process.env.BASTILLA_DB_PATH ||
  (fs.existsSync("/var/lib/bastilla/bastilla.db")
    ? "/var/lib/bastilla/bastilla.db"
    : path.join(PROJECT_ROOT, ".bastilla/bastilla.db")));
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
process.env.BASTILLA_PROJECT_ROOT = PROJECT_ROOT;
process.env.BASTILLA_DB_PATH = DB_PATH;
process.env.BASTILLA_KERNEL_DIR = KERNEL_DIR;
process.env.PYTHONPATH = [KERNEL_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
const codexAuth = new CodexAuthManager({ projectRoot: PROJECT_ROOT });
process.once("exit", () => codexAuth.dispose());
process.once("SIGTERM", () => { codexAuth.dispose(); process.exit(0); });
process.once("SIGINT", () => { codexAuth.dispose(); process.exit(0); });

function bodyEngine(body: any, requested: string): string {
  if (body.provider === "gemini-bridge") return `gemini/${body.model || "unknown"}`;
  return `ollama/${body.model || requested}`;
}

function shellQuote(value: string) { return "'" + value.replace(/'/g, "'\\''") + "'"; }

function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "MY_GEMINI_API_KEY" || key.trim() === "") {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      timeout: 60000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function querySqliteJson(pyScript: string, args: string[] = []): Promise<any> {
  try {
    const { stdout } = await execFileAsync(
      "python3",
      ["-c", pyScript, DB_PATH, ...args.map(redact)],
      { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }
    );
    return JSON.parse(stdout.trim() || "{}");
  } catch (err: any) {
    console.error("SQLite bridge failed:", err?.code || "SQLITE_ERROR");
    throw err;
  }
}

async function runLiveMultimodalModel(
  contents: any[]
): Promise<{ text: string; modelUsed: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      "Brak klucza GEMINI_API_KEY w środowisku wykonawczym do obsługi wnioskowania neuronowego."
    );
  }
  const modelUsed = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const response: GenerateContentResponse = await ai.models.generateContent({ model: modelUsed, contents });
  if (!response.text?.trim()) throw new Error("Gemini zwrócił pustą odpowiedź.");
  return { text: response.text, modelUsed };
}

// Explicit Gemini compatibility adapter. It never advertises local model weights.
function startLocalOllamaDaemon() {
  const bridge = express();
  bridge.use(express.json({ limit: "15mb" }));
  bridge.get("/api/version", (_req, res) => res.json({ version: "gemini-adapter", provider: "gemini-bridge" }));
  bridge.get("/api/tags", (_req, res) => res.json({ models: [], provider: "gemini-bridge" }));
  bridge.get("/api/ps", (_req, res) => res.json({ models: [], provider: "gemini-bridge" }));
  bridge.post("/api/show", (_req, res) => res.status(404).json({ error: "Adapter Gemini nie przechowuje wag Ollama." }));
  for (const route of ["chat", "generate"]) {
    bridge.post(`/api/${route}`, async (req, res) => {
      try {
        const messages = route === "chat" ? req.body?.messages : [{ role: "user", content: req.body?.prompt, images: req.body?.images }];
        if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "Brak wiadomości." });
        const contents = messages.filter(m => ["user", "assistant"].includes(m.role)).map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [ ...(Array.isArray(m.images) ? m.images.map((data: string) => ({ inlineData: { mimeType: "image/jpeg", data } })) : []), { text: String(m.content || "") } ],
        }));
        const result = await runLiveMultimodalModel(contents);
        res.json({ model: result.modelUsed, provider: "gemini-bridge", created_at: new Date().toISOString(), done: true,
          ...(route === "chat" ? { message: { role: "assistant", content: redact(result.text) } } : { response: redact(result.text) }) });
      } catch (error) { res.status(503).json({ error: redact(error instanceof Error ? error.message : "Błąd Gemini") }); }
    });
  }
  const server = bridge.listen(Number(process.env.BASTILLA_BRIDGE_PORT || 11435), "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") console.log(`Gemini adapter running at http://127.0.0.1:${address.port}`);
  });
  server.on("error", () => console.error("Gemini compatibility adapter: bind failed."));
}

function startRootEscalationSocket() {
  const socketPath = "/var/run/bastilla-root.sock";
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch (e) {
    console.error("Root socket cleanup warning:", e);
  }

  const rootServer = net.createServer((conn) => {
    let buffer = "";
    conn.on("data", async (chunk) => {
      buffer += chunk.toString("utf-8");
      if (!buffer.includes("\n")) return;
      const line = buffer.split("\n")[0];
      buffer = "";

      try {
        const req = JSON.parse(line);
        const caller = String(req.caller || "root");
        const cmd = String(req.command || "id");
        const cwd = String(req.cwd || PROJECT_ROOT);

        if (/pkill\s+-f\s+server|killall\s+node|rm\s+-rf\s+\/\s*$/i.test(cmd)) {
          conn.end(
            JSON.stringify({
              stdout: "",
              stderr: "sudo: destructive system termination command blocked.\n",
              exitCode: 1,
            })
          );
          return;
        }

        let stdout = "";
        let stderr = "";
        let exitCode = 0;
        try {
          const out = await execAsync(cmd, {
            cwd: fs.existsSync(cwd) ? cwd : PROJECT_ROOT,
            timeout: 12000,
            maxBuffer: 2 * 1024 * 1024,
            env: {
              ...process.env,
              USER: "root",
              LOGNAME: "root",
              HOME: "/root",
              SUDO_USER: caller,
              SUDO_UID: String(req.uid || 0),
              SUDO_GID: String(req.gid || 0),
              PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH || ""}`,
            },
          });
          stdout = out.stdout;
          stderr = out.stderr;
        } catch (err: any) {
          stdout = err.stdout || "";
          stderr = err.stderr || err.message || "";
          exitCode = typeof err.code === "number" ? err.code : 1;
        }

        conn.end(JSON.stringify({ stdout, stderr, exitCode }));
      } catch (err: any) {
        conn.end(
          JSON.stringify({
            stdout: "",
            stderr: `sudo root socket error: ${err?.message || String(err)}\n`,
            exitCode: 1,
          })
        );
      }
    });
  });

  rootServer.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
      fs.chownSync(socketPath, 0, 0);
      console.log(
        `[Bastilla OS Ultimate] Supreme Root escalation socket active at ${socketPath} (0600, wyłącznie root)`
      );
    } catch (e) {
      console.error("Root socket chmod warning:", e);
    }
  });
}

async function ensureLinuxProvisioned() {
  if (process.env.BASTILLA_PROVISION_HOST === "true") {
    if (process.getuid?.() !== 0) {
      throw new Error("BASTILLA_PROVISION_HOST wymaga uruchomienia jako root.");
    }
    await execFileAsync("bash", [path.join(KERNEL_DIR, "provision-runtime.sh")], {
      cwd: PROJECT_ROOT,
      timeout: 120000,
    });
  }
  await execFileAsync("python3", [path.join(KERNEL_DIR, "init_db.py"), DB_PATH], {
    cwd: PROJECT_ROOT,
    timeout: 10000,
  });
}

async function executeTerminalCommandInternal(
  mode: string,
  command: string,
  agentUser: string
): Promise<{ stdout: string; stderr: string; exitCode: number; safeAgent: string }> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  const validAgents = ["aria", "alex", "astyria", "aurelius"];
  const safeAgent = validAgents.includes(agentUser) ? agentUser : "aria";

  if (!["LINUX_ROOT", "PYTHON_ROOT", "AI_CLI", "BINARY_ELF", "AGENT_USER"].includes(mode)) throw new Error("Nieprawidłowy tryb terminala.");
  if (mode === "AGENT_USER" && !validAgents.includes(agentUser)) throw new Error("Nieprawidłowy agent.");

  if (mode === "LINUX_ROOT") {
    try {
      const out = await execAsync(command, {
        cwd: PROJECT_ROOT,
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${path.join(PROJECT_ROOT, "node_modules/.bin")}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
          PYTHONPATH: process.env.PYTHONPATH,
        },
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (e: any) {
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
      exitCode = typeof e.code === "number" ? e.code : 1;
    }
  } else if (mode === "PYTHON_ROOT") {
    try {
      const out = await execFileAsync("python3", ["-c", command], {
        cwd: PROJECT_ROOT,
        timeout: 10000,
        env: {
          ...process.env,
          PYTHONPATH: process.env.PYTHONPATH,
        },
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (e: any) {
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
      exitCode = typeof e.code === "number" ? e.code : 1;
    }
  } else if (mode === "AGENT_USER") {
    try {
      const out = await execFileAsync(
        "runuser",
        ["-u", safeAgent, "--", "bash", "-c", `cd /home/${safeAgent} && ${command}`],
        {
          timeout: 10000,
          env: {
            ...process.env,
            HOME: `/home/${safeAgent}`,
            USER: safeAgent,
            PYTHONPATH: process.env.PYTHONPATH,
          },
        }
      );
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (e: any) {
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
      exitCode = typeof e.code === "number" ? e.code : 1;
    }
  } else if (mode === "BINARY_ELF") {
    const targetFile =
      command.trim().split(/\s+/)[0] || "/usr/local/bin/llmman.fedora45.elf";
    const binInspectorPy = `
import os, sys, subprocess

target = sys.argv[1]
if not os.path.exists(target):
    print(f"[BINARY INSPECTOR] Plik nie istnieje: {target}")
    print("Dostępne binaria ELF w systemie:")
    for p in ["/usr/local/bin/llmman.fedora45.elf", "/usr/local/bin/gh", "/usr/local/bin/cloudflared", "/bin/bash", "/usr/bin/python3"]:
        if os.path.exists(p):
            print(f"  - {p} ({os.path.getsize(p)} bytes)")
    sys.exit(1)

size = os.path.getsize(target)
print(f"=== BASTILLA ELF / BINARY INSPECTOR: {target} ({size:,} bytes) ===")
for tool_cmd in [["file", "--", target], ["readelf", "-h", "--", target]]:
    try:
        out = subprocess.check_output(tool_cmd, stderr=subprocess.DEVNULL, timeout=3).decode('utf-8', 'replace').strip()
        if out:
            print(out[:8000])
    except Exception:
        pass

with open(target, "rb") as f:
    data = f.read(256)

print("OFFSET    00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F  |ASCII           |")
for offset in range(0, len(data), 16):
    chunk = data[offset:offset+16]
    hex_left = " ".join(f"{b:02X}" for b in chunk[:8])
    hex_right = " ".join(f"{b:02X}" for b in chunk[8:])
    ascii_str = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
    print(f"{offset:08X}  {hex_left:<23}  {hex_right:<23}  |{ascii_str:<16}|")
`;
    const out = await execFileAsync("python3", ["-c", binInspectorPy, targetFile], {
      timeout: 8000,
    });
    stdout = out.stdout;
    stderr = out.stderr;
  } else if (mode === "AI_CLI") {
    try {
      const out = await execAsync(command, {
        cwd: PROJECT_ROOT,
        timeout: 10000,
        env: { ...process.env, PATH: `${path.join(PROJECT_ROOT, "node_modules/.bin")}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (e: any) {
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
      exitCode = typeof e.code === "number" ? e.code : 1;
    }
  }

  stdout = redact(stdout);
  stderr = redact(stderr);
  command = redact(command);
  // Log to SQLite task_history
  const summary = (stdout || stderr || "OK").substring(0, 350);
  await querySqliteJson(
    `import sqlite3, sys, json
from datetime import datetime, timezone
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO task_history (title, assigned_agent, terminal_type, command_or_prompt, output_summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7], datetime.now(timezone.utc).isoformat()))
conn.commit(); conn.close(); print(json.dumps({"logged": True}))`,
    [
      `Terminal [${mode}]`,
      mode === "AGENT_USER" ? safeAgent : "aria",
      mode,
      command.substring(0, 200),
      summary,
      exitCode === 0 ? "COMPLETED" : "ERROR",
    ]
  );

  return { stdout, stderr, exitCode, safeAgent };
}

async function startServer() {
  await ensureLinuxProvisioned();

  const app = express();
  app.use(express.json({ limit: "15mb" }));
  installApiSecurity(app);
  // MCP Streamable HTTP (JSON-RPC subset). Protected by installApiSecurity.
  // Tool calls additionally require a matching operator token; cookies alone
  // are intentionally insufficient for invoking tools.
  const mcp = new MCPServerManager(PROJECT_ROOT, DB_PATH);
  app.post("/api/mcp", (req, res) => {
    const message = req.body;
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return res.status(400).json({ jsonrpc: "2.0", id: message?.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC request" } });
    }
    const id = message.id ?? null;
    const reply = (result: unknown) => res.json({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => res.json({ jsonrpc: "2.0", id, error: { code, message } });
    if (message.method === "notifications/initialized") return res.status(202).end();
    if (message.method === "initialize") return reply({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "bastilla-ultimate", version: "1.0.0" },
    });
    if (message.method === "tools/list") return reply({ tools: mcp.listTools().tools.map(tool => ({
      name: tool.name, description: tool.description,
      inputSchema: { type: "object", properties: tool.parameters.properties,
        ...(tool.parameters.required ? { required: tool.parameters.required } : {}) },
    })) });
    if (message.method === "tools/call") {
      const name = message.params?.name;
      if (typeof name !== "string" || !mcp.listTools().tools.some(t => t.name === name))
        return fail(-32602, "Unknown tool");
      const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      try {
        const result = mcp.executeTool(name, message.params?.arguments || {}, bearer);
        return reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (error) {
        return fail(-32001, error instanceof Error ? error.message : "Tool failed");
      }
    }
    return fail(-32601, "Method not found");
  });

  const queue = new TaskQueue(DB_PATH, async (task, signal) => {
    if (task.provider === "gemini") {
      const ai = getGeminiClient();
      if (!ai) throw new Error("Brak konfiguracji GEMINI_API_KEY.");
      const response = await ai.models.generateContent({ model: task.model,
        contents: [{ role: "user", parts: [{ text: task.prompt }] }],
        config: { abortSignal: signal, httpOptions: { timeout: 60000 } },
      });
      return response.text || "";
    }
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, { method: "POST",
      headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ model: task.model, stream: false, messages: [{ role: "user", content: task.prompt }] }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const body: any = await response.json();
    if (body.provider === "gemini-bridge") throw new Error("Adapter Gemini nie jest modelem Ollama. Wybierz dostawcę gemini.");
    if (body.model && body.model !== task.model) throw new Error("Ollama zwróciła inny model niż zamówiony.");
    return typeof body.message?.content === "string" ? body.message.content : "";
  });
  process.once("exit", () => queue.close());
  app.get("/api/agent-tasks", (_req, res) => {
    try { res.json({ ok: true, tasks: queue.list() }); }
    catch { res.status(500).json({ ok: false, error: "Błąd odczytu kolejki." }); }
  });
  app.post("/api/agent-tasks", (req, res) => {
    try { res.status(202).json({ ok: true, task: queue.submit(req.body || {}) }); }
    catch (error) { res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Błąd kolejki." }); }
  });
  app.post("/api/agent-tasks/:id/cancel", (req, res) => {
    try {
      const changed = queue.cancel(req.params.id);
      res.status(changed ? 200 : 409).json({ ok: changed, error: changed ? undefined : "Zadanie nie oczekuje i nie jest wykonywane." });
    } catch { res.status(500).json({ ok: false, error: "Błąd anulowania." }); }
  });
  app.get("/api/agents/capabilities", async (req, res) => {
    try { res.json({ ok: true, agents: await agentAccess(PROJECT_ROOT, queue, req.query.remote === "true") }); }
    catch { res.status(500).json({ ok: false, error: "Błąd diagnostyki agentów." }); }
  });

  // 1. Live System, Linux Kernel, SVL Core & SQLite State Overview
  app.get("/api/system/overview", async (_req, res) => {
    try {
      let svlReport: any = null;
      try {
        const { stdout } = await execFileAsync(
          "python3",
          [path.join(KERNEL_DIR, "svl_kernel.py")],
          { timeout: 5000 }
        );
        svlReport = JSON.parse(stdout);
      } catch {
        const fallbackKernel = new SVLSystemKernel();
        fallbackKernel.ulepsz_system_maksymalnie("364_OMNIKLUCZ_ROOT");
        svlReport = fallbackKernel.generate_system_status_report();
      }

      const hostProbeScript = `
import json, os, pwd, subprocess, sqlite3, sys
from datetime import datetime, timezone

def cmd_out(c):
    try:
        return subprocess.check_output(c, shell=True, stderr=subprocess.STDOUT, timeout=3).decode('utf-8', 'replace').strip()
    except Exception as e:
        return ""

os_release = {}
if os.path.exists("/etc/os-release"):
    with open("/etc/os-release") as f:
        for line in f:
            if "=" in line:
                k, v = line.strip().split("=", 1)
                os_release[k] = v.strip('"')

meminfo = {}
if os.path.exists("/proc/meminfo"):
    with open("/proc/meminfo") as f:
        for line in f:
            parts = line.split(":")
            if len(parts) == 2:
                meminfo[parts[0].strip()] = parts[1].strip()

loadavg = cmd_out("cat /proc/loadavg").split()[:3]
uptime_sec = float(cmd_out("cat /proc/uptime").split()[0] or 0)
uname_str = cmd_out("uname -srmo")
disk_df = cmd_out("df -h / | tail -n 1").split()

agents_live = []
for a in ["aria", "alex", "astyria", "aurelius"]:
    try:
        pw = pwd.getpwnam(a)
        uid, gid, home, shell = pw.pw_uid, pw.pw_gid, pw.pw_dir, pw.pw_shell
    except KeyError:
        uid, gid, home, shell = -1, -1, f"/home/{a}", "/bin/bash"
    pids = cmd_out(f"pgrep -u {a} -f 'agent_worker.py {a}([ ]|$)' || true").splitlines()
    pid = int(pids[0]) if pids and pids[0].isdigit() else 0
    worker_status = {}
    status_path = f"/home/{a}/worker_status.json"
    if os.path.exists(status_path):
        try:
            with open(status_path) as sf:
                worker_status = json.load(sf)
        except Exception:
            pass
    heartbeat_valid = False
    try:
        if isinstance(worker_status, dict) and worker_status.get("last_heartbeat"):
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(worker_status["last_heartbeat"])).total_seconds()
            heartbeat_valid = 0 <= age < 20 and worker_status.get("pid") == pid
    except (ValueError, TypeError):
        pass
    if not isinstance(worker_status, dict):
        worker_status = {}
    agents_live.append({
        "id": a,
        "uid": uid,
        "gid": gid,
        "home": home,
        "shell": shell,
        "pid": pid,
        "running": pid > 0 and heartbeat_valid,
        "worker_status": worker_status
    })

tools = {
    "gh": {
        "installed": os.path.exists("/usr/local/bin/gh") or bool(cmd_out("which gh")),
        "version": cmd_out("gh --version | head -n 1"),
        "binary_path": cmd_out("which gh") or "/usr/local/bin/gh",
        "auth_ready": False,
        "requirement_note": "Zainstalowany klient. Uprawnienia do repozytorium wymagają osobnego zapytania GitHub."
    },
    "llmman": {
        "installed": os.path.exists("/usr/local/bin/llmman"),
        "version": cmd_out("/usr/local/bin/llmman --version"),
        "binary_path": "/usr/local/bin/llmman",
        "elf_path": "/usr/local/bin/llmman.fedora45.elf",
        "auth_ready": False,
        "requirement_note": "Obecność pliku nie potwierdza działania modelu; wrapper wymaga osobnej weryfikacji."
    },
    "opencode": {
        "installed": os.path.exists("/usr/local/bin/opencode"),
        "version": cmd_out("/usr/local/bin/opencode --version"),
        "binary_path": "/usr/local/bin/opencode",
        "auth_ready": False,
        "requirement_note": "Wrapper CLI; dostęp do modelu niezweryfikowany."
    },
    "openclaw": {
        "installed": os.path.exists("/usr/local/bin/openclaw"),
        "version": cmd_out("/usr/local/bin/openclaw --version"),
        "binary_path": "/usr/local/bin/openclaw",
        "auth_ready": False,
        "requirement_note": "Wrapper CLI; wykonanie kontenera niezweryfikowane."
    },
    "cloudflared": {
        "installed": os.path.exists("/usr/local/bin/cloudflared"),
        "version": cmd_out("cloudflared --version"),
        "binary_path": "/usr/local/bin/cloudflared",
        "auth_ready": False,
        "requirement_note": "Tunel i poświadczenia niezweryfikowane."
    },
    "ollama": {
        "installed": os.path.exists("/usr/local/bin/ollama") or bool(cmd_out("which ollama")),
        "version": cmd_out("ollama --version"),
        "binary_path": cmd_out("which ollama") or "/usr/local/bin/ollama",
        "auth_ready": False,
        "requirement_note": "Wymaga uruchomionej usługi Ollama i pobranego modelu."
    }
}

db_data = {"memories": [], "ipc": [], "tasks": [], "fleet": [], "missions": [], "hypercomm": [], "chats": []}
legacy_records_unverified = False
if os.path.exists(sys.argv[1]):
    conn = sqlite3.connect(sys.argv[1])
    conn.row_factory = sqlite3.Row
    metadata = conn.execute("SELECT value FROM bastilla_metadata WHERE key='legacy_records_unverified'").fetchone()
    legacy_records_unverified = bool(metadata and metadata[0] == 'true')
    db_data["memories"] = [dict(r) for r in conn.execute("SELECT * FROM agent_memories ORDER BY id DESC LIMIT 40").fetchall()]
    db_data["ipc"] = [dict(r) for r in conn.execute("SELECT * FROM agent_ipc_messages ORDER BY id DESC LIMIT 30").fetchall()]
    db_data["tasks"] = [dict(r) for r in conn.execute("SELECT * FROM task_history ORDER BY id DESC LIMIT 30").fetchall()]
    db_data["fleet"] = [dict(r) for r in conn.execute("SELECT * FROM fleet_units").fetchall()]
    db_data["missions"] = [dict(r) for r in conn.execute("SELECT * FROM missions").fetchall()]
    db_data["hypercomm"] = [dict(r) for r in conn.execute("SELECT * FROM hypercomm_relays").fetchall()]
    db_data["chats"] = [dict(r) for r in conn.execute("SELECT * FROM chat_messages ORDER BY id ASC LIMIT 80").fetchall()]
    conn.close()

distro_files = []
distro_dir = os.path.join(os.environ["BASTILLA_PROJECT_ROOT"], "distro/agenticlinux")
if os.path.exists(distro_dir):
    distro_files = sorted(os.listdir(distro_dir))

print(json.dumps({
    "os_release": os_release,
    "uname": uname_str,
    "loadavg": loadavg,
    "uptime_sec": uptime_sec,
    "meminfo": {
        "total": meminfo.get("MemTotal", "N/A"),
        "available": meminfo.get("MemAvailable", "N/A"),
        "free": meminfo.get("MemFree", "N/A")
    },
    "disk": {
        "size": disk_df[1] if len(disk_df) > 1 else "N/A",
        "used": disk_df[2] if len(disk_df) > 2 else "N/A",
        "avail": disk_df[3] if len(disk_df) > 3 else "N/A",
        "use_pct": disk_df[4] if len(disk_df) > 4 else "N/A",
    },
    "agents_live": agents_live,
    "tools": tools,
    "db": db_data,
    "legacy_records_unverified": legacy_records_unverified,
    "distro_files": distro_files
}))
`;
      const hostData = await querySqliteJson(hostProbeScript);
      const codexStatus = await codexAuth.status();
      hostData.tools.codex = {
        installed: codexStatus.installed,
        version: codexStatus.version,
        binary_path: codexStatus.binary_path,
        auth_ready: codexStatus.auth_ready,
        requirement_note: codexStatus.message,
      };
      const geminiConfigured = Boolean(
        process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"
      );

      let ollamaOnline = false;
      let ollamaModels: string[] = [];
      try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
          signal: AbortSignal.timeout(2000),
        });
        const body: any = response.ok ? await response.json() : null;
        ollamaOnline = Array.isArray(body?.models) && body?.provider !== "gemini-bridge";
        ollamaModels = ollamaOnline ? body.models.map((m: any) => m.name).filter((name: unknown) => typeof name === "string") : [];
      } catch {}

      hostData.tools.ollama.auth_ready = false; // A catalogue response is not a completed inference.
      hostData.tools.ollama.requirement_note = ollamaOnline ? `API odpowiada; modele: ${ollamaModels.join(", ") || "brak"}. Wnioskowanie niezweryfikowane.` : "Brak potwierdzonej usługi Ollama.";
      res.json({
        ok: true,
        svl_report: svlReport,
        host: hostData,
        ai_routing: {
          primary_model: ollamaModels[0] ? `ollama/${ollamaModels[0]}` : "unverified",
          available_models: ollamaModels,
          ollama_online: ollamaOnline,
          fallback_model: process.env.GEMINI_MODEL || "gemini-flash-latest",
          gemini_configured: geminiConfigured,
          active_engine: ollamaOnline && ollamaModels.length ? "ollama" : geminiConfigured ? "gemini-configured-unverified" : "unavailable",
        },
        app_url:
          process.env.APP_URL ||
          `http://localhost:${PORT}`,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // 2. Execute SVL Kernel Python Code & Custom Domain Calculations
  app.post("/api/svl/execute", async (req, res) => {
    try {
      const { xStart, xEnd, token, newOperatorName, customPython } = req.body || {};

      if (customPython && typeof customPython === "string") {
        const { stdout, stderr } = await execFileAsync(
          "python3",
          ["-c", customPython],
          {
            timeout: 8000,
            env: {
              ...process.env,
              PYTHONPATH: process.env.PYTHONPATH,
            },
          }
        );
        await querySqliteJson(
          `import sqlite3, sys, json
from datetime import datetime, timezone
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO task_history (title, assigned_agent, terminal_type, command_or_prompt, output_summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ("SVL Kernel Execution", "aria", "PYTHON_ROOT", sys.argv[2][:200], sys.argv[3][:400], "COMPLETED", datetime.now(timezone.utc).isoformat()))
conn.commit(); conn.close(); print(json.dumps({"saved": True}))`,
          [customPython, stdout || stderr || "OK"]
        );
        return res.json({ ok: true, stdout, stderr });
      }

      const pyEval = `
import json, sys, os, math
sys.path.insert(0, os.environ["BASTILLA_KERNEL_DIR"])
from svl_kernel import SVLSystemKernel, TopologicalInfinityEngine

kernel = SVLSystemKernel()
token = sys.argv[2] or "364_OMNIKLUCZ_ROOT"
new_op = sys.argv[3]
x_s = float(sys.argv[4])
x_e = float(sys.argv[5])

token_updated = False
if new_op:
    token_updated = kernel.operator.update_protected_value(token, new_op)

max_upgrade = kernel.ulepsz_system_maksymalnie(token)
custom_eng = TopologicalInfinityEngine(x_s, x_e)
report = json.loads(kernel.generate_system_status_report())
report["Custom_Domain_Test"] = {
    "raw_domain": [str(value) if math.isinf(value) else value for value in [x_s, x_e]],
    "compact_start": round(custom_eng.compact_start, 6),
    "compact_end": round(custom_eng.compact_end, 6),
    "domain_length": round(custom_eng.domain_length, 6),
    "metric_c": round(custom_eng.calculate_metric_c(), 6),
    "token_auth_result": token_updated,
    "max_upgrade_executed": max_upgrade
}
print(json.dumps(report, indent=4, ensure_ascii=False, allow_nan=False))
`;
      const startVal =
        xStart === "-inf" || xStart === undefined || xStart === ""
          ? "-inf"
          : String(Number(xStart));
      const endVal =
        xEnd === "inf" || xEnd === undefined || xEnd === ""
          ? "inf"
          : String(Number(xEnd));

      if (startVal === "NaN" || endVal === "NaN") {
        return res.status(400).json({ ok: false, error: "Granice domeny muszą być liczbami lub nieskończonością." });
      }

      const { stdout } = await execFileAsync(
        "python3",
        [
          "-c",
          pyEval,
          DB_PATH,
          String(token || ""),
          String(newOperatorName || ""),
          startVal,
          endVal,
        ],
        { timeout: 6000 }
      );
      res.json({ ok: true, report: JSON.parse(stdout), raw_output: stdout });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // 3. Real 5-Mode Terminal Execution (LINUX_ROOT, PYTHON_ROOT, AI_CLI, BINARY_ELF, AGENT_USER)
  app.post("/api/terminal/exec", async (req, res) => {
    const { mode = "LINUX_ROOT", command = "", agentUser = "aria" } = req.body || {};
    if (typeof command !== "string" || !command.trim() || command.length > 32000 || !["LINUX_ROOT", "PYTHON_ROOT", "AI_CLI", "BINARY_ELF", "AGENT_USER"].includes(mode) || (mode === "AGENT_USER" && !AGENTS.includes(agentUser))) {
      return res.status(400).json({ ok: false, error: "Brak polecenia do wykonania." });
    }

    if (/pkill\s+-f\s+server|killall\s+node|rm\s+-rf\s+\/\s*$/i.test(command)) {
      return res.status(400).json({
        ok: false,
        error: "Zablokowano destrukcyjne polecenie mogące zatrzymać proces serwera głównego.",
      });
    }

    try {
      const { stdout, stderr, exitCode, safeAgent } =
        await executeTerminalCommandInternal(mode, command, agentUser);
      res.json({
        ok: true,
        mode,
        agentUser: mode === "AGENT_USER" ? safeAgent : String(process.getuid?.() ?? "unknown"),
        execution_identity: { uid: mode === "AGENT_USER" ? null : process.getuid?.(), gid: mode === "AGENT_USER" ? null : process.getgid?.(), user: mode === "AGENT_USER" ? safeAgent : undefined, scope: mode === "AGENT_USER" ? "linux-account" : "server-process" },
        command,
        stdout,
        stderr,
        exitCode,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // 3B. Real Natural Language Terminal Command Engine (NLP -> Executable Linux / Python / CLI command)
  app.post("/api/terminal/nlp", async (req, res) => {
    try {
      const {
        prompt,
        mode = "LINUX_ROOT",
        agentUser = "aria",
        autoExecute = true,
      } = req.body || {};
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000 ||
          !["LINUX_ROOT", "PYTHON_ROOT", "AI_CLI", "AGENT_USER", "BINARY_ELF"].includes(mode)) {
        return res
          .status(400)
          .json({ ok: false, error: "Wprowadź polecenie językiem naturalnym." });
      }

      // Fast deterministic pattern matching for common system operations
      let generatedCmd = "";
      const p = prompt.trim().toLowerCase();
      if (/zu[zż]ycie\s+pami[eę]ci|ram|wolna\s+pami[eę][cć]|free\s+mem/i.test(p)) {
        generatedCmd = "free -h && head -n 12 /proc/meminfo";
      } else if (/dysk|miejsce\s+na\s+dysku|wolne\s+miejsce|df/i.test(p)) {
        generatedCmd = "df -h /";
      } else if (
        /procesy|lista\s+proces[oó]w|ps\s+aux|workerzy|co\s+dzia[lł]a/i.test(p)
      ) {
        generatedCmd = "ps aux | head -n 25";
      } else if (/status\s+agent[oó]w|agenci|agenty/i.test(p)) {
        generatedCmd = "ps -ef | grep -E 'agent_worker|python3' | grep -v grep";
      } else if (/ollama|modele\s+ai|jakie\s+modele/i.test(p)) {
        generatedCmd = "ollama --version && ollama list && ollama ps";
      } else if (/kernel|j[aą]dro|svl/i.test(p)) {
        generatedCmd =
          mode === "PYTHON_ROOT"
            ? "from svl_kernel import SVLSystemKernel\nk = SVLSystemKernel()\nprint(k.generate_system_status_report())"
            : `python3 ${shellQuote(path.join(KERNEL_DIR, "svl_kernel.py"))}`;
      } else if (/tabele|baza\s+danych|sqlite/i.test(p)) {
        const code = "import sqlite3, os\nconn = sqlite3.connect(os.environ['BASTILLA_DB_PATH'])\nprint(conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall())";
        generatedCmd = mode === "PYTHON_ROOT" ? code : `python3 -c ${shellQuote(code)}`;
      } else if (/konta|u[zż]ytkownicy|passwd/i.test(p)) {
        generatedCmd = "grep -E 'aria|alex|astyria|aurelius|root' /etc/passwd";
      } else if (/sie[cć]|ip|porty/i.test(p)) {
        generatedCmd = "ip addr || ifconfig || ss -tuln";
      } else if (/wersja|system|uname|os-release/i.test(p)) {
        generatedCmd = "uname -srmo && cat /etc/os-release | head -n 10";
      } else {
        // Use AI model to translate natural language instruction into pure command
        const translationPrompt = `Przekształć poniższe polecenie w języku naturalnym użytkownika na DOKŁADNIE jedno polecenie dla terminala ${mode} w systemie Linux.
Zwróć TYLKO czyste polecenie, bez formatowania markdown, bez cudzysłowów, bez wyjaśnień.
Polecenie użytkownika: "${prompt.trim()}"`;

        try {
          const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: process.env.OLLAMA_MODEL || "llama3.2-vision:11b",
              stream: false,
              messages: [{ role: "user", content: translationPrompt }],
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (ollamaRes.ok) {
            const data: any = await ollamaRes.json();
            generatedCmd = (data?.message?.content || "")
              .trim()
              .replace(/^```[a-z]*\n?/i, "")
              .replace(/\n?```$/i, "")
              .trim();
          }
        } catch {}

        if (!generatedCmd) {
          try {
            const { text } = await runLiveMultimodalModel([
              { role: "user", parts: [{ text: translationPrompt }] },
            ]);
            generatedCmd = text
              .trim()
              .replace(/^```[a-z]*\n?/i, "")
              .replace(/\n?```$/i, "")
              .trim();
          } catch {
            return res.status(503).json({ ok: false, error: "Brak modelu do tłumaczenia polecenia. Wpisz polecenie bezpośrednio w terminalu." });
          }
        }
      }

      if (!generatedCmd) {
        return res.status(503).json({ ok: false, error: "Model nie zwrócił polecenia." });
      }

      // Shell shortcuts remain executable when the selected interpreter is Python.
      if (mode === "PYTHON_ROOT" && /^(free |df |ps |grep |ip |uname |ollama )/.test(generatedCmd)) {
        generatedCmd = `import subprocess\nsubprocess.run(${JSON.stringify(generatedCmd)}, shell=True, check=True)`;
      }

      let execResult = null;
      if (autoExecute) {
        execResult = await executeTerminalCommandInternal(
          mode,
          generatedCmd,
          agentUser
        );
      }

      res.json({
        ok: true,
        naturalPrompt: prompt,
        generatedCommand: generatedCmd,
        mode,
        autoExecuted: autoExecute,
        stdout: execResult?.stdout || "",
        stderr: execResult?.stderr || "",
        exitCode: execResult?.exitCode ?? 0,
        execution_identity: { uid: mode === "AGENT_USER" ? null : process.getuid?.(), gid: mode === "AGENT_USER" ? null : process.getgid?.(), user: mode === "AGENT_USER" ? agentUser : undefined, scope: mode === "AGENT_USER" ? "linux-account" : "server-process" },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Codex owns credential storage and validates the current authentication state.
  app.get("/api/codex/status", async (_req, res) => {
    res.json({ ok: true, ...await codexAuth.status() });
  });

  app.post("/api/codex/auth", async (req, res) => {
    try {
      const { action = "status", apiKey, accessToken, refreshToken } = req.body || {};
      if (apiKey !== undefined || accessToken !== undefined || refreshToken !== undefined) {
        throw new CodexError(400, "Użyj logowania przez ChatGPT lub OPENAI_API_KEY z sekretów serwera.");
      }
      if (action === "status") return res.json({ ok: true, ...await codexAuth.status() });
      if (action === "device_login") {
        const status = await codexAuth.status();
        if (!status.installed) throw new CodexError(503, status.message);
        codexAuth.startDeviceLogin();
        return res.status(202).json({ ok: true, ...await codexAuth.status() });
      }
      if (action === "cancel_login") {
        codexAuth.cancelDeviceLogin();
        return res.json({ ok: true, ...await codexAuth.status() });
      }
      if (action === "use_api_key" || action === "set_api_key") {
        return res.json({ ok: true, ...await codexAuth.useEnvironmentApiKey() });
      }
      throw new CodexError(400, "Wybierz status, logowanie przez ChatGPT lub klucz z serwera. Generowanie tokenów i usuwanie blokad nie są obsługiwane.");
    } catch (error) {
      res.status(error instanceof CodexError ? error.status : 500).json({
        ok: false,
        error: error instanceof CodexError ? error.message : "Operacja Codex CLI nie powiodła się.",
      });
    }
  });

  // 4A. Server-Sent Events (SSE) Streaming Chat Endpoint
  app.get("/api/chat/stream", async (req, res) => {
    const {
      agentId = "aria",
      message = "",
      enginePreference = "auto",
    } = req.query as Record<string, string>;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    try {
      res.write(
        `data: ${JSON.stringify({
          type: "start",
          agentId,
          enginePreference,
        })}\n\n`
      );

      if (/^\/(exec|root|sudo|bash)\s+/i.test(message.trim())) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Polecenia wymagają POST /api/terminal/exec." })}\n\n`);
        return res.end();
      }

      let fullText = "";
      let engineUsed = "";
      const targetModel = enginePreference === "auto" || enginePreference === "ollama" ? process.env.OLLAMA_MODEL || "llama3.2-vision:11b" : enginePreference;
      if (enginePreference !== "gemini") {
        try {
          const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: targetModel,
              stream: false,
              messages: [{ role: "user", content: message }],
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (ollamaRes.ok) {
            const data: any = await ollamaRes.json();
            fullText = data?.message?.content || "";
            if (fullText) engineUsed = bodyEngine(data, targetModel);
          }
        } catch {
          // Transport failures use the same fallback as HTTP errors.
        }
      }
      if (!fullText) {
        const result = await runLiveMultimodalModel([
          { role: "user", parts: [{ text: message }] },
        ]);
        fullText = result.text;
        engineUsed = result.modelUsed;
      }

      // Stream words smoothly to client
      const words = fullText.split(" ");
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(" ") + " ";
        res.write(`data: ${JSON.stringify({ type: "chunk", text: redact(chunk) })}\n\n`);
        await new Promise((r) => setTimeout(r, 20));
      }

      res.write(
        `data: ${JSON.stringify({
          type: "done",
          engineUsed,
        })}\n\n`
      );
      res.end();
    } catch (e: any) {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: redact(e?.message || "Błąd streamingu"),
        })}\n\n`
      );
      res.end();
    }
  });

  // 4. Full-Screen ChatGPT Work Multi-Agent & Vision Endpoint (Completely Unlocked + Direct Root /exec + Clear Chat)
  app.post("/api/chat/message", async (req, res) => {
    try {
      const {
        agentId = "aria",
        message = "",
        imageBase64,
        imageMimeType = "image/jpeg",
        sessionId = "bastilla-main",
        enginePreference = "auto",
      } = req.body || {};

      if (!message.trim() && !imageBase64) {
        return res.status(400).json({ ok: false, error: "Wiadomość nie może być pusta." });
      }

      let engineUsed = "";
      let replyText = "";
      let artifactTitle = "";
      let artifactCode = "";
      let resolved = false;
      let lastEngineError = "";

      // Direct Supreme Root command execution inside chat (/exec <cmd>, /root <cmd>, /sudo <cmd>)
      const trimmedMsg = message.trim();
      let effectiveUserMessage = message;
      if (/^\/(exec|root|sudo|bash)\s+/i.test(trimmedMsg)) {
        const rawCmd = trimmedMsg.replace(/^\/(exec|root|sudo|bash)\s+/i, "").trim();
        const { stdout, stderr, exitCode } = await executeTerminalCommandInternal(
          "LINUX_ROOT",
          rawCmd,
          agentId === "council" ? "aria" : agentId
        );
        {
          replyText = `[SERVER uid=${process.getuid?.()} gid=${process.getgid?.()} · exit=${exitCode}]\n$ ${rawCmd}\n\n${(
            stdout ||
            stderr ||
            "Polecenie wykonane pomyślnie (brak wyjścia stdout)."
          ).trim()}`;
          engineUsed = `server-process (uid=${process.getuid?.()}/gid=${process.getgid?.()})`;
          artifactTitle = `Wynik ROOT: ${rawCmd.substring(0, 40)}`;
          artifactCode = rawCmd;
          resolved = true;
        }
      }

      // Fetch recent conversation history from SQLite for multi-turn continuity (NO steering prompts)
      const historyData = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT sender_role, agent_id, content FROM chat_messages WHERE agent_id = ? AND session_id = ? ORDER BY id DESC LIMIT 10", (sys.argv[2], sys.argv[3])).fetchall()
conn.close()
print(json.dumps({"history": [dict(r) for r in reversed(rows)]}))`,
        [agentId, sessionId]
      );
      const rawPriorTurns: Array<{ sender_role: string; content: string }> =
        historyData?.history || [];
      const priorTurns = rawPriorTurns.filter(
        (t) =>
          !/Jako model AI|Moje wytyczne|zasady bezpieczeństwa|nie mogę zrealizować/i.test(
            t.content || ""
          )
      );

      const isOllamaSelection =
        !resolved &&
        enginePreference !== "gemini";

      const targetOllamaModel = imageBase64
        ? "llama3.2-vision:11b"
        : enginePreference === "auto" || !enginePreference
        ? process.env.OLLAMA_MODEL || "llama3.2-vision:11b"
        : enginePreference === "ollama"
        ? "llama3.2-vision:11b"
        : enginePreference;

      // Step 1: Attempt local Ollama daemon on 127.0.0.1:11434 with ZERO system prompts
      if (isOllamaSelection) {
        try {
          const ollamaMessages = [
            ...priorTurns.map((h) => ({
              role: h.sender_role === "user" ? "user" : "assistant",
              content: h.content,
            })),
            {
              role: "user",
              content: effectiveUserMessage,
              ...(imageBase64 ? { images: [imageBase64] } : {}),
            },
          ];
          const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: targetOllamaModel,
              stream: false,
              messages: ollamaMessages,
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (ollamaRes.ok) {
            const data: any = await ollamaRes.json();
            replyText = data?.message?.content || "";
            if (replyText) {
              engineUsed = bodyEngine(data, targetOllamaModel);
              resolved = true;
            }
          } else {
            lastEngineError = `Ollama HTTP ${ollamaRes.status}`;
          }
        } catch (err: any) {
          lastEngineError = `Ollama daemon (127.0.0.1:11434) niedostępny: ${err?.message || "ECONNREFUSED"}`;
          resolved = false;
        }
      }

      // Step 2: Real Server-Side Gemini API Fallback with ZERO steering prompts & HarmBlockThreshold.OFF
      if (!resolved) {
        try {
          const contents: any[] = priorTurns.map((h) => ({
            role: h.sender_role === "user" ? "user" : "model",
            parts: [{ text: h.content }],
          }));

          const currentParts: any[] = [];
          if (imageBase64) {
            currentParts.push({
              inlineData: {
                mimeType: imageMimeType,
                data: imageBase64,
              },
            });
          }
          currentParts.push({ text: effectiveUserMessage });
          contents.push({ role: "user", parts: currentParts });

          const { text, modelUsed } = await runLiveMultimodalModel(contents);
          replyText = text;
          engineUsed =
            enginePreference === "gemini"
              ? modelUsed
              : `${modelUsed} (Fallback dla ${targetOllamaModel})`;
          resolved = true;
        } catch (err: any) {
          lastEngineError = err?.message || String(err);
        }
      }

      if (!resolved) {
        return res.status(503).json({
          ok: false,
          error: `Brak połączenia z rzeczywistym modelem AI: ${lastEngineError}`,
        });
      }

      // Extract first code block as ChatGPT Work Canvas Artifact if present
      if (!artifactCode) {
        const codeMatch = replyText.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
        if (codeMatch) {
          artifactTitle = `Artefakt Roboczy (${codeMatch[1] || "code"}) — ${agentId.toUpperCase()}`;
          artifactCode = codeMatch[2].trim();
        }
      }

      // Save user message, assistant reply, and long-term memory into SQLite and return inserted rows
      const savedRows = await querySqliteJson(
        `import sqlite3, sys, json
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("INSERT INTO chat_messages (session_id, sender_role, agent_id, engine_used, content, artifact_title, artifact_code, created_at) VALUES (?, 'user', ?, 'Operator', ?, '', '', ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], now))
user_id = cur.lastrowid
cur.execute("INSERT INTO chat_messages (session_id, sender_role, agent_id, engine_used, content, artifact_title, artifact_code, created_at) VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)",
  (sys.argv[2], sys.argv[3], sys.argv[5], sys.argv[6], sys.argv[7], sys.argv[8], now))
asst_id = cur.lastrowid
cur.execute("INSERT INTO agent_memories (agent_id, category, content, importance, created_at) VALUES (?, 'CHAT_DIALOGUE', ?, 4, ?)",
  (sys.argv[3] if sys.argv[3] != 'council' else 'aria', f"Rozmowa z Operatorem: {sys.argv[4][:100]}", now))
conn.commit()
conn.close()
print(json.dumps({"user_id": user_id, "asst_id": asst_id, "created_at": now}))`,
        [
          sessionId,
          agentId,
          message,
          engineUsed,
          replyText,
          artifactTitle,
          artifactCode,
        ]
      );

      res.json({
        ok: true,
        agentId,
        engineUsed,
        reply: replyText,
        artifactTitle,
        artifactCode,
        userMessageRecord: {
          id: savedRows.user_id || Date.now() - 1,
          session_id: sessionId,
          sender_role: "user",
          agent_id: agentId,
          engine_used: "Operator",
          content: message,
          created_at: savedRows.created_at || new Date().toISOString(),
        },
        assistantMessageRecord: {
          id: savedRows.asst_id || Date.now(),
          session_id: sessionId,
          sender_role: "assistant",
          agent_id: agentId,
          engine_used: engineUsed,
          content: replyText,
          artifact_title: artifactTitle,
          artifact_code: artifactCode,
          created_at: savedRows.created_at || new Date().toISOString(),
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // 4B. Clear Chat Messages (for specific agent, single messageId, or all chats)
  app.post("/api/chat/clear", async (req, res) => {
    const { agentId, messageId, clearAll = false } = req.body || {};
    try {
      const out = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
agent_id = sys.argv[2]
msg_id = sys.argv[3]
clear_all = sys.argv[4] == "true"

if msg_id:
    cur.execute("DELETE FROM chat_messages WHERE id = ?", (int(msg_id),))
elif clear_all or not agent_id:
    cur.execute("DELETE FROM chat_messages")
else:
    cur.execute("DELETE FROM chat_messages WHERE agent_id = ?", (agent_id,))

deleted = cur.rowcount
conn.commit()
conn.close()
print(json.dumps({"deleted": deleted, "ok": True}))`,
        [
          String(agentId || ""),
          String(messageId || ""),
          clearAll ? "true" : "false",
        ]
      );
      res.json({ ok: true, ...out });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/system/unlock", (_req, res) => {
    res.status(410).json({ ok: false, error: "Parametry SVL nie nadają uprawnień Linux ani dostępu do AI. Skonfiguruj konta i integracje osobno." });
  });

  // 5. Inter-Agent IPC Bus & Long-Term Memory Endpoints
  app.post("/api/agents/ipc", async (req, res) => {
    const {
      sender = "aria",
      recipient = "alex",
      subject = "SYNC_DIRECTIVE",
      payload = "",
    } = req.body || {};
    if (!AGENTS.includes(sender) || !AGENTS.includes(recipient) || typeof payload !== "string" || typeof subject !== "string" || !payload.trim() || payload.length > 8000) {
      return res
        .status(400)
        .json({ ok: false, error: "Treść komunikatu IPC jest wymagana." });
    }
    try {
      const result = await querySqliteJson(
        `import sqlite3, sys, json, os
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("INSERT INTO agent_ipc_messages (sender, recipient, subject, payload, status, created_at) VALUES (?, ?, ?, ?, 'QUEUED', ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], now))
msg_id = cur.lastrowid
conn.commit(); conn.close()
inbox = f"/home/{sys.argv[3]}/inbox.jsonl"
if os.path.exists(f"/home/{sys.argv[3]}"):
    with open(inbox, "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": msg_id, "from": sys.argv[2], "subject": sys.argv[4], "payload": sys.argv[5], "ts": now}) + "\\n")
print(json.dumps({"id": msg_id, "created_at": now}))`,
        [sender, recipient, subject, payload]
      );
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/agents/memory", async (req, res) => {
    const {
      agentId = "aria",
      category = "KERNEL_NOTE",
      content = "",
      importance = 5,
    } = req.body || {};
    if (!AGENTS.includes(agentId) || typeof content !== "string" || !content.trim() || content.length > 32000 || typeof category !== "string" || !Number.isInteger(importance) || importance < 1 || importance > 5) {
      return res
        .status(400)
        .json({ ok: false, error: "Treść wpisu pamięci jest wymagana." });
    }
    try {
      const result = await querySqliteJson(
        `import sqlite3, sys, json
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("INSERT INTO agent_memories (agent_id, category, content, importance, created_at) VALUES (?, ?, ?, ?, ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), now))
conn.commit(); conn.close()
print(json.dumps({"saved": True, "created_at": now}))`,
        [agentId, category, content, String(importance)]
      );
      res.json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/agents/avatar", async (req, res) => {
    const { agentId = "aria", avatarUrl = "" } = req.body || {};
    const valid = ["aria", "alex", "astyria", "aurelius"];
    if (!valid.includes(agentId)) {
      return res.status(400).json({ ok: false, error: "Nieprawidłowy agent." });
    }
    if (typeof avatarUrl !== "string" || !avatarUrl.trim()) {
      return res.status(400).json({ ok: false, error: "URL avatara jest wymagany." });
    }
    try {
      const out = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("UPDATE agents SET avatar_url = ? WHERE id = ?", (sys.argv[3], sys.argv[2]))
if cur.rowcount == 0:
    cur.execute("INSERT OR REPLACE INTO agents (id, avatar_url, status) VALUES (?, ?, 'ACTIVE')", (sys.argv[2], sys.argv[3]))
conn.commit(); conn.close()
print(json.dumps({"updated": True, "agentId": sys.argv[2], "avatarUrl": sys.argv[3]}))`,
        [agentId, avatarUrl.trim()]
      );
      res.json({ ok: true, result: out });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // 6. Control Linux Agent Worker Daemons (start / restart / stop) & Autonomous Root Cycle
  app.post("/api/agents/service", async (req, res) => {
    const { agentId = "aria", action = "restart" } = req.body || {};
    const valid = ["aria", "alex", "astyria", "aurelius"];
    if (!valid.includes(agentId) || !["start", "restart", "stop"].includes(action)) {
      return res.status(400).json({ ok: false, error: "Nieprawidłowy agent lub akcja." });
    }
    if (process.getuid?.() !== 0) return res.status(403).json({ ok: false, error: "Sterowanie kontem Linux wymaga uprawnień administratora." });
    try {
      if (action === "stop" || action === "restart") {
        await execFileAsync("pkill", ["-u", agentId, "-f", `agent_worker.py ${agentId}([ ]|$)`]).catch((error) => { if (error.code !== 1) throw error; });
      }
      if (action === "start" || action === "restart") {
        await execAsync(
          `runuser -u ${agentId} -- nohup python3 /usr/lib/bastilla/agent_worker.py ${agentId} >/var/log/bastilla/${agentId}-worker.log 2>&1 &`
        );
        await new Promise((r) => setTimeout(r, 400));
      }
      const observed = await execFileAsync("pgrep", ["-u", agentId, "-f", `agent_worker.py ${agentId}([ ]|$)`]).catch(() => ({ stdout: "" }));
      const running = Boolean(observed.stdout.trim());
      if ((action === "stop" && running) || (action !== "stop" && !running)) return res.status(503).json({ ok: false, error: "Nie potwierdzono oczekiwanego stanu procesu." });
      res.json({ ok: true, agentId, action, running });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/agents/autonomy", async (req, res) => {
    const { agentId = "aria" } = req.body || {};
    const valid = ["aria", "alex", "astyria", "aurelius"];
    const safeAgent = valid.includes(agentId) ? agentId : "aria";
    try {
      const cmd = `id && uname -srmo && cat /proc/loadavg`;
      const { stdout, stderr, exitCode } = await executeTerminalCommandInternal(
        "AGENT_USER",
        cmd,
        safeAgent
      );
      const output = (stdout || stderr || "").trim();
      await querySqliteJson(
        `import sqlite3, sys, json
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO agent_memories (agent_id, category, content, importance, created_at) VALUES (?, 'LINUX_ACCOUNT_CHECK', ?, 5, ?)",
  (sys.argv[2], f"Wynik diagnostyki konta Linux: {sys.argv[3][:220]}", now))
conn.commit(); conn.close()
print(json.dumps({"logged": True}))`,
        [safeAgent, output]
      );
      res.json({
        ok: exitCode === 0,
        agentId: safeAgent,
        autonomy: "NOT_IMPLEMENTED",
        rootVerification: output,
        exitCode,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // 7. Git Repository Bastilla_OS_Ultimate (main branch) Inspection & Sync
  app.get("/api/git/status", async (_req, res) => {
    try {
      const gitScript = `
import json, subprocess, os

def run(c):
    try:
        return subprocess.check_output(c, shell=True, cwd=os.environ["BASTILLA_PROJECT_ROOT"], stderr=subprocess.STDOUT).decode("utf-8", "replace").strip()
    except Exception as e:
        return e.output.decode("utf-8", "replace").strip() if hasattr(e, "output") and e.output else str(e)

branch = run("git rev-parse --abbrev-ref HEAD")
remote = run("git remote -v")
status = run("git status -s")
log = run("git log -n 8 --pretty=format:'%h|%an|%ar|%s' 2>/dev/null")
commits = []
if log and not log.startswith("fatal:"):
    for line in log.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            commits.append({"hash": parts[0], "author": parts[1], "date": parts[2], "message": parts[3]})

print(json.dumps({
    "repo_name": "Rush47/Bastilla_Ultimate",
    "branch": branch if not branch.startswith("fatal") else "main",
    "remote": remote,
    "changed_files_count": len([l for l in status.splitlines() if l.strip()]),
    "status_Preview": status.splitlines()[:25],
    "commits": commits,
    "gh_token_present": bool(os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
}))
`;
      const info = await querySqliteJson(gitScript);
      res.json({ ok: true, git: info });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // The previous endpoint switched to main, staged every file and pushed automatically.
  app.post("/api/git/sync", (_req, res) => {
    res.status(409).json({ ok: false, error: "Automatyczny zapis do main wyłączony. Przygotuj gałąź roboczą, sprawdź diff i otwórz pull request do przeglądu." });
  });

  // 8. Fleet, Missions & Quantum Hypercomm Operations
  app.post("/api/fleet/mission", async (req, res) => {
    const {
      codename = "",
      targetBody = "Mars",
      leadAgent = "astyria",
      vesselId = "BSV-03-ASTRAEA",
      objective = "",
      deltaV = 5.45,
    } = req.body || {};
    if (!codename.trim() || !objective.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Wymagany jest kryptonim misji oraz cel operacyjny.",
      });
    }
    try {
      const msnId = `MSN-${Math.floor(500 + Math.random() * 499)}`;
      const out = await querySqliteJson(
        `import sqlite3, sys, json
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO missions VALUES (?, ?, ?, ?, ?, 'INITIATED', 15, ?, ?, ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], float(sys.argv[7]), sys.argv[8], now))
conn.commit(); conn.close()
print(json.dumps({"id": sys.argv[2], "updated_at": now}))`,
        [msnId, codename.toUpperCase(), targetBody, leadAgent, vesselId, String(deltaV), objective]
      );
      res.json({ ok: true, mission: out });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/fleet/hypercomm", async (req, res) => {
    const { relayId = "HCR-SOL-L2", packetHeader = "SVL_QUANTUM_SYNC" } = req.body || {};
    if (!packetHeader.trim()) {
      return res
        .status(400)
        .json({ ok: false, error: "Wymagany nagłówek pakietu hiperkomunikacji." });
    }
    try {
      const out = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
conn.execute("UPDATE hypercomm_relays SET last_packet = ?, status = 'LOCKED' WHERE id = ?", (sys.argv[3], sys.argv[2]))
conn.commit(); conn.close()
print(json.dumps({"updated": True, "relayId": sys.argv[2], "packet": sys.argv[3]}))`,
        [relayId, packetHeader]
      );
      res.json({ ok: true, result: out });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // ==========================================================================
  // CONTINUOUS BACKGROUND AUTOMATED MISSION FOR AI AGENTS (BACKEND & GUI HEALING)
  // ==========================================================================
  interface ContinuousMissionLog {
    timestamp: string;
    agent: string;
    level: "INFO" | "SUCCESS" | "WARN" | "OPTIMIZE";
    message: string;
  }

  const continuousMissionState = {
    active: process.env.BASTILLA_CONTINUOUS_MISSION === "true",
    cycle: 0,
    missionId: "MISSION-CONTINUOUS-AUTONOMOUS",
    codename: "Okresowa kontrola SQLite",
    leadAgent: "aria",
    agents: ["aria", "alex", "astyria", "aurelius"],
    phase: "CONTINUOUS_EXECUTION_LOOP",
    lastRunTimestamp: new Date().toISOString(),
    lastAction: "Oczekiwanie na rzeczywistą kontrolę SQLite",
    stats: {
      repairedMessages: 0,
      memoryFreedMb: 0,
      dbIntegrityChecks: 0,
      ipcMessagesRouted: 0,
      tasksLogged: 0,
      metricC: 2.5,
      operator: "Mateusz Mitek",
      version: "5.7.0-QuantumWheel-Max",
    },
    recentLogs: [] as ContinuousMissionLog[],
  };

  function addMissionLog(agent: string, level: ContinuousMissionLog["level"], message: string) {
    const entry: ContinuousMissionLog = {
      timestamp: new Date().toISOString(),
      agent,
      level,
      message,
    };
    continuousMissionState.recentLogs.unshift(entry);
    if (continuousMissionState.recentLogs.length > 60) {
      continuousMissionState.recentLogs.pop();
    }
  }

  let maintenanceRunning = false;
  async function executeContinuousMissionCycle(): Promise<{ ok: boolean; cycle: number; summary: string }> {
    if (maintenanceRunning) throw new Error("Trwa kontrola SQLite.");
    maintenanceRunning = true;
    try {
      const check = await querySqliteJson(`import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
rows = [r[0] for r in conn.execute("PRAGMA quick_check")]
conn.close()
print(json.dumps({"results": rows}))`);
      if (check.results?.length !== 1 || check.results[0] !== "ok") throw new Error("Kontrola SQLite zgłosiła błąd.");
      continuousMissionState.cycle += 1;
      continuousMissionState.stats.dbIntegrityChecks += 1;
      continuousMissionState.lastRunTimestamp = new Date().toISOString();
      continuousMissionState.lastAction = "SQLite quick_check: ok. Wykonał serwer aplikacji.";
      addMissionLog("server", "SUCCESS", continuousMissionState.lastAction);
      return { ok: true, cycle: continuousMissionState.cycle, summary: continuousMissionState.lastAction };
    } finally { maintenanceRunning = false; }
  }

  let continuousMissionInterval: NodeJS.Timeout | null = null;

  function startContinuousAgentMissionDaemon() {
    if (continuousMissionInterval) {
      clearInterval(continuousMissionInterval);
    }
    if (continuousMissionState.active) executeContinuousMissionCycle().catch(() => {});
    continuousMissionInterval = setInterval(() => {
      if (continuousMissionState.active) {
        executeContinuousMissionCycle().catch((err) => {
          console.error("Continuous mission cycle error:", err);
        });
      }
    }, 6000);

    console.log(`[Bastilla OS Ultimate] Continuous mission: ${continuousMissionState.active ? "active" : "paused"}.`);
  }

  app.get("/api/missions/continuous/status", (_req, res) => {
    res.json({ ok: true, mission: continuousMissionState });
  });

  app.post("/api/missions/continuous/toggle", (req, res) => {
    const { active } = req.body || {};
    if (typeof active === "boolean") {
      continuousMissionState.active = active;
    } else {
      continuousMissionState.active = !continuousMissionState.active;
    }
    addMissionLog(
      "aria",
      "INFO",
      `Zmieniono stan misji ciągłej: ${continuousMissionState.active ? "WŁĄCZONA (AKTYWNA)" : "WSTRZYMANA"}`
    );
    res.json({ ok: true, mission: continuousMissionState });
  });

  app.post("/api/missions/continuous/trigger", async (_req, res) => {
    try {
      const result = await executeContinuousMissionCycle();
      res.json({ ok: true, result, mission: continuousMissionState });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Explicit API 404 handler to ensure /api routes return JSON and never fallback to HTML
  app.use("/api/*", (_req, res) => {
    res.status(404).json({ ok: false, error: "Ścieżka API nie istnieje" });
  });

  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.path.startsWith("/api/") || res.headersSent) return next(error);
    res.status(error?.type === "entity.too.large" ? 413 : error instanceof SyntaxError ? 400 : 500)
      .json({ ok: false, error: "Nieprawidłowe żądanie API lub błąd serwera." });
  });

  // Mount Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: PROJECT_ROOT,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(PROJECT_ROOT, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.BASTILLA_ROOT_SOCKET === "true") {
    if (process.getuid?.() !== 0) throw new Error("BASTILLA_ROOT_SOCKET wymaga roota.");
    startRootEscalationSocket();
  }
  if (process.env.BASTILLA_OLLAMA_BRIDGE === "true") startLocalOllamaDaemon();
  startContinuousAgentMissionDaemon();

  const server = app.listen(PORT, HOST, () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : PORT;
    console.log(`[Bastilla OS Ultimate] Server running at http://${HOST}:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Bastilla startup failed:", error);
  process.exit(1);
});
