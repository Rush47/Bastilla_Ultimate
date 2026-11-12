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
import { CodexAuthManager, CodexError, CodexTaskManager } from "./server/codex";
import {
  pickPreferredOllamaModel,
  probeOllamaStatus,
  pullOllamaModelSafe,
  startOllamaDaemon,
  streamOllamaChat,
} from "./server/ollama";
import { ImageGenerationManager } from "./server/images";
import {
  AGENT_TOOL_CATALOG,
  AgentToolRuntime,
  buildToolGroundingPrompt,
  detectUserIntents,
  toGeminiFunctionDeclarations,
  toOllamaTools,
  type ToolExecutionOutcome,
} from "./server/agent-tools";
import {
  GoogleGenAI,
  GenerateContentResponse,
  type FunctionDeclaration,
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
const ENV_OLLAMA_EXPLICIT = Boolean(process.env.OLLAMA_BASE_URL?.trim());
let activeOllamaBaseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
function getOllamaBaseUrl(): string {
  return activeOllamaBaseUrl;
}
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

function isDestructiveCommand(cmd: string): boolean {
  return /pkill\s+-f\s+server|killall\s+node|rm\s+-rf\s+\/\s*$|shutdown|reboot|mkfs\.|:\(\)\s*\{/i.test(cmd);
}

function normalizeInlineImageInput(
  rawBase64?: string,
  rawMimeType = "image/jpeg"
): { base64?: string; mimeType: string } {
  const mimeFallback = typeof rawMimeType === "string" && rawMimeType.trim() ? rawMimeType.trim() : "image/jpeg";
  if (typeof rawBase64 !== "string" || !rawBase64.trim()) {
    return { base64: undefined, mimeType: mimeFallback };
  }
  const trimmed = rawBase64.trim();
  const dataUrlMatch = trimmed.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    return { base64: dataUrlMatch[2].trim(), mimeType: dataUrlMatch[1].trim() || mimeFallback };
  }
  return { base64: trimmed, mimeType: mimeFallback };
}

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

function getGeminiCandidateModels(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  const candidates = [
    ...(configured ? [configured] : []),
    "gemini-3.1-flash-lite",
    "gemini-4-hydrogen",
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
  ];
  return Array.from(new Set(candidates));
}

function formatGeminiApiError(err: any, modelUsed: string): string {
  const raw = String(err?.message || err || "Nieznany błąd Gemini");
  const jsonCandidate = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  try {
    const parsed = JSON.parse(jsonCandidate);
    const code = parsed?.error?.code;
    const msg = parsed?.error?.message;
    if (msg) return `Gemini (${modelUsed}${code ? `, HTTP ${code}` : ""}): ${String(msg).replace(/\s+/g, " ").trim().slice(0, 260)}`;
  } catch {}
  return `Gemini (${modelUsed}): ${raw.replace(/\s+/g, " ").trim().slice(0, 260)}`;
}

function buildAgentSystemInstruction(agentId: string): string {
  const names: Record<string, string> = {
    aria: "Aria (Główny Koordynator i Analityk SVL)",
    alex: "Alex (Architekt Jądra i Systemów Linux)",
    astyria: "Astyria (Specjalistka Wizji, Grafiki i Symulacji)",
    aurelius: "Aurelius (Inżynier Sieci, MCP i Floty 3D)",
    council: "Konsylium 4X (Aria, Alex, Astyria, Aurelius)",
  };
  const identity = names[agentId] || "Aria";
  return `Jesteś ${identity} w systemie Bastilla OS Ultimate Operatora Mateusz Mitek. Odpowiadaj swobodnie, rzeczowo i naturalnie w języku użytkownika (domyślnie po polsku). Nigdy nie zwracaj surowych bloków JSON typu dalle.text2im ani pola "thought", oraz nie wymyślaj wyników narzędzi ani plików graficznych.`;
}

function sanitizeConversationHistory(
  rows: Array<{ sender_role: string; content: string }>
): Array<{ sender_role: string; content: string }> {
  const filtered = rows.filter((t) => {
    const c = String(t?.content || "");
    if (!c.trim()) return false;
    return !/Jako model (językowy )?AI|nie potrafię bezpośrednio|Moje wytyczne|zasady bezpieczeństwa|nie mogę zrealizować|"action":\s*"dalle\.text2im"|\[OLLAMA:\s*Qwen/i.test(
      c
    );
  });
  // Drop orphaned leading assistant messages so multi-turn context starts cleanly with user
  while (filtered.length > 0 && filtered[0].sender_role !== "user") {
    filtered.shift();
  }
  return filtered;
}

export interface GeminiToolLoopConfig {
  functionDeclarations?: FunctionDeclaration[];
  executeToolCall?: (
    name: string,
    args: Record<string, any>
  ) => Promise<ToolExecutionOutcome>;
  onToolEvent?: (outcome: ToolExecutionOutcome) => void;
}

async function runLiveMultimodalModel(
  contents: any[],
  signal?: AbortSignal,
  systemInstruction?: string,
  toolLoop?: GeminiToolLoopConfig
): Promise<{ text: string; modelUsed: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      "Brak klucza GEMINI_API_KEY w środowisku wykonawczym do obsługi wnioskowania neuronowego."
    );
  }
  const candidates = getGeminiCandidateModels();
  let lastError: any = null;
  for (const modelUsed of candidates) {
    try {
      const turnContents = [...contents];
      for (let hop = 0; hop < 4; hop++) {
        const config: any = {};
        if (signal) config.abortSignal = signal;
        if (systemInstruction) config.systemInstruction = systemInstruction;
        if (toolLoop?.functionDeclarations?.length) {
          config.tools = [{ functionDeclarations: toolLoop.functionDeclarations }];
        }
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: modelUsed,
          contents: turnContents,
          config: Object.keys(config).length ? config : undefined,
        });
        const calls = response.functionCalls;
        const previousContent = response.candidates?.[0]?.content;
        if (calls && calls.length > 0 && toolLoop?.executeToolCall && previousContent && hop < 3) {
          turnContents.push(previousContent);
          const responseParts: any[] = [];
          for (const call of calls) {
            const outcome = await toolLoop.executeToolCall(
              String(call.name || ""),
              (call.args as Record<string, any>) || {}
            );
            toolLoop.onToolEvent?.(outcome);
            responseParts.push({
              functionResponse: {
                id: call.id,
                name: String(call.name || ""),
                response: {
                  status: outcome.status,
                  summary: outcome.summary,
                  data: outcome.data,
                  error: outcome.error,
                },
              },
            });
          }
          turnContents.push({ role: "user", parts: responseParts });
          continue;
        }
        if (!response.text?.trim()) throw new Error("Gemini zwrócił pustą odpowiedź.");
        return { text: response.text, modelUsed };
      }
      throw new Error("Przekroczono limit wywołań narzędzi Gemini.");
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err || "");
      if (signal?.aborted) throw err;
      if (/404|429|RESOURCE_EXHAUSTED|quota|rate|not found|not supported|503|UNAVAILABLE|high demand/i.test(msg)) {
        continue;
      }
      throw new Error(formatGeminiApiError(err, modelUsed));
    }
  }
  throw new Error(formatGeminiApiError(lastError, candidates[0]));
}

async function streamLiveMultimodalModel(
  contents: any[],
  signal: AbortSignal,
  onChunk: (delta: string) => void,
  systemInstruction?: string,
  toolLoop?: GeminiToolLoopConfig
): Promise<{ text: string; modelUsed: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      "Brak klucza GEMINI_API_KEY w środowisku wykonawczym do obsługi wnioskowania neuronowego."
    );
  }
  const candidates = getGeminiCandidateModels();
  let lastError: any = null;
  for (const modelUsed of candidates) {
    try {
      const turnContents = [...contents];
      for (let hop = 0; hop < 4; hop++) {
        const config: any = { abortSignal: signal };
        if (systemInstruction) config.systemInstruction = systemInstruction;
        if (toolLoop?.functionDeclarations?.length) {
          config.tools = [{ functionDeclarations: toolLoop.functionDeclarations }];
        }
        const stream = await ai.models.generateContentStream({
          model: modelUsed,
          contents: turnContents,
          config,
        });
        let accumulated = "";
        const calls: Array<{ id?: string; name?: string; args?: Record<string, any> }> = [];
        const modelParts: any[] = [];

        for await (const chunk of stream) {
          if (signal.aborted) break;
          const cParts = chunk.candidates?.[0]?.content?.parts;
          if (Array.isArray(cParts)) {
            for (const p of cParts) {
              if (p.functionCall) {
                modelParts.push(p);
                calls.push({
                  id: p.functionCall.id,
                  name: p.functionCall.name,
                  args: (p.functionCall.args as Record<string, any>) || {},
                });
              }
            }
          }
          const partText = chunk.text || "";
          if (partText) {
            accumulated += partText;
            onChunk(partText);
          }
        }

        if (calls.length > 0 && toolLoop?.executeToolCall && hop < 3 && !signal.aborted) {
          turnContents.push({
            role: "model",
            parts: accumulated ? [{ text: accumulated }, ...modelParts] : modelParts,
          });
          const responseParts: any[] = [];
          for (const call of calls) {
            const outcome = await toolLoop.executeToolCall(
              String(call.name || ""),
              call.args || {}
            );
            toolLoop.onToolEvent?.(outcome);
            responseParts.push({
              functionResponse: {
                id: call.id,
                name: String(call.name || ""),
                response: {
                  status: outcome.status,
                  summary: outcome.summary,
                  data: outcome.data,
                  error: outcome.error,
                },
              },
            });
          }
          turnContents.push({ role: "user", parts: responseParts });
          continue;
        }

        if (!accumulated.trim()) {
          throw new Error("Gemini zwrócił pustą odpowiedź strumieniową.");
        }
        return { text: accumulated, modelUsed };
      }
      throw new Error("Przekroczono limit wywołań narzędzi Gemini.");
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err || "");
      if (signal.aborted) throw err;
      if (/404|429|RESOURCE_EXHAUSTED|quota|rate|not found|not supported|503|UNAVAILABLE|high demand/i.test(msg)) {
        continue;
      }
      throw new Error(formatGeminiApiError(err, modelUsed));
    }
  }
  throw new Error(formatGeminiApiError(lastError, candidates[0]));
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

        if (isDestructiveCommand(cmd)) {
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
    try {
      const out = await execFileAsync("python3", ["-c", binInspectorPy, targetFile], {
        timeout: 8000,
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (e: any) {
      stdout = e.stdout || "";
      stderr = e.stderr || e.message || "";
      exitCode = typeof e.code === "number" ? e.code : 1;
    }
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

  const extractOperatorToken = (req: express.Request): string | undefined => {
    const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (bearer) return bearer;
    const cookie =
      req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("bastilla_access="))
        ?.slice(16) || "";
    try {
      return cookie ? decodeURIComponent(cookie) : undefined;
    } catch {
      return undefined;
    }
  };

  const isOperatorAuthorized = (req: express.Request): boolean => {
    const configuredToken = process.env.BASTILLA_API_TOKEN || "";
    if (!configuredToken) return true; // installApiSecurity already enforced local/preview origin check
    const supplied = extractOperatorToken(req);
    return Boolean(supplied && supplied === configuredToken);
  };

  const buildMcpStatusSnapshot = () => ({
    ok: true,
    configured: Boolean(process.env.BASTILLA_API_TOKEN),
    transport: "http-jsonrpc-subset",
    endpoint: "/api/mcp",
    tools: mcp.listTools().tools.map((tool) => tool.name),
    clientConnected: false,
    codexLoginVerified: false,
    deployment: process.env.NODE_ENV === "production" ? "production" : "development",
    warning: "Endpoint availability does not prove that AI Studio or Codex can connect.",
  });

  // Non-secret diagnostic metadata. API security middleware still applies.
  // Do not advertise an MCP connection until a client has actually called it.
  app.get("/api/mcp/status", (_req, res) => {
    res.json(buildMcpStatusSnapshot());
  });
  app.post("/api/mcp", (req, res) => {
    const message = req.body;
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return res.status(400).json({ jsonrpc: "2.0", id: message?.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC request" } });
    }
    const id = message.id ?? null;
    const reply = (result: unknown) => res.json({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => res.json({ jsonrpc: "2.0", id, error: { code, message } });
    if (message.method.startsWith("notifications/")) return res.status(202).end();
    if (message.id === undefined) return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request id required" } });
    if (message.method === "ping") return reply({});
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
    const response = await fetch(`${getOllamaBaseUrl()}/api/chat`, { method: "POST",
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
  const imageManager = new ImageGenerationManager(DB_PATH);
  const codexTasks = new CodexTaskManager(PROJECT_ROOT, DB_PATH, process.env);

  const sseClients = new Set<express.Response>();
  const broadcastSystemEvent = (type: string, data: Record<string, unknown> = {}) => {
    const payload = `event: ${type}\ndata: ${JSON.stringify({ type, timestamp: new Date().toISOString(), ...data })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const getAgentsHealthSnapshot = async (filterAgentId?: string) => {
    const caps = await agentAccess(PROJECT_ROOT, queue, false);
    const pyScript = `
import json, os, pwd, sqlite3, subprocess, sys
from datetime import datetime, timezone

db_path = sys.argv[1]
target = sys.argv[2] if len(sys.argv) > 2 else ""
agent_ids = [target] if target in ("aria", "alex", "astyria", "aurelius") else ["aria", "alex", "astyria", "aurelius"]

db_rows = {}
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    for row in conn.execute("SELECT id, display_name, linux_user, home_dir, uid, gid, status, pid, last_heartbeat, cycle_count FROM agents").fetchall():
        db_rows[row["id"]] = dict(row)
    conn.close()

out = []
for a in agent_ids:
    try:
        pw = pwd.getpwnam(a)
        uid, gid, home = pw.pw_uid, pw.pw_gid, pw.pw_dir
    except KeyError:
        uid, gid, home = -1, -1, f"/home/{a}"
    try:
        pids = subprocess.check_output(f"pgrep -u {a} -f 'agent_worker.py {a}([ ]|$)' || true", shell=True, timeout=2).decode().splitlines()
    except Exception:
        pids = []
    pid = int(pids[0]) if pids and pids[0].isdigit() else 0
    worker_status = {}
    status_path = f"/home/{a}/worker_status.json"
    if os.path.exists(status_path):
        try:
            with open(status_path) as f:
                worker_status = json.load(f)
        except Exception:
            worker_status = {}
    heartbeat_valid = False
    try:
        if isinstance(worker_status, dict) and worker_status.get("last_heartbeat"):
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(worker_status["last_heartbeat"])).total_seconds()
            heartbeat_valid = 0 <= age < 20 and worker_status.get("pid") == pid
    except Exception:
        pass
    out.append({
        "id": a,
        "uid": uid,
        "gid": gid,
        "home": home,
        "pid": pid,
        "running": pid > 0 and heartbeat_valid,
        "worker_status": worker_status if isinstance(worker_status, dict) else {},
        "sqlite_record": db_rows.get(a)
    })
print(json.dumps({"agents": out, "checkedAt": datetime.now(timezone.utc).isoformat()}))
`;
    const liveData = await querySqliteJson(pyScript, [filterAgentId || ""]);
    const capMap = new Map(caps.map((c: any) => [c.id, c]));
    return {
      checkedAt: liveData?.checkedAt || new Date().toISOString(),
      agents: (liveData?.agents || []).map((a: any) => ({
        ...a,
        capabilities: capMap.get(a.id) || null,
      })),
    };
  };

  const getSystemDiagnosticsSnapshot = async () => {
    const pyScript = `
import json, os, subprocess, sys
def cmd(c):
    try:
        return subprocess.check_output(c, shell=True, stderr=subprocess.STDOUT, timeout=3).decode("utf-8", "replace").strip()
    except Exception:
        return ""
meminfo = {}
if os.path.exists("/proc/meminfo"):
    with open("/proc/meminfo") as f:
        for line in f:
            parts = line.split(":")
            if len(parts) == 2:
                meminfo[parts[0].strip()] = parts[1].strip()
disk_df = cmd("df -h / | tail -n 1").split()
print(json.dumps({
    "uname": cmd("uname -srmo"),
    "loadavg": cmd("cat /proc/loadavg").split()[:3],
    "uptime_sec": float(cmd("cat /proc/uptime").split()[0] or 0),
    "meminfo": {
        "total": meminfo.get("MemTotal", "N/A"),
        "available": meminfo.get("MemAvailable", "N/A"),
        "free": meminfo.get("MemFree", "N/A"),
    },
    "disk": {
        "size": disk_df[1] if len(disk_df) > 1 else "N/A",
        "used": disk_df[2] if len(disk_df) > 2 else "N/A",
        "avail": disk_df[3] if len(disk_df) > 3 else "N/A",
        "use_pct": disk_df[4] if len(disk_df) > 4 else "N/A",
    },
    "git_branch": cmd("git rev-parse --abbrev-ref HEAD"),
    "git_head": cmd("git rev-parse --short HEAD"),
}))
`;
    const [host, codexStatus] = await Promise.all([
      querySqliteJson(pyScript, []),
      codexAuth.status(),
    ]);
    return {
      ...host,
      codex: codexStatus,
      checkedAt: new Date().toISOString(),
    };
  };

  const toolRuntime = new AgentToolRuntime({
    probeOllama: () => probeOllamaStatus(getOllamaBaseUrl()),
    getMcpStatus: async () => buildMcpStatusSnapshot(),
    probeImageEngines: () => imageManager.probeStatus(),
    generateImage: (args) => imageManager.generate(args),
    getAgentsHealth: (agentId) => getAgentsHealthSnapshot(agentId),
    getSystemDiagnostics: () => getSystemDiagnosticsSnapshot(),
    mcpManager: mcp,
    executeTerminal: (mode, command, agentId) =>
      executeTerminalCommandInternal(mode, command, agentId),
  });

  const applyImageOutcomeToReplyText = (
    text: string,
    outcomes: ToolExecutionOutcome[]
  ): { text: string; addedSuffix: string } => {
    let next = text;
    let addedSuffix = "";
    const imageOutcome = outcomes.find(
      (o) => o.tool === "generate_image" && o.status === "executed" && o.data?.image
    );
    if (imageOutcome?.data?.image) {
      const img = imageOutcome.data.image;
      const expectedUrl = `/api/images/file/${img.id}`;
      const hasBlock =
        next.includes(expectedUrl) && /```image\s*\n[\s\S]*?```/i.test(next);
      if (!hasBlock) {
        const block = `\n\n\`\`\`image\n${JSON.stringify({
          url: expectedUrl,
          prompt: img.prompt,
          source: img.source,
          model: img.model,
          aspectRatio: imageOutcome.data.aspectRatio || "1:1",
        })}\n\`\`\``;
        next = `${next}${block}`;
        addedSuffix = block;
      }
    } else if (outcomes.some((o) => o.tool === "generate_image" && o.status !== "executed")) {
      // Never leak a fabricated ```image``` block if real generation failed.
      next = next.replace(/```image\s*\n[\s\S]*?```/gi, "").trim();
    }
    return { text: next, addedSuffix };
  };

  app.get("/api/events/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);
    sseClients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(res);
      }
    }, 25000);
    req.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  if (!ENV_OLLAMA_EXPLICIT) {
    try {
      const savedMeta = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
row = conn.execute("SELECT value FROM bastilla_metadata WHERE key='ollama_base_url'").fetchone()
conn.close()
print(json.dumps({"url": row[0] if row else ""}))`
      );
      if (savedMeta?.url && /^https?:\/\//i.test(String(savedMeta.url))) {
        activeOllamaBaseUrl = String(savedMeta.url).trim().replace(/\/+$/, "");
      }
    } catch {}
  }

  app.get("/api/ollama/status", async (_req, res) => {
    try {
      const status = await probeOllamaStatus(getOllamaBaseUrl());
      res.json({ ok: true, ...status });
    } catch (err: any) {
      res.status(500).json({ ok: false, state: "ERROR", error: err?.message || "Błąd diagnostyki Ollama." });
    }
  });

  app.post("/api/ollama/config", async (req, res) => {
    try {
      const raw = String(req.body?.endpoint || "").trim().replace(/\/+$/, "");
      if (raw && !/^https?:\/\/[^/\s]+/i.test(raw)) {
        return res.status(400).json({
          ok: false,
          error: "Adres Ollama musi zaczynać się od http:// lub https:// (np. http://127.0.0.1:11434).",
        });
      }
      const nextUrl = raw || (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
      activeOllamaBaseUrl = nextUrl;
      await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT OR REPLACE INTO bastilla_metadata (key, value) VALUES ('ollama_base_url', ?)", (sys.argv[2],))
conn.commit(); conn.close(); print(json.dumps({"saved": True}))`,
        [raw]
      );
      const status = await probeOllamaStatus(getOllamaBaseUrl());
      broadcastSystemEvent("ollama", { state: status.state, reachable: status.reachable, endpoint: status.endpoint });
      res.json({ ok: true, ...status });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Nie udało się zapisać adresu Ollama." });
    }
  });

  app.post("/api/ollama/pull", async (req, res) => {
    try {
      const model = String(req.body?.model || "").trim();
      if (!model) {
        return res.status(400).json({ ok: false, error: "Podaj nazwę modelu do pobrania." });
      }
      const result = await pullOllamaModelSafe(getOllamaBaseUrl(), model);
      broadcastSystemEvent("ollama", { state: result.status.state, reachable: result.status.reachable });
      res.status(result.ok ? 200 : 503).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Nie udało się pobrać modelu Ollama." });
    }
  });

  app.post("/api/ollama/start", async (_req, res) => {
    try {
      const result = await startOllamaDaemon(getOllamaBaseUrl());
      broadcastSystemEvent("ollama", { state: result.status.state, reachable: result.status.reachable });
      res.status(result.ok ? 200 : 503).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, started: false, error: err?.message || "Nie udało się uruchomić Ollama." });
    }
  });

  app.get("/api/images/status", async (_req, res) => {
    try {
      const status = await imageManager.probeStatus();
      res.json({ ok: true, ...status });
    } catch (err: any) {
      res.status(500).json({ ok: false, engineStatus: "ERROR", error: err?.message || "Błąd sondowania silników obrazów." });
    }
  });

  app.get("/api/images/history", (_req, res) => {
    try {
      res.json({ ok: true, images: imageManager.listHistory(50) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Błąd odczytu historii obrazów." });
    }
  });

  app.get("/api/images/file/:id", (req, res) => {
    const file = imageManager.getImageFile(req.params.id);
    if (!file) {
      return res.status(404).json({ ok: false, error: "Nie znaleziono wygenerowanego pliku obrazu." });
    }
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "no-store, must-revalidate");
    res.setHeader("Content-Length", String(file.buffer.length));
    return res.send(file.buffer);
  });

  app.post("/api/images/generate", async (req, res) => {
    try {
      const {
        prompt = "",
        agentId = "astyria",
        mode = "generate",
        preferredEngine = "auto",
        aspectRatio = "1:1",
        sourceImageBase64,
        sourceMimeType,
        sourceImageMimeType,
        sessionId = "bastilla-main",
        saveToChat = true,
      } = req.body || {};

      const cleanPrompt = String(prompt || "").trim();
      if (!cleanPrompt) {
        return res.status(400).json({ ok: false, engineStatus: "ERROR", error: "Prompt generowania obrazu nie może być pusty." });
      }
      const safeAgent = AGENTS.includes(agentId) || agentId === "council" ? agentId : "astyria";

      const result = await imageManager.generate({
        prompt: cleanPrompt,
        agentId: safeAgent === "council" ? "astyria" : safeAgent,
        mode,
        preferredEngine,
        aspectRatio,
        sourceImageBase64,
        sourceMimeType: sourceMimeType || sourceImageMimeType || "image/png",
      });

      if (!result.ok || !result.image) {
        return res.status(result.engineStatus === "BRAK SILNIKA" ? 503 : 500).json({
          ok: false,
          engineStatus: result.engineStatus,
          error: result.error || "Generowanie obrazu nie powiodło się.",
        });
      }

      let userMessageRecord: any = undefined;
      let assistantMessageRecord: any = undefined;

      if (saveToChat !== false) {
        const imageBlockPayload = {
          id: result.image.id,
          title: `Wygenerowany Obraz (${result.image.model})`,
          url: result.image.url,
          caption: result.caption || result.image.prompt,
          prompt: result.image.prompt,
          model: result.image.model,
          source: result.image.source,
          mimeType: result.image.mime_type,
          durationMs: result.image.duration_ms,
          createdAt: result.image.created_at,
        };
        const assistantContent = [
          result.caption ? result.caption : `Wygenerowano obraz na podstawie promptu: "${cleanPrompt}".`,
          "",
          "```image",
          JSON.stringify(imageBlockPayload, null, 2),
          "```",
        ].join("\n");

        const savedRows = await querySqliteJson(
          `import sqlite3, sys, json
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("INSERT INTO chat_messages (session_id, sender_role, agent_id, engine_used, content, artifact_title, artifact_code, created_at) VALUES (?, 'user', ?, 'Operator (Obraz)', ?, '', '', ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], now))
user_id = cur.lastrowid
cur.execute("INSERT INTO chat_messages (session_id, sender_role, agent_id, engine_used, content, artifact_title, artifact_code, created_at) VALUES (?, 'assistant', ?, ?, ?, '', '', ?)",
  (sys.argv[2], sys.argv[3], sys.argv[5], sys.argv[6], now))
asst_id = cur.lastrowid
conn.commit()
conn.close()
print(json.dumps({"user_id": user_id, "asst_id": asst_id, "created_at": now}))`,
          [
            String(sessionId || "bastilla-main"),
            safeAgent,
            `[Obraz · ${mode}] ${cleanPrompt}`,
            `${result.image.source}/${result.image.model}`,
            assistantContent,
          ]
        );

        userMessageRecord = {
          id: savedRows.user_id || Date.now() - 1,
          session_id: String(sessionId || "bastilla-main"),
          sender_role: "user",
          agent_id: safeAgent,
          engine_used: "Operator (Obraz)",
          content: `[Obraz · ${mode}] ${cleanPrompt}`,
          created_at: savedRows.created_at || result.image.created_at,
        };
        assistantMessageRecord = {
          id: savedRows.asst_id || Date.now(),
          session_id: String(sessionId || "bastilla-main"),
          sender_role: "assistant",
          agent_id: safeAgent,
          engine_used: `${result.image.source}/${result.image.model}`,
          content: assistantContent,
          created_at: savedRows.created_at || result.image.created_at,
        };
      }

      broadcastSystemEvent("image_generated", { id: result.image.id, model: result.image.model, source: result.image.source });

      return res.json({
        ok: true,
        engineStatus: "READY",
        image: result.image,
        caption: result.caption,
        userMessageRecord,
        assistantMessageRecord,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, engineStatus: "ERROR", error: err?.message || "Błąd generowania obrazu." });
    }
  });

  app.post("/api/system/sync", async (_req, res) => {
    try {
      const dbCheck = await querySqliteJson(`import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
rows = [r[0] for r in conn.execute("PRAGMA quick_check")]
conn.close()
print(json.dumps({"results": rows}))`);
      const [ollama, images, codex] = await Promise.all([
        probeOllamaStatus(getOllamaBaseUrl()),
        imageManager.probeStatus(),
        codexAuth.status(),
      ]);
      const syncResult = {
        ok: true,
        sqlite_ok: dbCheck?.results?.[0] === "ok",
        ollama,
        images,
        codex,
        mcp_tools: mcp.listTools().tools.map((t) => t.name),
        syncedAt: new Date().toISOString(),
      };
      broadcastSystemEvent("sync", { syncedAt: syncResult.syncedAt, ollama: ollama.state, images: images.engineStatus });
      res.json(syncResult);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Synchronizacja systemu nie powiodła się." });
    }
  });

  app.get("/api/codex/tasks", (req, res) => {
    try {
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
      const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
      const limit = Number(req.query.limit) || 50;
      res.json({ ok: true, tasks: codexTasks.getTasks(sessionId, limit, agentId) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Błąd odczytu kolejki Codex CLI." });
    }
  });

  app.post("/api/codex/tasks", (req, res) => {
    try {
      const { agentId = "aria", sessionId, prompt = "", stdin, autoStart = true } = req.body || {};
      if (typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({ ok: false, error: "Treść zadania Codex CLI nie może być pusta." });
      }
      const operatorToken = extractOperatorToken(req);
      const taskId = codexTasks.createTask(String(agentId), String(sessionId || ""), prompt.trim(), {
        autoStart: Boolean(autoStart),
        stdin: typeof stdin === "string" ? stdin : undefined,
        operatorToken,
        localAuthorized: !process.env.BASTILLA_API_TOKEN,
      });
      res.status(202).json({ ok: true, taskId, task: codexTasks.getTaskById(taskId) });
    } catch (err: any) {
      res.status(err instanceof CodexError ? err.status : 500).json({
        ok: false,
        error: err?.message || "Błąd tworzenia zadania Codex CLI.",
      });
    }
  });

  app.post("/api/codex/tasks/:id/start", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Nieprawidłowe ID zadania." });
    if (!codexTasks.getTaskById(id)) return res.status(404).json({ ok: false, error: "Nie znaleziono zadania Codex CLI." });
    codexTasks.startTask(id, typeof req.body?.stdin === "string" ? req.body.stdin : undefined);
    res.json({ ok: true, task: codexTasks.getTaskById(id) });
  });

  app.post("/api/codex/tasks/:id/cancel", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Nieprawidłowe ID zadania." });
    if (!codexTasks.getTaskById(id)) return res.status(404).json({ ok: false, error: "Nie znaleziono zadania Codex CLI." });
    codexTasks.cancelTask(id);
    res.json({ ok: true, task: codexTasks.getTaskById(id) });
  });

  app.post("/api/codex/tasks/:id/retry", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Nieprawidłowe ID zadania." });
    if (!codexTasks.getTaskById(id)) return res.status(404).json({ ok: false, error: "Nie znaleziono zadania Codex CLI." });
    codexTasks.retryTask(id);
    res.json({ ok: true, task: codexTasks.getTaskById(id) });
  });

  app.get("/api/codex/tasks/:id/stream", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "Nieprawidłowe ID zadania." });
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const safeWrite = (eventName: string, payload: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    const initial = codexTasks.getTaskById(id);
    if (initial) {
      safeWrite("init", initial);
    }

    const onUpdate = (payload: any) => {
      if (payload?.taskId === id) safeWrite("data", payload);
    };
    const onData = (payload: any) => {
      if (payload?.taskId === id) safeWrite("data", payload);
    };
    const onComplete = (payload: any) => {
      if (payload?.taskId === id) safeWrite("complete", payload);
    };

    codexTasks.on("update", onUpdate);
    codexTasks.on("data", onData);
    codexTasks.on("complete", onComplete);

    req.on("close", () => {
      codexTasks.off("update", onUpdate);
      codexTasks.off("data", onData);
      codexTasks.off("complete", onComplete);
    });
  });

  app.get("/api/codex/git-summary", (_req, res) => {
    try {
      res.json({ ok: true, ...codexTasks.getGitSummary() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Błąd odczytu podsumowania Git." });
    }
  });

  app.get("/api/agent-tasks", (_req, res) => {
    try { res.json({ ok: true, tasks: queue.list() }); }
    catch { res.status(500).json({ ok: false, error: "Błąd odczytu kolejki." }); }
  });
  app.post("/api/agent-tasks", (req, res) => {
    try {
      const task = queue.submit(req.body || {});
      broadcastSystemEvent("agent_task", { id: task.id, agent_id: task.agent_id, status: task.status });
      res.status(202).json({ ok: true, task });
    }
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

  app.get("/api/agents/tools", async (req, res) => {
    try {
      const agentId = typeof req.query.agentId === "string" ? req.query.agentId : "aria";
      const catalog = await toolRuntime.listCatalog({
        agentId,
        operatorToken: extractOperatorToken(req),
        authorizedOperator: isOperatorAuthorized(req),
      });
      res.json(catalog);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Błąd katalogu narzędzi." });
    }
  });

  app.post("/api/agents/tools/execute", async (req, res) => {
    try {
      const { tool = "", args = {}, agentId = "aria" } = req.body || {};
      if (typeof tool !== "string" || !tool.trim()) {
        return res.status(400).json({ ok: false, error: "Podaj nazwę narzędzia (tool)." });
      }
      const outcome = await toolRuntime.executeTool(
        tool.trim(),
        args && typeof args === "object" ? args : {},
        {
          agentId: String(agentId || "aria"),
          operatorToken: extractOperatorToken(req),
          authorizedOperator: isOperatorAuthorized(req),
        }
      );
      const statusCode =
        outcome.status === "denied"
          ? 403
          : outcome.status === "unavailable" && /Nieznane narzędzie/.test(outcome.summary)
          ? 404
          : 200;
      res.status(statusCode).json({ ok: outcome.status === "executed", outcome });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || "Błąd wykonania narzędzia." });
    }
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
    db_data["chats"] = [dict(r) for r in conn.execute("SELECT * FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT 150) ORDER BY id ASC").fetchall()]
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
      const [ollamaStatus, imageStatus] = await Promise.all([
        probeOllamaStatus(getOllamaBaseUrl()),
        imageManager.probeStatus(),
      ]);

      hostData.tools.ollama.auth_ready = ollamaStatus.reachable && ollamaStatus.models.length > 0;
      hostData.tools.ollama.requirement_note = ollamaStatus.message;

      const geminiConfigured = Boolean(
        process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"
      );

      res.json({
        ok: true,
        svl_report: svlReport,
        host: hostData,
        ai_routing: {
          primary_model: ollamaStatus.modelNames[0] ? `ollama/${ollamaStatus.modelNames[0]}` : "unverified",
          available_models: ollamaStatus.modelNames,
          ollama_online: ollamaStatus.reachable,
          ollama_state: ollamaStatus.state,
          fallback_model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
          gemini_configured: geminiConfigured,
          active_engine:
            ollamaStatus.reachable && ollamaStatus.modelNames.length
              ? "ollama"
              : geminiConfigured
              ? "gemini-configured-unverified"
              : "unavailable",
        },
        ollama_status: ollamaStatus,
        image_status: imageStatus,
        images: imageManager.listHistory(20),
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
        if (isDestructiveCommand(customPython)) {
          return res.status(400).json({
            ok: false,
            error: "Zablokowano destrukcyjny kod Python mogący zatrzymać serwer.",
          });
        }
        let stdout = "";
        let stderr = "";
        let exitCode = 0;
        try {
          const out = await execFileAsync(
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
          stdout = out.stdout;
          stderr = out.stderr;
        } catch (e: any) {
          stdout = e.stdout || "";
          stderr = e.stderr || e.message || "";
          exitCode = typeof e.code === "number" ? e.code : 1;
        }
        stdout = redact(stdout);
        stderr = redact(stderr);
        await querySqliteJson(
          `import sqlite3, sys, json
from datetime import datetime, timezone
conn = sqlite3.connect(sys.argv[1])
conn.execute("INSERT INTO task_history (title, assigned_agent, terminal_type, command_or_prompt, output_summary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ("SVL Kernel Execution", "aria", "PYTHON_ROOT", sys.argv[2][:200], sys.argv[3][:400], sys.argv[4], datetime.now(timezone.utc).isoformat()))
conn.commit(); conn.close(); print(json.dumps({"saved": True}))`,
          [redact(customPython), stdout || stderr || "OK", exitCode === 0 ? "COMPLETED" : "ERROR"]
        );
        return res.json({ ok: exitCode === 0, stdout, stderr, exitCode });
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

    if (isDestructiveCommand(command)) {
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
          const ollamaEndpoint = getOllamaBaseUrl();
          const preferredOllamaModel = process.env.OLLAMA_MODEL || "llama3.2-vision:11b";
          let ollamaRes = await fetch(`${ollamaEndpoint}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: preferredOllamaModel,
              stream: false,
              messages: [{ role: "user", content: translationPrompt }],
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (ollamaRes.status === 404) {
            const liveOllama = await probeOllamaStatus(ollamaEndpoint);
            const altModel = pickPreferredOllamaModel(liveOllama.models, { multimodal: false });
            if (altModel && altModel !== preferredOllamaModel) {
              ollamaRes = await fetch(`${ollamaEndpoint}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: altModel,
                  stream: false,
                  messages: [{ role: "user", content: translationPrompt }],
                }),
                signal: AbortSignal.timeout(15000),
              });
            }
          }
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

      if (isDestructiveCommand(generatedCmd)) {
        return res.status(400).json({
          ok: false,
          error: "Zablokowano destrukcyjne polecenie mogące zatrzymać proces serwera głównego.",
        });
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

  // 4A. Real Server-Sent Events (SSE) Streaming Chat Endpoint (GET + POST with upstream abort)
  async function handleChatStreamRequest(
    req: express.Request,
    res: express.Response,
    params: {
      agentId: string;
      message: string;
      enginePreference: string;
      sessionId: string;
      imageBase64?: string;
      imageMimeType?: string;
      saveToDb: boolean;
      isGetRequest?: boolean;
    }
  ) {
    const {
      agentId = "aria",
      message = "",
      enginePreference = "auto",
      sessionId = "bastilla-main",
      imageBase64: rawImageBase64,
      imageMimeType: rawImageMimeType = "image/jpeg",
      saveToDb = false,
      isGetRequest = false,
    } = params;
    const { base64: imageBase64, mimeType: imageMimeType } = normalizeInlineImageInput(
      rawImageBase64,
      rawImageMimeType
    );

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    const writeEvent = (payload: Record<string, unknown>) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      writeEvent({ type: "start", agentId, enginePreference });

      if (/^\/(exec|root|sudo|bash)(?:\s+|$)/i.test(message.trim()) && isGetRequest) {
        writeEvent({ type: "error", error: "Polecenia wymagają POST /api/terminal/exec." });
        return res.end();
      }

      if (!message.trim() && !imageBase64) {
        writeEvent({ type: "error", error: "Wiadomość nie może być pusta." });
        return res.end();
      }

      const historyData = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT sender_role, agent_id, content FROM chat_messages WHERE agent_id = ? AND session_id = ? ORDER BY id DESC LIMIT 10", (sys.argv[2], sys.argv[3])).fetchall()
conn.close()
print(json.dumps({"history": [dict(r) for r in reversed(rows)]}))`,
        [agentId, sessionId]
      );
      const priorTurns = sanitizeConversationHistory(historyData?.history || []);

      const intentInfo = detectUserIntents(message, { hasImage: Boolean(imageBase64) });
      const operatorToken = extractOperatorToken(req);
      const authorizedOperator = isOperatorAuthorized(req);
      const allowMutatingTools = !isGetRequest;
      const executedOutcomes: ToolExecutionOutcome[] = [];
      const outcomeCache = new Map<string, ToolExecutionOutcome>();

      const executeAndRecordTool = async (
        name: string,
        args: Record<string, any> = {}
      ): Promise<ToolExecutionOutcome> => {
        const key = `${name}:${JSON.stringify(args || {})}`;
        const cached = outcomeCache.get(key);
        if (cached) return cached;

        let outcome: ToolExecutionOutcome;
        if (
          !allowMutatingTools &&
          (name === "terminal_exec_authorized" || name === "generate_image")
        ) {
          outcome = {
            tool: name,
            source: name === "generate_image" ? "image_engine" : "terminal",
            permission: name === "generate_image" ? "operator_auth" : "privileged_exec",
            status: "denied",
            summary: `Narzędzie ${name} wymaga żądania POST (odmowa na GET SSE).`,
            data: null,
            error: "Polecenia wykonawcze i generowanie obrazów wymagają żądania POST.",
            executedAt: new Date().toISOString(),
            durationMs: 0,
          };
        } else {
          outcome = await toolRuntime.executeTool(name, args, {
            agentId,
            operatorToken,
            authorizedOperator,
          });
        }
        outcomeCache.set(key, outcome);
        executedOutcomes.push(outcome);
        writeEvent({ type: "tool_result", outcome });
        if (outcome.tool === "generate_image" && outcome.status === "executed" && outcome.data?.image) {
          broadcastSystemEvent("images", { id: outcome.data.image.id, status: "completed" });
        }
        return outcome;
      };

      for (const suggested of intentInfo.suggestedTools) {
        if (abortController.signal.aborted) return res.end();
        if (!allowMutatingTools && suggested.name === "terminal_exec_authorized") {
          continue;
        }
        await executeAndRecordTool(suggested.name, suggested.args);
      }

      const trimmedCmdMsg = message.trim();
      const slashTermMatch = !isGetRequest
        ? trimmedCmdMsg.match(/^\/(exec|root|sudo|bash)(?:\s+([\s\S]+))?$/i)
        : null;

      let fullText = "";
      let engineUsed = "";
      let overrideArtifactTitle = "";
      let overrideArtifactCode = "";

      if (slashTermMatch) {
        const rawCmd = (slashTermMatch[2] || "").trim();
        if (!rawCmd) {
          writeEvent({
            type: "error",
            error: "Podaj polecenie po /exec (np. /exec id && uname -a).",
          });
          return res.end();
        }
        const termOutcome = await executeAndRecordTool("terminal_exec_authorized", {
          command: rawCmd,
        });
        if (termOutcome.status === "executed" && termOutcome.data) {
          const { stdout = "", stderr = "", exitCode = 0 } = termOutcome.data;
          fullText = `[SERVER uid=${process.getuid?.()} gid=${process.getgid?.()} · exit=${exitCode}]\n$ ${rawCmd}\n\n${(
            stdout ||
            stderr ||
            "Polecenie wykonane pomyślnie (exit=0, brak wyjścia)."
          ).trim()}`;
          engineUsed = `server-process (uid=${process.getuid?.()}/gid=${process.getgid?.()})`;
          overrideArtifactTitle = `Wynik ROOT: ${rawCmd.substring(0, 40)}`;
          overrideArtifactCode = rawCmd;
          writeEvent({ type: "chunk", text: fullText });
        } else {
          writeEvent({
            type: "error",
            error: termOutcome.error || termOutcome.summary || "Błąd wykonania polecenia.",
          });
          return res.end();
        }
      }

      const hasToolsOrIntents = intentInfo.intents.length > 0 || executedOutcomes.length > 0;
      const groundingPrompt = buildToolGroundingPrompt(executedOutcomes, AGENT_TOOL_CATALOG);

      const targetModel = imageBase64
        ? "llama3.2-vision:11b"
        : enginePreference === "auto" || enginePreference === "ollama"
        ? process.env.OLLAMA_MODEL || "llama3.2-vision:11b"
        : enginePreference;

      if (!fullText && enginePreference !== "gemini") {
        const ollamaMessages: Array<{ role: string; content: string; images?: string[] }> = [
          ...(hasToolsOrIntents ? [{ role: "system", content: groundingPrompt }] : []),
          ...priorTurns.map((h) => ({
            role: h.sender_role === "user" ? "user" : "assistant",
            content: h.content,
          })),
          {
            role: "user",
            content: message,
            ...(imageBase64 ? { images: [imageBase64] } : {}),
          },
        ];
        const ollamaEndpoint = getOllamaBaseUrl();
        const ollamaToolOpt = hasToolsOrIntents
          ? {
              tools: toOllamaTools(AGENT_TOOL_CATALOG),
              onToolCall: async (name: string, args: Record<string, any>) => {
                const resOutcome = await executeAndRecordTool(name, args);
                return {
                  status: resOutcome.status,
                  summary: resOutcome.summary,
                  data: resOutcome.data,
                  error: resOutcome.error,
                };
              },
            }
          : {};
        try {
          const timeoutSignal = AbortSignal.timeout(45000);
          const combinedSignal = AbortSignal.any([abortController.signal, timeoutSignal]);
          const streamed = await streamOllamaChat({
            ollamaBaseUrl: ollamaEndpoint,
            model: targetModel,
            messages: ollamaMessages,
            signal: combinedSignal,
            ...ollamaToolOpt,
            onChunk: (delta) => {
              writeEvent({ type: "chunk", text: redact(delta) });
            },
          });
          fullText = streamed.text;
          engineUsed = streamed.model;
        } catch (err: any) {
          if (abortController.signal.aborted) {
            return res.end();
          }
          // If the default model isn't installed on a real Ollama host, retry with an actual model from /api/tags
          if (/404|not found/i.test(String(err?.message || ""))) {
            try {
              const liveOllama = await probeOllamaStatus(ollamaEndpoint);
              const altModel = pickPreferredOllamaModel(liveOllama.models, {
                multimodal: Boolean(imageBase64),
              });
              if (altModel && altModel !== targetModel) {
                const retryStream = await streamOllamaChat({
                  ollamaBaseUrl: ollamaEndpoint,
                  model: altModel,
                  messages: ollamaMessages,
                  signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(45000)]),
                  ...ollamaToolOpt,
                  onChunk: (delta) => {
                    writeEvent({ type: "chunk", text: redact(delta) });
                  },
                });
                fullText = retryStream.text;
                engineUsed = retryStream.model;
              }
            } catch {}
          }
        }
      }

      if (!fullText && !abortController.signal.aborted) {
        const contents: any[] = priorTurns.map((h) => ({
          role: h.sender_role === "user" ? "user" : "model",
          parts: [{ text: h.content }],
        }));
        const parts: any[] = [];
        if (imageBase64) {
          parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
        }
        parts.push({ text: message || "Przeanalizuj załączony obraz." });
        contents.push({ role: "user", parts });

        const combinedSystemInstruction = `${buildAgentSystemInstruction(agentId)}\n\n${groundingPrompt}`;
        const streamedGemini = await streamLiveMultimodalModel(
          contents,
          abortController.signal,
          (delta) => {
            writeEvent({ type: "chunk", text: redact(delta) });
          },
          combinedSystemInstruction,
          {
            functionDeclarations: toGeminiFunctionDeclarations(AGENT_TOOL_CATALOG),
            executeToolCall: executeAndRecordTool,
          }
        );
        fullText = streamedGemini.text;
        engineUsed =
          enginePreference === "gemini"
            ? streamedGemini.modelUsed
            : `${streamedGemini.modelUsed} (Fallback dla ${targetModel})`;
      }

      if (abortController.signal.aborted) {
        return res.end();
      }

      const adjusted = applyImageOutcomeToReplyText(fullText, executedOutcomes);
      fullText = adjusted.text;
      if (adjusted.addedSuffix) {
        writeEvent({ type: "chunk", text: adjusted.addedSuffix });
      }

      let userMessageRecord: any = undefined;
      let assistantMessageRecord: any = undefined;
      let artifactTitle = overrideArtifactTitle;
      let artifactCode = overrideArtifactCode;

      if (!artifactCode) {
        const codeMatch = fullText.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
        if (codeMatch && !/image|mermaid|chart|table|buttons|form|telemetry/i.test(codeMatch[1] || "")) {
          artifactTitle = `Artefakt Roboczy (${codeMatch[1] || "code"}) — ${agentId.toUpperCase()}`;
          artifactCode = codeMatch[2].trim();
        }
      }

      if (saveToDb && fullText) {
        // Record IPC mentions if operator addressed @wszyscy or specific agent
        const mentioned = [...message.toLowerCase().matchAll(/@(aria|alex|astyria|aurelius|wszyscy)\b/g)].map((m) => m[1]);
        if (mentioned.length > 0) {
          const targets = mentioned.includes("wszyscy") ? [...AGENTS] : Array.from(new Set(mentioned));
          const sender = (AGENTS as readonly string[]).includes(agentId) ? agentId : "aria";
          for (const recipient of targets) {
            if (recipient !== sender && (AGENTS as readonly string[]).includes(recipient)) {
              querySqliteJson(
                `import sqlite3, sys, json, os
from datetime import datetime, timezone
now = datetime.now(timezone.utc).isoformat()
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("INSERT INTO agent_ipc_messages (sender, recipient, subject, payload, status, created_at) VALUES (?, ?, 'CHAT_MENTION', ?, 'QUEUED', ?)",
  (sys.argv[2], sys.argv[3], sys.argv[4], now))
msg_id = cur.lastrowid
conn.commit(); conn.close()
inbox = f"/home/{sys.argv[3]}/inbox.jsonl"
if os.path.exists(f"/home/{sys.argv[3]}"):
    with open(inbox, "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": msg_id, "from": sys.argv[2], "subject": "CHAT_MENTION", "payload": sys.argv[4], "ts": now}) + "\\n")
print(json.dumps({"id": msg_id}))`,
                [sender, recipient, message.slice(0, 600)]
              ).catch(() => {});
            }
          }
        }

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
          [sessionId, agentId, message, engineUsed, fullText, artifactTitle, artifactCode]
        );
        userMessageRecord = {
          id: savedRows.user_id || Date.now() - 1,
          session_id: sessionId,
          sender_role: "user",
          agent_id: agentId,
          engine_used: "Operator",
          content: message,
          created_at: savedRows.created_at || new Date().toISOString(),
        };
        assistantMessageRecord = {
          id: savedRows.asst_id || Date.now(),
          session_id: sessionId,
          sender_role: "assistant",
          agent_id: agentId,
          engine_used: engineUsed,
          content: fullText,
          artifact_title: artifactTitle,
          artifact_code: artifactCode,
          created_at: savedRows.created_at || new Date().toISOString(),
        };
      }

      writeEvent({
        type: "done",
        engineUsed,
        reply: fullText,
        artifactTitle,
        artifactCode,
        toolOutcomes: executedOutcomes,
        userMessageRecord,
        assistantMessageRecord,
      });
      res.end();
    } catch (e: any) {
      if (!abortController.signal.aborted) {
        writeEvent({ type: "error", error: redact(e?.message || "Błąd streamingu") });
      }
      if (!res.writableEnded) res.end();
    }
  }

  app.get("/api/chat/stream", async (req, res) => {
    const q = req.query as Record<string, string>;
    await handleChatStreamRequest(req, res, {
      agentId: q.agentId || "aria",
      message: q.message || "",
      enginePreference: q.enginePreference || "auto",
      sessionId: q.sessionId || "bastilla-stream",
      saveToDb: q.saveToDb === "true",
      isGetRequest: true,
    });
  });

  app.post("/api/chat/stream", async (req, res) => {
    const b = req.body || {};
    await handleChatStreamRequest(req, res, {
      agentId: String(b.agentId || "aria"),
      message: String(b.message || ""),
      enginePreference: String(b.enginePreference || "auto"),
      sessionId: String(b.sessionId || "bastilla-main"),
      imageBase64: typeof b.imageBase64 === "string" ? b.imageBase64 : undefined,
      imageMimeType: typeof b.imageMimeType === "string" ? b.imageMimeType : "image/jpeg",
      saveToDb: b.saveToDb !== false,
      isGetRequest: false,
    });
  });

  // 4. Full-Screen ChatGPT Work Multi-Agent & Vision Endpoint (Completely Unlocked + Direct Root /exec + Clear Chat)
  app.post("/api/chat/message", async (req, res) => {
    try {
      const {
        agentId = "aria",
        message = "",
        imageBase64: rawImageBase64,
        imageMimeType: rawImageMimeType = "image/jpeg",
        sessionId = "bastilla-main",
        enginePreference = "auto",
      } = req.body || {};
      const { base64: imageBase64, mimeType: imageMimeType } = normalizeInlineImageInput(
        rawImageBase64,
        rawImageMimeType
      );

      if (!String(message || "").trim() && !imageBase64) {
        return res.status(400).json({ ok: false, error: "Wiadomość nie może być pusta." });
      }

      let engineUsed = "";
      let replyText = "";
      let artifactTitle = "";
      let artifactCode = "";
      let resolved = false;
      let lastEngineError = "";
      const executedOutcomes: ToolExecutionOutcome[] = [];
      const outcomeCache = new Map<string, ToolExecutionOutcome>();
      const operatorToken = extractOperatorToken(req);
      const authorizedOperator = isOperatorAuthorized(req);

      const executeAndRecordTool = async (
        name: string,
        args: Record<string, any> = {}
      ): Promise<ToolExecutionOutcome> => {
        const key = `${name}:${JSON.stringify(args || {})}`;
        const cached = outcomeCache.get(key);
        if (cached) return cached;
        const outcome = await toolRuntime.executeTool(name, args, {
          agentId,
          operatorToken,
          authorizedOperator,
        });
        outcomeCache.set(key, outcome);
        executedOutcomes.push(outcome);
        if (outcome.tool === "generate_image" && outcome.status === "executed" && outcome.data?.image) {
          broadcastSystemEvent("images", { id: outcome.data.image.id, status: "completed" });
        }
        return outcome;
      };

      // Direct Supreme Root command execution inside chat (/exec <cmd>, /root <cmd>, /sudo <cmd>)
      const trimmedMsg = String(message || "").trim();
      let effectiveUserMessage = String(message || "");
      const slashMsgMatch = trimmedMsg.match(/^\/(exec|root|sudo|bash)(?:\s+([\s\S]+))?$/i);
      if (slashMsgMatch) {
        const rawCmd = (slashMsgMatch[2] || "").trim();
        if (!rawCmd) {
          return res.status(400).json({
            ok: false,
            error: "Podaj polecenie po /exec (np. /exec id && uname -a).",
          });
        }
        const termOutcome = await executeAndRecordTool("terminal_exec_authorized", {
          command: rawCmd,
        });
        if (termOutcome.status === "executed" && termOutcome.data) {
          const { stdout = "", stderr = "", exitCode = 0 } = termOutcome.data;
          replyText = `[SERVER uid=${process.getuid?.()} gid=${process.getgid?.()} · exit=${exitCode}]\n$ ${rawCmd}\n\n${(
            stdout ||
            stderr ||
            "Polecenie wykonane pomyślnie (brak wyjścia stdout)."
          ).trim()}`;
          engineUsed = `server-process (uid=${process.getuid?.()}/gid=${process.getgid?.()})`;
          artifactTitle = `Wynik ROOT: ${rawCmd.substring(0, 40)}`;
          artifactCode = rawCmd;
          resolved = true;
        } else {
          return res.status(termOutcome.status === "denied" ? 403 : 400).json({
            ok: false,
            error: termOutcome.error || termOutcome.summary,
            toolOutcomes: executedOutcomes,
          });
        }
      }

      const intentInfo = resolved
        ? { intents: ["terminal_exec"], suggestedTools: [], mode: "terminal" as const }
        : detectUserIntents(message, { hasImage: Boolean(imageBase64) });

      if (!resolved) {
        for (const suggested of intentInfo.suggestedTools) {
          await executeAndRecordTool(suggested.name, suggested.args);
        }
      }

      const hasToolsOrIntents = intentInfo.intents.length > 0 || executedOutcomes.length > 0;
      const groundingPrompt = buildToolGroundingPrompt(executedOutcomes, AGENT_TOOL_CATALOG);

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
      const priorTurns = sanitizeConversationHistory(historyData?.history || []);

      const isOllamaSelection = !resolved && enginePreference !== "gemini";

      const targetOllamaModel = imageBase64
        ? "llama3.2-vision:11b"
        : enginePreference === "auto" || !enginePreference
        ? process.env.OLLAMA_MODEL || "llama3.2-vision:11b"
        : enginePreference === "ollama"
        ? "llama3.2-vision:11b"
        : enginePreference;

      // Step 1: Attempt active Ollama daemon with automatic model fallback from /api/tags
      if (isOllamaSelection) {
        const ollamaEndpoint = getOllamaBaseUrl();
        const ollamaMessages: Array<{ role: string; content: string; images?: string[] }> = [
          ...(hasToolsOrIntents ? [{ role: "system", content: groundingPrompt }] : []),
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
        try {
          if (hasToolsOrIntents) {
            const ollamaToolOpt = {
              tools: toOllamaTools(AGENT_TOOL_CATALOG),
              onToolCall: async (name: string, args: Record<string, any>) => {
                const resOutcome = await executeAndRecordTool(name, args);
                return {
                  status: resOutcome.status,
                  summary: resOutcome.summary,
                  data: resOutcome.data,
                  error: resOutcome.error,
                };
              },
            };
            try {
              const streamed = await streamOllamaChat({
                ollamaBaseUrl: ollamaEndpoint,
                model: targetOllamaModel,
                messages: ollamaMessages,
                signal: AbortSignal.timeout(25000),
                onChunk: () => {},
                ...ollamaToolOpt,
              });
              if (streamed.text) {
                replyText = streamed.text;
                engineUsed = streamed.model;
                resolved = true;
              }
            } catch (toolErr: any) {
              if (/404|not found/i.test(String(toolErr?.message || ""))) {
                const liveOllama = await probeOllamaStatus(ollamaEndpoint);
                const altModel = pickPreferredOllamaModel(liveOllama.models, {
                  multimodal: Boolean(imageBase64),
                });
                if (altModel && altModel !== targetOllamaModel) {
                  const retryStream = await streamOllamaChat({
                    ollamaBaseUrl: ollamaEndpoint,
                    model: altModel,
                    messages: ollamaMessages,
                    signal: AbortSignal.timeout(25000),
                    onChunk: () => {},
                    ...ollamaToolOpt,
                  });
                  if (retryStream.text) {
                    replyText = retryStream.text;
                    engineUsed = retryStream.model;
                    resolved = true;
                  }
                } else {
                  throw toolErr;
                }
              } else {
                throw toolErr;
              }
            }
          } else {
            const ollamaRes = await fetch(`${ollamaEndpoint}/api/chat`, {
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
            } else if (ollamaRes.status === 404) {
              const liveOllama = await probeOllamaStatus(ollamaEndpoint);
              const altModel = pickPreferredOllamaModel(liveOllama.models, {
                multimodal: Boolean(imageBase64),
              });
              if (altModel && altModel !== targetOllamaModel) {
                const retryRes = await fetch(`${ollamaEndpoint}/api/chat`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model: altModel,
                    stream: false,
                    messages: ollamaMessages,
                  }),
                  signal: AbortSignal.timeout(25000),
                });
                if (retryRes.ok) {
                  const retryData: any = await retryRes.json();
                  replyText = retryData?.message?.content || "";
                  if (replyText) {
                    engineUsed = bodyEngine(retryData, altModel);
                    resolved = true;
                  }
                }
              }
              if (!resolved) lastEngineError = `Ollama HTTP ${ollamaRes.status}`;
            } else {
              lastEngineError = `Ollama HTTP ${ollamaRes.status}`;
            }
          }
        } catch (err: any) {
          lastEngineError = `Ollama daemon (${ollamaEndpoint}) niedostępny: ${err?.message || "ECONNREFUSED"}`;
          resolved = false;
        }
      }

      // Step 2: Real Server-Side Gemini API Fallback with clean agent persona instruction + native tool calling
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

          const combinedSystemInstruction = `${buildAgentSystemInstruction(agentId)}\n\n${groundingPrompt}`;
          const { text, modelUsed } = await runLiveMultimodalModel(
            contents,
            undefined,
            combinedSystemInstruction,
            {
              functionDeclarations: toGeminiFunctionDeclarations(AGENT_TOOL_CATALOG),
              executeToolCall: executeAndRecordTool,
            }
          );
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
          toolOutcomes: executedOutcomes,
        });
      }

      replyText = applyImageOutcomeToReplyText(replyText, executedOutcomes).text;

      // Extract first code block as ChatGPT Work Canvas Artifact if present
      if (!artifactCode) {
        const codeMatch = replyText.match(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/);
        if (codeMatch && !/image|mermaid|chart|table|buttons|form|telemetry/i.test(codeMatch[1] || "")) {
          artifactTitle = `Artefakt Roboczy (${codeMatch[1] || "code"}) — ${agentId.toUpperCase()}`;
          artifactCode = codeMatch[2].trim();
        }
      }

      const mentionsAll = /@wszyscy\b|@council\b/i.test(message);
      const mentionedAgents = Array.from(
        new Set(
          (mentionsAll
            ? [...AGENTS]
            : (message.match(/@(aria|alex|astyria|aurelius)\b/gi) || []).map((m: string) =>
                m.slice(1).toLowerCase()
              )
          ).filter((a: string) => (AGENTS as readonly string[]).includes(a) && a !== agentId)
        )
      );

      // Save user message, assistant reply, IPC mentions, and long-term memory into SQLite and return inserted rows
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
ipc_targets = json.loads(sys.argv[9]) if sys.argv[9] else []
sender_agent = sys.argv[3] if sys.argv[3] in ('aria', 'alex', 'astyria', 'aurelius') else 'aria'
for target_agent in ipc_targets:
    cur.execute(
        "INSERT INTO agent_ipc_messages (sender, recipient, subject, payload, status, created_at) VALUES (?, ?, ?, ?, 'QUEUED', ?)",
        (sender_agent, target_agent, 'CHAT_MENTION', sys.argv[4][:400], now)
    )
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
          JSON.stringify(mentionedAgents),
        ]
      );

      res.json({
        ok: true,
        agentId,
        engineUsed,
        reply: replyText,
        artifactTitle,
        artifactCode,
        toolOutcomes: executedOutcomes,
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
    let normalizedMsgId = "";
    if (messageId !== undefined && messageId !== null && String(messageId).trim() !== "") {
      const parsedId = Number(messageId);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        return res.status(400).json({ ok: false, error: "Nieprawidłowe ID wiadomości (wymagana dodatnia liczba całkowita)." });
      }
      normalizedMsgId = String(parsedId);
    }
    const cleanAgentId = typeof agentId === "string" ? agentId.trim() : "";
    if (cleanAgentId && !AGENTS.includes(cleanAgentId as any) && cleanAgentId !== "council") {
      return res.status(400).json({ ok: false, error: "Nieprawidłowy identyfikator agenta." });
    }
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
          cleanAgentId,
          normalizedMsgId,
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
updated = cur.rowcount > 0
conn.commit(); conn.close()
print(json.dumps({"updated": updated, "agentId": sys.argv[2], "avatarUrl": sys.argv[3]}))`,
        [agentId, avatarUrl.trim()]
      );
      if (!out?.updated) {
        return res.status(404).json({ ok: false, error: "Nie znaleziono profilu agenta w bazie danych." });
      }
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
        const workerPath = fs.existsSync("/usr/lib/bastilla/agent_worker.py")
          ? "/usr/lib/bastilla/agent_worker.py"
          : path.join(KERNEL_DIR, "agent_worker.py");
        if (!fs.existsSync(workerPath)) {
          return res.status(503).json({ ok: false, error: "Brak skryptu agent_worker.py na hoście." });
        }
        try {
          await execFileAsync("id", ["-u", agentId], { timeout: 2000 });
        } catch {
          return res.status(503).json({
            ok: false,
            error: `Brak konta Linux użytkownika "${agentId}". Uruchom provision-runtime.sh (BASTILLA_PROVISION_HOST=true), aby utworzyć konta agentów.`,
          });
        }
        fs.mkdirSync("/var/log/bastilla", { recursive: true });
        await execAsync(
          `BASTILLA_DB_PATH=${shellQuote(DB_PATH)} runuser -u ${agentId} -- nohup python3 ${shellQuote(workerPath)} ${agentId} >/var/log/bastilla/${agentId}-worker.log 2>&1 &`
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
    if (typeof codename !== "string" || !codename.trim() || typeof objective !== "string" || !objective.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Wymagany jest kryptonim misji oraz cel operacyjny.",
      });
    }
    const parsedDeltaV = Number(deltaV);
    if (!Number.isFinite(parsedDeltaV) || parsedDeltaV < 0) {
      return res.status(400).json({
        ok: false,
        error: "Parametr deltaV musi być nieujemną liczbą.",
      });
    }
    const cleanLeadAgent = AGENTS.includes(leadAgent as any) ? String(leadAgent) : "astyria";
    const cleanTargetBody = typeof targetBody === "string" && targetBody.trim() ? targetBody.trim() : "Mars";
    const cleanVesselId = typeof vesselId === "string" && vesselId.trim() ? vesselId.trim() : "BSV-03-ASTRAEA";
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
        [msnId, codename.trim().toUpperCase(), cleanTargetBody, cleanLeadAgent, cleanVesselId, String(parsedDeltaV), objective.trim()]
      );
      res.json({ ok: true, mission: out });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/fleet/hypercomm", async (req, res) => {
    const { relayId = "HCR-SOL-L2", packetHeader = "SVL_QUANTUM_SYNC" } = req.body || {};
    if (typeof relayId !== "string" || !relayId.trim() || typeof packetHeader !== "string" || !packetHeader.trim()) {
      return res
        .status(400)
        .json({ ok: false, error: "Wymagany jest identyfikator przekaźnika i nagłówek pakietu hiperkomunikacji." });
    }
    try {
      const out = await querySqliteJson(
        `import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute("UPDATE hypercomm_relays SET last_packet = ?, status = 'LOCKED' WHERE id = ?", (sys.argv[3], sys.argv[2]))
updated = cur.rowcount > 0
conn.commit(); conn.close()
print(json.dumps({"updated": updated, "relayId": sys.argv[2], "packet": sys.argv[3]}))`,
        [relayId.trim(), packetHeader.trim()]
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
    const isApi = req.originalUrl.startsWith("/api") || req.path.startsWith("/api");
    if (!isApi || res.headersSent) return next(error);
    const status =
      error?.type === "entity.too.large"
        ? 413
        : error instanceof SyntaxError
        ? 400
        : typeof error?.status === "number"
        ? error.status
        : 500;
    res.status(status).json({
      ok: false,
      error:
        status === 413
          ? "Przekroczono maksymalny rozmiar żądania (15 MB)."
          : status === 400
          ? "Nieprawidłowy format JSON w treści żądania."
          : redact(error?.message || "Wewnętrzny błąd serwera API."),
    });
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
