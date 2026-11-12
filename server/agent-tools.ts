import { Type, type FunctionDeclaration } from "@google/genai";
import { redact } from "./security";
import type { MCPServerManager } from "./mcp";
import type { ImageEnginesStatus, GeneratedImageRecord } from "./images";
import type { OllamaStatusReport } from "./ollama";
import type { DesktopScreenshotResult, DesktopStatusReport, DesktopWindowInfo } from "./desktop";

export type AgentToolPermission =
  | "public_diag"
  | "operator_auth"
  | "mcp_token_required"
  | "privileged_exec";

export type AgentToolSource = "backend" | "mcp" | "image_engine" | "terminal" | "desktop";

export interface AgentToolDefinition {
  name: string;
  description: string;
  source: AgentToolSource;
  permission: AgentToolPermission;
  allowedAgents: string[];
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: "string" | "number" | "boolean";
        description: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}

export interface ToolExecutionOutcome {
  tool: string;
  source: AgentToolSource;
  permission: AgentToolPermission;
  status: "executed" | "planned" | "unavailable" | "denied" | "error";
  summary: string;
  data: Record<string, any> | null;
  error?: string;
  executedAt: string;
  durationMs: number;
}

export interface DetectedUserIntents {
  intents: string[];
  suggestedTools: Array<{ name: string; args: Record<string, any> }>;
  mode: "chat" | "vision" | "image_generate" | "diagnostic" | "terminal";
}

export const ALL_AGENT_IDS = ["aria", "alex", "astyria", "aurelius", "council"];

export const AGENT_TOOL_CATALOG: AgentToolDefinition[] = [
  {
    name: "ollama_status",
    description:
      "Sprawdza rzeczywisty stan demona Ollama (/api/ollama/status): dostępność API, endpoint, typ binarki, wersję, załadowane modele (/api/ps) i listę modeli (/api/tags).",
    source: "backend",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mcp_status",
    description:
      "Pobiera rzeczywisty stan serwera Model Context Protocol (/api/mcp/status): endpoint, transport, konfigurację BASTILLA_API_TOKEN, listę narzędzi MCP i status logowania Codex CLI.",
    source: "mcp",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "image_engine_status",
    description:
      "Sprawdza dostępność rzeczywistych silników graficznych (/api/images/status): ComfyUI, lokalne SD WebUI/Diffusers oraz Gemini Image API.",
    source: "image_engine",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "agent_health_status",
    description:
      "Odczytuje rzeczywisty stan procesów, kont Linux (UID/GID), ostatni heartbeat oraz kolejkę zadań dla agentów Aria, Alex, Astyria i Aurelius.",
    source: "backend",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "Opcjonalny identyfikator agenta (aria, alex, astyria, aurelius).",
          enum: ["aria", "alex", "astyria", "aurelius"],
        },
      },
    },
  },
  {
    name: "system_diagnostics_snapshot",
    description:
      "Odczytuje rzeczywiste parametry hosta Linux (uname, RAM, dysk /, load average), status Codex CLI oraz podstawowe informacje gałęzi Git.",
    source: "backend",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mcp_git_status",
    description:
      "Wywołuje chronione narzędzie MCP git_status zwracające aktualną gałąź i zmodyfikowane pliki repozytorium (wymaga BASTILLA_API_TOKEN).",
    source: "mcp",
    permission: "mcp_token_required",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mcp_agent_memory_read",
    description:
      "Wywołuje chronione narzędzie MCP agent_memory_read odczytujące memory.json agenta (wymaga BASTILLA_API_TOKEN).",
    source: "mcp",
    permission: "mcp_token_required",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "ID agenta (aria, alex, astyria, aurelius).",
          enum: ["aria", "alex", "astyria", "aurelius"],
        },
      },
      required: ["agentId"],
    },
  },
  {
    name: "generate_image",
    description:
      "Uruchamia rzeczywisty pipeline generowania obrazu (ComfyUI -> lokalne SD WebUI -> Gemini Image API) i zapisuje wygenerowany plik na dysku oraz w SQLite.",
    source: "image_engine",
    permission: "operator_auth",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Dokładny opis obrazu do wygenerowania.",
        },
        aspectRatio: {
          type: "string",
          description: "Proporcje obrazu (np. 1:1, 16:9, 9:16, 4:3).",
          enum: ["1:1", "16:9", "9:16", "4:3"],
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "terminal_exec_authorized",
    description:
      "Wykonuje pojedyncze autoryzowane polecenie w powłoce Linux backendu (/api/terminal/exec) z rejestracją stdout/stderr/exitCode.",
    source: "terminal",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Polecenie powłoki Linux do wykonania w kontekście projektu.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "desktop_status",
    description:
      "Sprawdza dostępność lokalnej sesji graficznej Linux (DISPLAY X11, Wayland, rozdzielczość, aktywne okno, VNC/noVNC i zgodę na sterowanie AI).",
    source: "desktop",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "desktop_screenshot",
    description:
      "Wykonuje świeży zrzut ekranu bieżącej sesji X11 (nigdy nie zwraca przestarzałego zrzutu z poprzedniej sesji).",
    source: "desktop",
    permission: "operator_auth",
    allowedAgents: ALL_AGENT_IDS,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "desktop_window_list",
    description: "Pobiera listę okien w aktywnej sesji pulpitu X11 (wmctrl).",
    source: "desktop",
    permission: "public_diag",
    allowedAgents: ALL_AGENT_IDS,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "desktop_window_focus",
    description: "Przenosi fokus na wskazane okno w izolowanej sesji pulpitu AI.",
    source: "desktop",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "ID okna (0x...) lub fragment tytułu okna." },
      },
      required: ["target"],
    },
  },
  {
    name: "desktop_mouse_move",
    description: "Przesuwa kursor myszy w izolowanej sesji pulpitu AI na zweryfikowane współrzędne (x, y).",
    source: "desktop",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Pozycja pozioma X (px)." },
        y: { type: "number", description: "Pozycja pionowa Y (px)." },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop_mouse_click",
    description: "Klika myszą w izolowanej sesji pulpitu AI pod wskazanymi współrzędnymi (x, y).",
    source: "desktop",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "Pozycja pozioma X (px)." },
        y: { type: "number", description: "Pozycja pionowa Y (px)." },
        button: { type: "string", description: "Przycisk myszy.", enum: ["left", "middle", "right"] },
        doubleClick: { type: "boolean", description: "Czy wykonać podwójne kliknięcie." },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop_mouse_scroll",
    description: "Przewija widok myszą w izolowanej sesji pulpitu AI.",
    source: "desktop",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", description: "Kierunek przewijania.", enum: ["up", "down", "left", "right"] },
        clicks: { type: "number", description: "Liczba kroków przewijania (1-15)." },
      },
      required: ["direction"],
    },
  },
  {
    name: "desktop_keyboard_type",
    description: "Wpisuje krótki bezpieczny tekst w aktywnym oknie izolowanego pulpitu AI.",
    source: "desktop",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Tekst do wpisania (maks. 500 znaków)." },
      },
      required: ["text"],
    },
  },
  {
    name: "desktop_keyboard_press",
    description: "Naciska pojedynczy dozwolony klawisz lub kombinację (np. Return, Escape, ctrl+c).",
    source: "desktop",
    permission: "privileged_exec",
    allowedAgents: ALL_AGENT_IDS,
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Nazwa klawisza lub kombinacji (np. Return, Tab, ctrl+l)." },
      },
      required: ["key"],
    },
  },
];

function cleanImagePrompt(raw: string): string {
  return raw
    .replace(/@(?:aria|alex|astyria|aurelius|wszyscy)\b/gi, "")
    .replace(
      /^(?:prosz[eę]\s+)?(?:wygeneruj|narysuj|stw[oó]rz|zr[oó]b|namaluj|generate|draw|create)\s+(?:mi\s+)?(?:nowy\s+|prawdziwy\s+)?(?:obraz(?:ek)?|grafik[eę]|zdj[eę]cie|ilustracj[eę]|image|picture)\s*(?:przedstawiaj[aą]c[yae]?|z|:|\-)?\s*/i,
      ""
    )
    .trim() || raw.trim();
}

function detectAspectRatio(raw: string): "1:1" | "16:9" | "9:16" | "4:3" {
  if (/16:9|panoram/i.test(raw)) return "16:9";
  if (/9:16|pionow|portret/i.test(raw)) return "9:16";
  if (/4:3/i.test(raw)) return "4:3";
  return "1:1";
}

export function detectUserIntents(
  message: string,
  options: { hasImage?: boolean } = {}
): DetectedUserIntents {
  const trimmed = String(message || "").trim();
  const intents: string[] = [];
  const suggestedTools: Array<{ name: string; args: Record<string, any> }> = [];
  const seenTools = new Set<string>();

  const addTool = (name: string, args: Record<string, any> = {}) => {
    if (seenTools.has(name)) return;
    seenTools.add(name);
    suggestedTools.push({ name, args });
  };

  if (options.hasImage) {
    intents.push("image_vision");
  }

  // Explicit /exec command or direct "uruchom w terminalu: <cmd>" instruction
  const slashCmd = trimmed.match(/^\/(exec|root|sudo|bash)\s+(.+)$/i);
  const nlCmd = !slashCmd
    ? trimmed.match(
        /^(?:uruchom|wykonaj|odpal)\s+(?:komend[eę]|polecenie|w\s+terminalu)\s*[:\-]\s*(.+)$/i
      )
    : null;
  if (slashCmd || nlCmd) {
    const cmd = (slashCmd?.[2] || nlCmd?.[1] || "").trim();
    if (cmd) {
      intents.push("terminal_exec");
      addTool("terminal_exec_authorized", { command: cmd });
    }
  }

  // Image generation intent (skip if clearly asking only about status/error)
  const asksImageGen =
    /\b(wygeneruj|narysuj|stw[oó]rz|zr[oó]b|namaluj|generate|draw|create)\b.*\b(obraz\w*|grafik\w*|zdj[eę]ci\w*|ilustracj\w*|render\w*|art|image|picture)\b|^(?:narysuj|namaluj|wygeneruj\s+obraz\w*)\b/i.test(
      trimmed
    ) && !/\b(dlaczego|czemu|czy działa|status|sprawdź\s+silnik|jaki\s+silnik)\b/i.test(trimmed);
  if (asksImageGen) {
    intents.push("image_generate");
    addTool("generate_image", {
      prompt: cleanImagePrompt(trimmed),
      aspectRatio: detectAspectRatio(trimmed),
    });
  }

  // Image engine diagnostic check
  if (
    /\b(silnik\w*\s+graficz\w*|generator\w*\s+obraz\w*|comfyui|sd\s*webui|status\s+obraz\w*|gemini\s+image)\b/i.test(
      trimmed
    )
  ) {
    intents.push("image_engine_status");
    addTool("image_engine_status");
  }

  // Ollama diagnostic check
  if (
    /\bollama\b|11434|\bqwen\b|modele?\s+(?:lokaln\w*|ollama)|ollama\s+list|daemon\s+ollama|status\s+ollam/i.test(
      trimmed
    )
  ) {
    intents.push("ollama_status");
    addTool("ollama_status");
  }

  // MCP diagnostic check
  if (/\bmcp\b|json-rpc|stdio|\/api\/mcp|narz[eę]dz\w*\s+mcp/i.test(trimmed)) {
    intents.push("mcp_status");
    addTool("mcp_status");
  }

  // Git repository status intent
  if (
    /\b(git[\s_-]*status|repozytori\w*|ga[łl][aą][zź]\s+git|branch\b|zmian\w*\s+plik\w*)\b/i.test(
      trimmed
    )
  ) {
    intents.push("mcp_git_status");
    addTool("mcp_git_status");
  }

  // Agent heartbeat / process / UID / worker status intent
  const mentionedAgentMatch = trimmed.match(/\b(aria|alex|astyria|aurelius)\b/i);
  const asksAgentHealth =
    /\b(aria|alex|astyria|aurelius|agent\w*)\b.*\b(status|stan|heartbeat|proces\w*|pid\b|uid\b|gid\b|worker\w*|dzia[łl]a|żyj\w*|uprawnieni\w*|dost[eę]p\w*)\b|\b(status|stan|heartbeat|proces\w*|pid\b|uid\b|worker\w*)\b.*\b(aria|alex|astyria|aurelius|agent\w*)\b/i.test(
      trimmed
    );
  if (asksAgentHealth) {
    intents.push("agent_health_status");
    addTool(
      "agent_health_status",
      mentionedAgentMatch ? { agentId: mentionedAgentMatch[1].toLowerCase() } : {}
    );
  }

  // Agent memory.json explicit check
  if (
    mentionedAgentMatch &&
    /\b(memory\.json|pami[eę][cć]\s+lokaln|odczytaj\s+pami[eę][cć])\b/i.test(trimmed)
  ) {
    intents.push("mcp_agent_memory_read");
    addTool("mcp_agent_memory_read", { agentId: mentionedAgentMatch[1].toLowerCase() });
  }

  // Linux / host diagnostics intent
  if (
    /\b(uname|kernel\s+linux|pami[eę][cć]\s+ram|wolne\s+miejsce|df\s+-h|load\s*average|diagnostyk\w*\s+(?:system|linux)|codex\s+status|stan\s+codex)\b/i.test(
      trimmed
    )
  ) {
    intents.push("system_diagnostics_snapshot");
    addTool("system_diagnostics_snapshot");
  }

  // Local AI desktop inspection intent
  if (
    /\b(desktop_status|desktop_screenshot|zrzut\w*\s+(?:pulpitu|ekranu)|stan\s+pulpitu|zdalny\s+pulpit|novnc|x11\s+display)\b/i.test(
      trimmed
    )
  ) {
    intents.push("desktop_status");
    addTool("desktop_status");
  }

  let mode: DetectedUserIntents["mode"] = "chat";
  if (intents.includes("terminal_exec")) mode = "terminal";
  else if (intents.includes("image_generate")) mode = "image_generate";
  else if (options.hasImage) mode = "vision";
  else if (suggestedTools.length > 0) mode = "diagnostic";

  return { intents, suggestedTools, mode };
}

export function toGeminiFunctionDeclarations(
  catalog: AgentToolDefinition[] = AGENT_TOOL_CATALOG
): FunctionDeclaration[] {
  return catalog.map((tool) => {
    const props: Record<string, any> = {};
    for (const [key, schema] of Object.entries(tool.parameters.properties || {})) {
      props[key] = {
        type:
          schema.type === "number"
            ? Type.NUMBER
            : schema.type === "boolean"
            ? Type.BOOLEAN
            : Type.STRING,
        description: schema.description,
        ...(schema.enum ? { enum: schema.enum } : {}),
      };
    }
    return {
      name: tool.name,
      description: `[${tool.source} | uprawnienie: ${tool.permission}] ${tool.description}`,
      parameters: {
        type: Type.OBJECT,
        properties: props,
        ...(tool.parameters.required?.length ? { required: tool.parameters.required } : {}),
      },
    };
  });
}

export function toOllamaTools(catalog: AgentToolDefinition[] = AGENT_TOOL_CATALOG) {
  return catalog.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: `[${tool.source} | ${tool.permission}] ${tool.description}`,
      parameters: tool.parameters,
    },
  }));
}

export interface AgentToolRuntimeDeps {
  probeOllama: () => Promise<OllamaStatusReport>;
  getMcpStatus: () => Promise<Record<string, any>>;
  probeImageEngines: () => Promise<ImageEnginesStatus>;
  generateImage: (args: {
    prompt: string;
    agentId: string;
    mode?: "generate" | "edit" | "variation";
    aspectRatio?: string;
  }) => Promise<{
    ok: boolean;
    engineStatus: "READY" | "BRAK SILNIKA" | "ERROR";
    image?: GeneratedImageRecord;
    caption?: string;
    error?: string;
  }>;
  getAgentsHealth: (agentId?: string) => Promise<Record<string, any>>;
  getSystemDiagnostics: () => Promise<Record<string, any>>;
  mcpManager: MCPServerManager;
  executeTerminal: (
    mode: string,
    command: string,
    agentId: string
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  desktop?: {
    getStatus: () => Promise<DesktopStatusReport>;
    captureScreenshot: (agentId: string) => Promise<DesktopScreenshotResult>;
    listWindows: () => Promise<DesktopWindowInfo[]>;
    focusWindow: (target: string, agentId: string) => Promise<any>;
    mouseMove: (x: number, y: number, agentId: string) => Promise<any>;
    mouseClick: (x: number, y: number, button: "left" | "middle" | "right", doubleClick: boolean, agentId: string) => Promise<any>;
    mouseScroll: (direction: "up" | "down" | "left" | "right", clicks: number, agentId: string) => Promise<any>;
    keyboardType: (text: string, agentId: string) => Promise<any>;
    keyboardPress: (key: string, agentId: string) => Promise<any>;
  };
}

export class AgentToolRuntime {
  constructor(private deps: AgentToolRuntimeDeps) {}

  async listCatalog(context: {
    agentId?: string;
    operatorToken?: string;
    authorizedOperator?: boolean;
  }) {
    const hasMcpToken = Boolean(
      process.env.BASTILLA_API_TOKEN &&
        context.operatorToken &&
        process.env.BASTILLA_API_TOKEN === context.operatorToken
    );
    return {
      ok: true,
      agentId: context.agentId || "aria",
      tools: AGENT_TOOL_CATALOG.map((tool) => {
        let usableNow = true;
        let availabilityNote = "Gotowe do wywołania przez backend.";
        if (tool.permission === "mcp_token_required" && !hasMcpToken) {
          usableNow = false;
          availabilityNote = process.env.BASTILLA_API_TOKEN
            ? "Wymaga poprawnego tokenu operatora (BASTILLA_API_TOKEN)."
            : "BASTILLA_API_TOKEN nie jest ustawiony w środowisku serwera.";
        } else if (tool.permission === "privileged_exec" && !context.authorizedOperator) {
          usableNow = false;
          availabilityNote = "Wymaga autoryzowanej sesji operatora Bastilla OS.";
        }
        return {
          ...tool,
          usableNow,
          availabilityNote,
        };
      }),
    };
  }

  async executeTool(
    toolName: string,
    args: Record<string, any> = {},
    context: {
      agentId: string;
      operatorToken?: string;
      authorizedOperator?: boolean;
    }
  ): Promise<ToolExecutionOutcome> {
    const startedAt = Date.now();
    const executedAt = new Date().toISOString();
    const def = AGENT_TOOL_CATALOG.find((t) => t.name === toolName);
    if (!def) {
      return {
        tool: toolName,
        source: "backend",
        permission: "public_diag",
        status: "unavailable",
        summary: `Nieznane narzędzie w katalogu: ${toolName}`,
        data: null,
        error: `Narzędzie "${toolName}" nie istnieje w katalogu agentów.`,
        executedAt,
        durationMs: Date.now() - startedAt,
      };
    }

    const safeAgent = ["aria", "alex", "astyria", "aurelius"].includes(
      String(context.agentId || "").toLowerCase()
    )
      ? String(context.agentId).toLowerCase()
      : "aria";

    try {
      if (toolName === "ollama_status") {
        const status = await this.deps.probeOllama();
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: "executed",
          summary: `Ollama: ${status.state} (${status.endpoint}, binaryType=${status.binaryType}, modele=${status.modelNames.length})`,
          data: status as unknown as Record<string, any>,
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName === "mcp_status") {
        const status = await this.deps.getMcpStatus();
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: "executed",
          summary: `MCP: endpoint=${status.endpoint}, configured=${Boolean(status.configured)}, narzędzia=${(status.tools || []).join(", ")}`,
          data: status,
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName === "image_engine_status") {
        const status = await this.deps.probeImageEngines();
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: "executed",
          summary: `Silnik graficzny: ${status.engineStatus} (aktywny=${status.activeSource || "brak"})`,
          data: status as unknown as Record<string, any>,
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName === "agent_health_status") {
        const targetAgent = args.agentId ? String(args.agentId).toLowerCase() : undefined;
        const health = await this.deps.getAgentsHealth(targetAgent);
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: "executed",
          summary: targetAgent
            ? `Pobrano stan procesu i heartbeat dla ${targetAgent}.`
            : "Pobrano stan procesów i heartbeat wszystkich 4 agentów.",
          data: health,
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName === "system_diagnostics_snapshot") {
        const diag = await this.deps.getSystemDiagnostics();
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: "executed",
          summary: `Pobrano diagnostykę systemu Linux (${diag.uname || "Linux"}) oraz Codex CLI.`,
          data: diag,
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName === "mcp_git_status") {
        try {
          const gitResult = this.deps.mcpManager.executeTool(
            "git_status",
            {},
            context.operatorToken
          );
          return {
            tool: toolName,
            source: "mcp",
            permission: def.permission,
            status: "executed",
            summary: `MCP git_status: gałąź ${gitResult.branch}`,
            data: gitResult as Record<string, any>,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        } catch (err: any) {
          return {
            tool: toolName,
            source: "mcp",
            permission: def.permission,
            status: "denied",
            summary: "Odmowa dostępu do chronionego narzędzia MCP git_status.",
            data: { configured: Boolean(process.env.BASTILLA_API_TOKEN) },
            error: redact(err?.message || "MCP wymaga poprawnego BASTILLA_API_TOKEN."),
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      if (toolName === "mcp_agent_memory_read") {
        const targetAgent = String(args.agentId || safeAgent).toLowerCase();
        try {
          const memResult = this.deps.mcpManager.executeTool(
            "agent_memory_read",
            { agentId: targetAgent },
            context.operatorToken
          );
          return {
            tool: toolName,
            source: "mcp",
            permission: def.permission,
            status: "executed",
            summary: `MCP agent_memory_read (${targetAgent}): odczytano memory.json.`,
            data: memResult as Record<string, any>,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        } catch (err: any) {
          return {
            tool: toolName,
            source: "mcp",
            permission: def.permission,
            status: "denied",
            summary: `Odmowa dostępu do MCP agent_memory_read (${targetAgent}).`,
            data: { configured: Boolean(process.env.BASTILLA_API_TOKEN), agentId: targetAgent },
            error: redact(err?.message || "MCP wymaga poprawnego BASTILLA_API_TOKEN."),
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      if (toolName === "generate_image") {
        if (!context.authorizedOperator) {
          return {
            tool: toolName,
            source: def.source,
            permission: def.permission,
            status: "denied",
            summary: "Generowanie obrazu wymaga autoryzowanej sesji operatora.",
            data: null,
            error: "Brak autoryzacji operatora do wywołania generatora obrazów.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        const prompt = String(args.prompt || "").trim();
        if (!prompt) {
          return {
            tool: toolName,
            source: def.source,
            permission: def.permission,
            status: "error",
            summary: "Pusty prompt generowania obrazu.",
            data: null,
            error: "Podaj opis obrazu (prompt).",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        const chosenRatio = typeof args.aspectRatio === "string" ? args.aspectRatio : "1:1";
        const genRes = await this.deps.generateImage({
          prompt,
          agentId: safeAgent,
          mode: "generate",
          aspectRatio: chosenRatio,
        });
        if (genRes.ok && genRes.image) {
          return {
            tool: toolName,
            source: def.source,
            permission: def.permission,
            status: "executed",
            summary: `Wygenerowano obraz (${genRes.image.source}/${genRes.image.model}, ${genRes.image.byte_size} B).`,
            data: {
              engineStatus: genRes.engineStatus,
              aspectRatio: chosenRatio,
              image: genRes.image,
              caption: genRes.caption || prompt,
            },
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: genRes.engineStatus === "BRAK SILNIKA" ? "unavailable" : "error",
          summary: `Nie udało się wygenerować obrazu (${genRes.engineStatus}).`,
          data: { engineStatus: genRes.engineStatus },
          error: genRes.error || "Silnik graficzny nie wygenerował obrazu.",
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName === "terminal_exec_authorized") {
        if (!context.authorizedOperator) {
          return {
            tool: toolName,
            source: def.source,
            permission: def.permission,
            status: "denied",
            summary: "Wykonanie polecenia terminalowego wymaga autoryzowanej sesji operatora.",
            data: null,
            error: "Brak uprawnień operatora do uruchomienia terminala.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        const cmd = String(args.command || "").trim();
        if (!cmd) {
          return {
            tool: toolName,
            source: def.source,
            permission: def.permission,
            status: "error",
            summary: "Puste polecenie terminalowe.",
            data: null,
            error: "Podaj polecenie do wykonania.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (/pkill\s+-f\s+server|killall\s+node|rm\s+-rf\s+\/\s*$|shutdown|reboot|mkfs\.|:\(\)\s*\{/i.test(cmd)) {
          return {
            tool: toolName,
            source: def.source,
            permission: def.permission,
            status: "denied",
            summary: "Polecenie zablokowane przez politykę bezpieczeństwa.",
            data: { command: cmd },
            error: "Destrukcyjne polecenie zostało zablokowane przez kontrolę wykonania.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        const termOut = await this.deps.executeTerminal("LINUX_ROOT", cmd, safeAgent);
        return {
          tool: toolName,
          source: def.source,
          permission: def.permission,
          status: "executed",
          summary: `Wykonano polecenie w terminalu (exitCode=${termOut.exitCode}).`,
          data: {
            command: cmd,
            exitCode: termOut.exitCode,
            stdout: redact(termOut.stdout).slice(0, 6000),
            stderr: redact(termOut.stderr).slice(0, 3000),
          },
          executedAt,
          durationMs: Date.now() - startedAt,
        };
      }

      if (toolName.startsWith("desktop_")) {
        if (!this.deps.desktop) {
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "unavailable",
            summary: `Moduł pulpitu X11 nie jest skonfigurowany w bieżącym środowisku.`,
            data: null,
            error: "DesktopSessionManager nie został podłączony.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (def.permission === "operator_auth" && !context.authorizedOperator) {
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "denied",
            summary: "Zrzut ekranu wymaga autoryzowanej sesji operatora.",
            data: null,
            error: "Brak autoryzacji operatora.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (def.permission === "privileged_exec" && !context.authorizedOperator) {
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "denied",
            summary: "Sterowanie pulpitem wymaga autoryzowanej sesji operatora.",
            data: null,
            error: "Brak uprawnień operatora do sterowania GUI.",
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_status") {
          const st = await this.deps.desktop.getStatus();
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Pulpit: DISPLAY=${st.display || "brak"}, X11=${st.x11SessionActive}, VNC=${st.vncRunning}, AI=${st.aiControlEnabled}`,
            data: st as unknown as Record<string, any>,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_window_list") {
          const windows = await this.deps.desktop.listWindows();
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Lista okien pulpitu: ${windows.length} okien.`,
            data: { windows },
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_screenshot") {
          const shot = await this.deps.desktop.captureScreenshot(safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Zrzut ekranu X11 ${shot.width}x${shot.height} (${shot.byteSize} B, sesja ${shot.sessionId}).`,
            data: {
              mimeType: shot.mimeType,
              width: shot.width,
              height: shot.height,
              display: shot.display,
              sessionId: shot.sessionId,
              capturedAt: shot.capturedAt,
              byteSize: shot.byteSize,
              imageDataUrl: `data:${shot.mimeType};base64,${shot.base64}`,
            },
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_window_focus") {
          const res = await this.deps.desktop.focusWindow(String(args.target || ""), safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Przełączono fokus na okno ${res.focused}.`,
            data: res,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_mouse_move") {
          const res = await this.deps.desktop.mouseMove(Number(args.x), Number(args.y), safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Kursor przesunięty na (${res.x}, ${res.y}).`,
            data: res,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_mouse_click") {
          const btn = ["left", "middle", "right"].includes(String(args.button))
            ? (String(args.button) as "left" | "middle" | "right")
            : "left";
          const res = await this.deps.desktop.mouseClick(Number(args.x), Number(args.y), btn, Boolean(args.doubleClick), safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Kliknięto ${btn} na (${res.x}, ${res.y}).`,
            data: res,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_mouse_scroll") {
          const dir = ["up", "down", "left", "right"].includes(String(args.direction))
            ? (String(args.direction) as "up" | "down" | "left" | "right")
            : "down";
          const res = await this.deps.desktop.mouseScroll(dir, Number(args.clicks || 3), safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Przewinięto ${res.direction} (${res.clicks}x).`,
            data: res,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_keyboard_type") {
          const res = await this.deps.desktop.keyboardType(String(args.text || ""), safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Wpisano ${res.typedLength} znaków.`,
            data: res,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
        if (toolName === "desktop_keyboard_press") {
          const res = await this.deps.desktop.keyboardPress(String(args.key || ""), safeAgent);
          return {
            tool: toolName,
            source: "desktop",
            permission: def.permission,
            status: "executed",
            summary: `Naciśnięto klawisz ${res.key}.`,
            data: res,
            executedAt,
            durationMs: Date.now() - startedAt,
          };
        }
      }

      return {
        tool: toolName,
        source: def.source,
        permission: def.permission,
        status: "unavailable",
        summary: `Brak obsługi narzędzia ${toolName}.`,
        data: null,
        error: `Narzędzie ${toolName} nie ma przypisanego wykonawcy.`,
        executedAt,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: any) {
      return {
        tool: toolName,
        source: def.source,
        permission: def.permission,
        status: "error",
        summary: `Błąd wykonania narzędzia ${toolName}.`,
        data: null,
        error: redact(err?.message || "Nieznany błąd wykonania narzędzia."),
        executedAt,
        durationMs: Date.now() - startedAt,
      };
    }
  }
}

export function buildToolGroundingPrompt(
  outcomes: ToolExecutionOutcome[],
  catalog: AgentToolDefinition[] = AGENT_TOOL_CATALOG
): string {
  const executed = outcomes.filter((o) => o.status === "executed");
  const blockedOrFailed = outcomes.filter((o) => o.status !== "executed");
  const executedNames = new Set(outcomes.map((o) => o.tool));
  const notExecuted = catalog.filter((t) => !executedNames.has(t.name));

  const sections: string[] = [
    "ZASADA KRYTYCZNA WERYFIKACJI NARZĘDZI:",
    "- Nigdy nie twierdź, że sprawdziłeś Ollamę, MCP, stan agenta, system Linux albo wygenerowałeś obraz, jeśli narzędzie nie znajduje się na liście [WYKONANE].",
    "- Każda liczba, stan (ONLINE/OFFLINE/READY/BRAK SILNIKA), nazwa modelu, PID/UID, gałąź Git lub błąd musi pochodzić wyłącznie z poniższych rzeczywistych wyników API.",
    "- Wyraźnie rozróżniaj operacje [WYKONANE], [NIEDOSTĘPNE / BŁĄD / ODMOWA] oraz narzędzia [DOSTĘPNE DO WYWOŁANIA / NIEWYKONANE].",
  ];

  if (executed.length > 0) {
    sections.push(
      "\n[WYKONANE — RZECZYWISTE WYNIKI Z BACKENDU]:\n" +
        executed
          .map(
            (o) =>
              `- ${o.tool} (${o.source}, ${o.durationMs} ms): ${o.summary}\n  JSON: ${JSON.stringify(
                o.data
              ).slice(0, 3500)}`
          )
          .join("\n")
    );
  } else {
    sections.push("\n[WYKONANE]: brak wywołanych narzędzi przed tą turą.");
  }

  if (blockedOrFailed.length > 0) {
    sections.push(
      "\n[NIEDOSTĘPNE / BŁĄD / ODMOWA]:\n" +
        blockedOrFailed
          .map(
            (o) =>
              `- ${o.tool} (status=${o.status}): ${o.summary} | przyczyna=${o.error || "brak"} | szczegóły=${JSON.stringify(
                o.data
              )}`
          )
          .join("\n")
    );
  }

  if (notExecuted.length > 0) {
    sections.push(
      "\n[KATALOG NIEWYKONANYCH NARZĘDZI — MOŻESZ JE WYWOŁAĆ LUB ZAPLANOWAĆ, ALE NIE TWIERDŹ ŻE JUŻ JE SPRAWDZIŁEŚ]:\n" +
        notExecuted
          .map((t) => `- ${t.name} [${t.permission}]: ${t.description}`)
          .join("\n")
    );
  }

  return sections.join("\n");
}
