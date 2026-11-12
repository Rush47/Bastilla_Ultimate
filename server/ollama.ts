import { execFile, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, statSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OllamaLifecycleState =
  | "ONLINE"
  | "OFFLINE"
  | "MODEL LOADING"
  | "READY"
  | "BUSY"
  | "ERROR";

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
  sizeGb: string;
  parameterSize: string;
  family: string;
  modifiedAt: string;
  multimodal: boolean;
  uncensored: boolean;
}

export interface OllamaRunningModel {
  name: string;
  sizeBytes: number;
  processor: string;
}

export interface OllamaStatusReport {
  state: OllamaLifecycleState;
  reachable: boolean;
  endpoint: string;
  version: string;
  binaryPath: string;
  binaryType: "native-elf" | "python-http-wrapper" | "missing";
  daemonPid: number | null;
  models: OllamaModelInfo[];
  modelNames: string[];
  runningModels: OllamaRunningModel[];
  activeRequests: number;
  isGeminiBridge: boolean;
  message: string;
  checkedAt: string;
}

let activeOllamaRequests = 0;

export async function trackOllamaInference<T>(fn: () => Promise<T>): Promise<T> {
  activeOllamaRequests++;
  try {
    return await fn();
  } finally {
    activeOllamaRequests = Math.max(0, activeOllamaRequests - 1);
  }
}

export function getActiveOllamaRequests(): number {
  return activeOllamaRequests;
}

export function pickPreferredOllamaModel(
  models: OllamaModelInfo[],
  options: { multimodal?: boolean } = {}
): string | null {
  if (!models || models.length === 0) return null;
  if (options.multimodal) {
    const mm = models.find((m) => m.multimodal);
    if (mm) return mm.name;
  }
  const qwenChat = models.find((m) => /qwen/i.test(m.name) && (!options.multimodal || m.multimodal));
  if (qwenChat) return qwenChat.name;
  const uncensored = models.find((m) => m.uncensored);
  if (uncensored) return uncensored.name;
  return models[0].name;
}

export async function pullOllamaModelSafe(
  ollamaBaseUrl: string,
  modelName: string
): Promise<{
  ok: boolean;
  model: string;
  status: OllamaStatusReport;
  message?: string;
  error?: string;
}> {
  const cleanModel = modelName.trim();
  if (!cleanModel || cleanModel.length > 120 || !/^[a-zA-Z0-9._:/-]+$/.test(cleanModel)) {
    const status = await probeOllamaStatus(ollamaBaseUrl);
    return {
      ok: false,
      model: cleanModel,
      status,
      error: "Nieprawidłowa nazwa modelu Ollama.",
    };
  }

  const before = await probeOllamaStatus(ollamaBaseUrl);
  if (!before.reachable) {
    return {
      ok: false,
      model: cleanModel,
      status: before,
      error: before.message || "Daemon Ollama jest offline — nie można pobrać modelu.",
    };
  }

  // Check free disk space and available RAM before pulling weights
  try {
    const { stdout: dfOut } = await execFileAsync("df", ["-Pm", "/"], { timeout: 2000 });
    const lines = dfOut.trim().split("\n");
    const parts = (lines[1] || "").trim().split(/\s+/);
    const freeMb = parseInt(parts[3] || "0", 10);
    if (freeMb > 0 && freeMb < 4096) {
      return {
        ok: false,
        model: cleanModel,
        status: before,
        error: `Zbyt mało wolnego miejsca na dysku (${freeMb} MB < 4096 MB) do pobrania modelu ${cleanModel}.`,
      };
    }
  } catch {}

  try {
    const memRaw = readFileSync("/proc/meminfo", "utf8");
    const availMatch = memRaw.match(/MemAvailable:\s+(\d+)\s+kB/);
    const availMb = availMatch ? Math.round(parseInt(availMatch[1], 10) / 1024) : 0;
    if (availMb > 0 && availMb < 1536) {
      return {
        ok: false,
        model: cleanModel,
        status: before,
        error: `Zbyt mało dostępnej pamięci RAM (${availMb} MB) do bezpiecznego uruchomienia modelu ${cleanModel}.`,
      };
    }
  } catch {}

  const endpoint = ollamaBaseUrl.replace(/\/+$/, "");
  try {
    const res = await fetch(`${endpoint}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanModel, stream: false }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {}
    if (!res.ok || parsed?.error) {
      const afterErr = await probeOllamaStatus(ollamaBaseUrl);
      return {
        ok: false,
        model: cleanModel,
        status: afterErr,
        error: parsed?.error || `Błąd pobierania modelu (HTTP ${res.status}).`,
      };
    }
    const after = await probeOllamaStatus(ollamaBaseUrl);
    return {
      ok: true,
      model: cleanModel,
      status: after,
      message: `Pobrano i zweryfikowano model ${cleanModel} w Ollama.`,
    };
  } catch (err: any) {
    const after = await probeOllamaStatus(ollamaBaseUrl);
    return {
      ok: false,
      model: cleanModel,
      status: after,
      error: err?.message || `Nie udało się pobrać modelu ${cleanModel}.`,
    };
  }
}

async function detectOllamaBinary(): Promise<{
  binaryPath: string;
  binaryType: "native-elf" | "python-http-wrapper" | "missing";
  daemonPid: number | null;
}> {
  const candidates = ["/usr/local/bin/ollama", "/usr/bin/ollama"];
  let binaryPath = "";
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      binaryPath = candidate;
      break;
    }
  }
  if (!binaryPath) {
    try {
      const { stdout } = await execFileAsync("which", ["ollama"], { timeout: 1500 });
      binaryPath = stdout.trim();
    } catch {}
  }

  let binaryType: "native-elf" | "python-http-wrapper" | "missing" = "missing";
  if (binaryPath && existsSync(binaryPath)) {
    try {
      const stat = statSync(binaryPath);
      if (stat.isFile()) {
        const head = readFileSync(binaryPath, { encoding: "utf8" }).slice(0, 256);
        if (head.startsWith("#!") && head.includes("python")) {
          binaryType = "python-http-wrapper";
        } else {
          binaryType = "native-elf";
        }
      }
    } catch {
      binaryType = "native-elf";
    }
  }

  let daemonPid: number | null = null;
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "ollama serve"], { timeout: 1500 });
    const pid = parseInt(stdout.trim().split(/\s+/)[0] || "", 10);
    if (!Number.isNaN(pid) && pid > 0) daemonPid = pid;
  } catch {}

  return { binaryPath, binaryType, daemonPid };
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 2000): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, status: res.status, data: null, error: "Ollama zwróciła odpowiedź inną niż JSON." };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message || "Connection refused" };
  }
}

export async function probeOllamaStatus(ollamaBaseUrl: string): Promise<OllamaStatusReport> {
  const endpoint = ollamaBaseUrl.replace(/\/+$/, "");
  const { binaryPath, binaryType, daemonPid } = await detectOllamaBinary();
  const checkedAt = new Date().toISOString();

  const [verRes, tagsRes, psRes] = await Promise.all([
    fetchJsonWithTimeout(`${endpoint}/api/version`, 2000),
    fetchJsonWithTimeout(`${endpoint}/api/tags`, 2000),
    fetchJsonWithTimeout(`${endpoint}/api/ps`, 2000),
  ]);

  if (!tagsRes.ok && !verRes.ok) {
    return {
      state: "OFFLINE",
      reachable: false,
      endpoint,
      version: "",
      binaryPath,
      binaryType,
      daemonPid,
      models: [],
      modelNames: [],
      runningModels: [],
      activeRequests: activeOllamaRequests,
      isGeminiBridge: false,
      message:
        binaryType === "python-http-wrapper"
          ? `Daemon Ollama pod ${endpoint} jest offline (lokalny plik ${binaryPath} to tylko klient HTTP — brak demona Go Ollama w tym kontenerze). Skonfiguruj zewnętrzny OLLAMA_BASE_URL lub użyj Gemini.`
          : `Daemon Ollama pod ${endpoint} jest offline (${tagsRes.error || "brak połączenia"}).`,
      checkedAt,
    };
  }

  const isGeminiBridge =
    verRes.data?.provider === "gemini-bridge" ||
    tagsRes.data?.provider === "gemini-bridge";

  if (isGeminiBridge) {
    return {
      state: "ERROR",
      reachable: false,
      endpoint,
      version: String(verRes.data?.version || "gemini-bridge"),
      binaryPath,
      binaryType,
      daemonPid,
      models: [],
      modelNames: [],
      runningModels: [],
      activeRequests: activeOllamaRequests,
      isGeminiBridge: true,
      message: `Endpoint ${endpoint} wskazuje na adapter Gemini (gemini-bridge), a nie prawdziwy serwer Ollama.`,
      checkedAt,
    };
  }

  const rawModels: any[] = Array.isArray(tagsRes.data?.models) ? tagsRes.data.models : [];
  const models: OllamaModelInfo[] = rawModels
    .filter((m) => typeof m?.name === "string")
    .map((m) => {
      const name = String(m.name);
      const sizeBytes = typeof m.size === "number" ? m.size : 0;
      const lower = name.toLowerCase();
      return {
        name,
        sizeBytes,
        sizeGb: sizeBytes ? `${(sizeBytes / 1e9).toFixed(1)} GB` : "—",
        parameterSize: String(m.details?.parameter_size || ""),
        family: String(m.details?.family || ""),
        modifiedAt: String(m.modified_at || ""),
        multimodal: /vision|llava|vl|minicpm-v|qwen2\.5vl|qwen3\.5|bakllava/i.test(lower),
        uncensored: /uncensored|abliterated|dolphin|hermes/i.test(lower),
      };
    });

  const rawRunning: any[] = Array.isArray(psRes.data?.models) ? psRes.data.models : [];
  const runningModels: OllamaRunningModel[] = rawRunning
    .filter((m) => typeof m?.name === "string")
    .map((m) => ({
      name: String(m.name),
      sizeBytes: typeof m.size === "number" ? m.size : 0,
      processor: String(m.details?.quantization_level || m.processor || "CPU/GPU"),
    }));

  const modelNames = models.map((m) => m.name);
  const version = String(verRes.data?.version || "online");

  let state: OllamaLifecycleState = "ONLINE";
  if (activeOllamaRequests > 0) {
    state = "BUSY";
  } else if (models.length > 0 && runningModels.length > 0) {
    state = "READY";
  } else if (models.length > 0) {
    state = "READY";
  } else if (tagsRes.ok) {
    state = "ONLINE";
  } else {
    state = "ERROR";
  }

  return {
    state,
    reachable: true,
    endpoint,
    version,
    binaryPath,
    binaryType,
    daemonPid,
    models,
    modelNames,
    runningModels,
    activeRequests: activeOllamaRequests,
    isGeminiBridge: false,
    message:
      models.length > 0
        ? `Ollama v${version} aktywna (${models.length} modeli: ${modelNames.slice(0, 4).join(", ")}).`
        : `Ollama v${version} odpowiada, ale lista modeli (/api/tags) jest pusta.`,
    checkedAt,
  };
}

export async function startOllamaDaemon(ollamaBaseUrl: string): Promise<{
  ok: boolean;
  started: boolean;
  status: OllamaStatusReport;
  error?: string;
}> {
  const before = await probeOllamaStatus(ollamaBaseUrl);
  if (before.reachable) {
    return { ok: true, started: false, status: before };
  }

  if (before.binaryType === "missing") {
    return {
      ok: false,
      started: false,
      status: before,
      error: "Brak binarnego pliku Ollama w systemie.",
    };
  }

  if (before.binaryType === "python-http-wrapper") {
    return {
      ok: false,
      started: false,
      status: before,
      error:
        "Zainstalowany plik /usr/local/bin/ollama to skrypt klienta HTTP bez natywnego serwera Go Ollama (`ollama serve`). Uruchom prawdziwą Ollamę na hoście Linux lub ustaw OLLAMA_BASE_URL.",
    };
  }

  if (before.daemonPid) {
    await new Promise((r) => setTimeout(r, 1200));
    const retry = await probeOllamaStatus(ollamaBaseUrl);
    return { ok: retry.reachable, started: false, status: retry };
  }

  try {
    const logFd = openSync("/tmp/bastilla-ollama.log", "a");
    const child = spawn(before.binaryPath, ["serve"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
    });
    child.unref();

    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const check = await probeOllamaStatus(ollamaBaseUrl);
      if (check.reachable) {
        return { ok: true, started: true, status: check };
      }
    }
    const after = await probeOllamaStatus(ollamaBaseUrl);
    return {
      ok: false,
      started: false,
      status: after,
      error: "Proces ollama serve uruchomiono, ale port 11434 nie odpowiedział w limicie czasu. Sprawdź /tmp/bastilla-ollama.log.",
    };
  } catch (err: any) {
    return {
      ok: false,
      started: false,
      status: before,
      error: err?.message || "Nie udało się uruchomić demona Ollama.",
    };
  }
}

export async function streamOllamaChat(options: {
  ollamaBaseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string; images?: string[] }>;
  signal: AbortSignal;
  onChunk: (textDelta: string) => void;
}): Promise<{ text: string; model: string }> {
  const endpoint = options.ollamaBaseUrl.replace(/\/+$/, "");
  return trackOllamaInference(async () => {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        stream: true,
        messages: options.messages,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    // Handle single non-streaming JSON object (e.g., gemini-bridge or mock HTTP test servers)
    if (!res.body || contentType.includes("application/json")) {
      const body: any = await res.json();
      if (body?.provider === "gemini-bridge") {
        throw new Error("Adapter Gemini nie jest lokalnym modelem Ollama.");
      }
      const full = String(body?.message?.content || body?.response || "");
      if (!full) throw new Error("Ollama zwróciła pustą odpowiedź.");
      options.onChunk(full);
      return { text: full, model: `ollama/${body?.model || options.model}` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let actualModel = options.model;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed?.provider === "gemini-bridge") {
          throw new Error("Adapter Gemini nie jest lokalnym modelem Ollama.");
        }
        if (typeof parsed?.error === "string" && parsed.error) {
          throw new Error(parsed.error);
        }
        if (typeof parsed?.model === "string" && parsed.model) {
          actualModel = parsed.model;
        }
        const delta = typeof parsed?.message?.content === "string"
          ? parsed.message.content
          : typeof parsed?.response === "string"
          ? parsed.response
          : "";
        if (delta) {
          accumulated += delta;
          options.onChunk(delta);
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        const delta = parsed?.message?.content || parsed?.response || "";
        if (delta) {
          accumulated += delta;
          options.onChunk(delta);
        }
      } catch {}
    }

    if (!accumulated.trim()) {
      throw new Error("Ollama zakończyła strumień bez wygenerowania treści.");
    }

    return { text: accumulated, model: `ollama/${actualModel}` };
  });
}
