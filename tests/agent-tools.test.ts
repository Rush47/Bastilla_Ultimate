import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_TOOL_CATALOG,
  AgentToolRuntime,
  buildToolGroundingPrompt,
  detectUserIntents,
  toGeminiFunctionDeclarations,
  toOllamaTools,
} from "../server/agent-tools";
import { MCPServerManager } from "../server/mcp";

test("detectUserIntents recognizes Ollama, MCP, image generation, image engine, terminal, agent health, git, and keeps normal chat clean", () => {
  const ollama = detectUserIntents("Aria sprawdź proszę status Ollamy i jakie ma modele");
  assert.ok(ollama.intents.includes("ollama_status"));
  assert.ok(ollama.suggestedTools.some((t) => t.name === "ollama_status"));
  assert.equal(ollama.mode, "diagnostic");

  const mcp = detectUserIntents("Czy serwer MCP jest podłączony przez stdio lub /api/mcp?");
  assert.ok(mcp.intents.includes("mcp_status"));
  assert.ok(mcp.suggestedTools.some((t) => t.name === "mcp_status"));

  const imgGen = detectUserIntents("Astyria wygeneruj nowy obraz przedstawiający stację orbitalną 16:9");
  assert.ok(imgGen.intents.includes("image_generate"));
  assert.equal(imgGen.mode, "image_generate");
  const genCall = imgGen.suggestedTools.find((t) => t.name === "generate_image");
  assert.ok(genCall);
  assert.equal(genCall.args.aspectRatio, "16:9");
  assert.match(genCall.args.prompt, /stację orbitalną/i);

  const imgStatus = detectUserIntents("Dlaczego nie działa silnik graficzny i ComfyUI?");
  assert.ok(imgStatus.intents.includes("image_engine_status"));
  assert.ok(!imgStatus.intents.includes("image_generate"));

  const term = detectUserIntents("/exec uname -a");
  assert.ok(term.intents.includes("terminal_exec"));
  assert.equal(term.mode, "terminal");
  assert.equal(term.suggestedTools[0].args.command, "uname -a");

  const agent = detectUserIntents("Czy Alex ma działający proces PID i świeży heartbeat?");
  assert.ok(agent.intents.includes("agent_health_status"));
  assert.equal(agent.suggestedTools[0].args.agentId, "alex");

  const vision = detectUserIntents("Co jest na tym zdjęciu?", { hasImage: true });
  assert.ok(vision.intents.includes("image_vision"));
  assert.equal(vision.mode, "vision");

  const plainChat = detectUserIntents("Opowiedz krótko o architekturze SVL i pomóż zaprojektować moduł.");
  assert.deepEqual(plainChat.intents, []);
  assert.deepEqual(plainChat.suggestedTools, []);
  assert.equal(plainChat.mode, "chat");
});

test("tool schema converters include full catalog for Gemini and Ollama", () => {
  const geminiDecls = toGeminiFunctionDeclarations(AGENT_TOOL_CATALOG);
  const ollamaTools = toOllamaTools(AGENT_TOOL_CATALOG);
  assert.equal(geminiDecls.length, AGENT_TOOL_CATALOG.length);
  assert.equal(ollamaTools.length, AGENT_TOOL_CATALOG.length);
  assert.ok(geminiDecls.some((d) => d.name === "ollama_status"));
  assert.ok(geminiDecls.some((d) => d.name === "generate_image"));
  assert.ok(ollamaTools.some((t) => t.function.name === "mcp_status"));
});

test("AgentToolRuntime enforces permissions, MCP token verification, destructive command blocking, and truthful grounding", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bastilla-tools-"));
  const dbPath = path.join(dir, "state.db");
  const prevHome = process.env.BASTILLA_AGENT_HOME_ROOT;
  const prevToken = process.env.BASTILLA_API_TOKEN;
  try {
    mkdirSync(path.join(dir, "home", "aria"), { recursive: true });
    writeFileSync(path.join(dir, "home", "aria", "memory.json"), JSON.stringify({ agent: "aria", role: "Koordynator" }));
    process.env.BASTILLA_AGENT_HOME_ROOT = dir;
    process.env.BASTILLA_API_TOKEN = "test-secret-token-1234";

    execFileSync("python3", [path.resolve("distro/bastilla-overlay/init_db.py"), dbPath]);
    const mcp = new MCPServerManager(dir, dbPath);

    let terminalExecuted = false;
    const runtime = new AgentToolRuntime({
      probeOllama: async () => ({
        state: "OFFLINE",
        reachable: false,
        endpoint: "http://127.0.0.1:11434",
        version: "",
        binaryPath: "",
        binaryType: "missing",
        daemonPid: null,
        models: [],
        modelNames: [],
        runningModels: [],
        activeRequests: 0,
        isGeminiBridge: false,
        message: "Daemon Ollama nie odpowiada.",
        checkedAt: new Date().toISOString(),
      }),
      getMcpStatus: async () => ({
        ok: true,
        configured: true,
        transport: "http-jsonrpc-subset",
        endpoint: "/api/mcp",
        tools: ["agent_memory_read", "git_status"],
      }),
      probeImageEngines: async () => ({
        engineStatus: "BRAK SILNIKA",
        activeSource: null,
        activeModel: null,
        engines: {
          comfyui: { id: "comfyui", label: "ComfyUI", configured: false, reachable: false, model: "comfyui", error: "offline" },
          local: { id: "local", label: "SD WebUI", configured: false, reachable: false, model: "local", error: "offline" },
          gemini: { id: "gemini", label: "Gemini Image API", configured: false, reachable: false, model: "gemini-3.1-flash-lite-image", error: "Brak klucza" },
        },
        message: "Żaden silnik graficzny nie jest aktywny.",
        checkedAt: new Date().toISOString(),
      }),
      generateImage: async () => ({
        ok: false,
        engineStatus: "BRAK SILNIKA",
        error: "Brak aktywnego silnika graficznego w środowisku.",
      }),
      getAgentsHealth: async () => ({
        checkedAt: new Date().toISOString(),
        agents: [{ id: "aria", uid: 1001, gid: 0, pid: 0, running: false }],
      }),
      getSystemDiagnostics: async () => ({
        uname: "Linux test",
        meminfo: { total: "8 GB", available: "4 GB", free: "2 GB" },
      }),
      mcpManager: mcp,
      executeTerminal: async () => {
        terminalExecuted = true;
        return { stdout: "uid=0(root)\n", stderr: "", exitCode: 0 };
      },
    });

    // 1. Public diagnostics succeed
    const ollamaOutcome = await runtime.executeTool("ollama_status", {}, {
      agentId: "aria",
      authorizedOperator: true,
    });
    assert.equal(ollamaOutcome.status, "executed");
    assert.equal(ollamaOutcome.data?.state, "OFFLINE");

    // 2. MCP protected tool denies invalid token and succeeds with valid token
    const deniedMcp = await runtime.executeTool("mcp_agent_memory_read", { agentId: "aria" }, {
      agentId: "aria",
      operatorToken: "wrong-token",
      authorizedOperator: true,
    });
    assert.equal(deniedMcp.status, "denied");

    const okMcp = await runtime.executeTool("mcp_agent_memory_read", { agentId: "aria" }, {
      agentId: "aria",
      operatorToken: "test-secret-token-1234",
      authorizedOperator: true,
    });
    assert.equal(okMcp.status, "executed");
    assert.equal(okMcp.data?.memory?.agent, "aria");

    // 3. Unavailable image engine returns honest unavailable without faking URL
    const imgFail = await runtime.executeTool("generate_image", { prompt: "Rakieta" }, {
      agentId: "astyria",
      authorizedOperator: true,
    });
    assert.equal(imgFail.status, "unavailable");
    assert.equal(imgFail.data?.image, undefined);

    // 4. Terminal denies unauthorized caller and blocks destructive commands
    const termDenied = await runtime.executeTool("terminal_exec_authorized", { command: "id" }, {
      agentId: "alex",
      authorizedOperator: false,
    });
    assert.equal(termDenied.status, "denied");
    assert.equal(terminalExecuted, false);

    const rmBlocked = await runtime.executeTool("terminal_exec_authorized", { command: "rm -rf /" }, {
      agentId: "alex",
      authorizedOperator: true,
    });
    assert.equal(rmBlocked.status, "denied");
    assert.equal(terminalExecuted, false);

    const termOk = await runtime.executeTool("terminal_exec_authorized", { command: "id" }, {
      agentId: "alex",
      authorizedOperator: true,
    });
    assert.equal(termOk.status, "executed");
    assert.equal(terminalExecuted, true);

    // 5. Grounding prompt cleanly distinguishes executed vs failed/denied vs planned tools
    const promptText = buildToolGroundingPrompt([ollamaOutcome, imgFail]);
    assert.match(promptText, /\[WYKONANE — RZECZYWISTE WYNIKI Z BACKENDU\]/);
    assert.match(promptText, /ollama_status/);
    assert.match(promptText, /\[NIEDOSTĘPNE \/ BŁĄD \/ ODMOWA\]/);
    assert.match(promptText, /generate_image/);
    assert.match(promptText, /\[KATALOG NIEWYKONANYCH NARZĘDZI/);
    assert.match(promptText, /mcp_git_status/);
  } finally {
    if (prevHome === undefined) delete process.env.BASTILLA_AGENT_HOME_ROOT;
    else process.env.BASTILLA_AGENT_HOME_ROOT = prevHome;
    if (prevToken === undefined) delete process.env.BASTILLA_API_TOKEN;
    else process.env.BASTILLA_API_TOKEN = prevToken;
    rmSync(dir, { recursive: true, force: true });
  }
});
