export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status = 0, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

const EXTERNAL_BACKEND_STORAGE_KEY = "bastilla_external_backend_url";

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onApiUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function notifyUnauthorized() {
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch {}
  }
}

export function getExternalBackendUrl(): string {
  try {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem(EXTERNAL_BACKEND_STORAGE_KEY)
        : "";
    if (stored && /^https?:\/\//i.test(stored.trim())) {
      const cleaned = stored.trim().replace(/\/+$/, "");
      if (typeof window !== "undefined" && cleaned === window.location.origin) {
        return "";
      }
      return cleaned;
    }
  } catch {}

  const envUrl = (import.meta as any)?.env?.VITE_BACKEND_URL;
  if (typeof envUrl === "string" && /^https?:\/\//i.test(envUrl.trim())) {
    const cleaned = envUrl.trim().replace(/\/+$/, "");
    if (typeof window !== "undefined" && cleaned === window.location.origin) {
      return "";
    }
    return cleaned;
  }
  return "";
}

export function setExternalBackendUrl(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, "");
  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    throw new Error("Adres backendu musi zaczynać się od http:// lub https://.");
  }
  try {
    if (typeof window !== "undefined") {
      if (cleaned && cleaned !== window.location.origin) {
        window.localStorage.setItem(EXTERNAL_BACKEND_STORAGE_KEY, cleaned);
      } else {
        window.localStorage.removeItem(EXTERNAL_BACKEND_STORAGE_KEY);
      }
    }
  } catch {}
  return cleaned;
}

export function buildApiUrl(path: string, ignoreExternal = false): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (ignoreExternal) return normalizedPath;
  const base = getExternalBackendUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart().slice(0, 200).toLowerCase();
  return (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body")
  );
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  timeoutMs?: number;
}

let rateLimitCooldownUntil = 0;
let consecutiveRateLimits = 0;

export function parseRetryAfterMs(response: Response, fallbackMs = 4000): number {
  const header = response.headers.get("retry-after");
  if (!header) return fallbackMs;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30000, Math.max(1500, Math.round(seconds * 1000)));
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.min(30000, Math.max(1500, dateMs - Date.now()));
  }
  return fallbackMs;
}

export function markApiRateLimited(waitMs?: number): number {
  consecutiveRateLimits = Math.min(consecutiveRateLimits + 1, 4);
  const backoffMs = Math.min(
    30000,
    Math.max(waitMs ?? 0, 3500 * Math.pow(2, consecutiveRateLimits - 1))
  );
  const until = Date.now() + backoffMs;
  if (until > rateLimitCooldownUntil) {
    rateLimitCooldownUntil = until;
  }
  return backoffMs;
}

export function resetApiRateLimit(): void {
  consecutiveRateLimits = 0;
  rateLimitCooldownUntil = 0;
}

export function getRateLimitRemainingMs(): number {
  return Math.max(0, rateLimitCooldownUntil - Date.now());
}

export function isApiRateLimited(): boolean {
  return getRateLimitRemainingMs() > 0;
}

export function delayMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Shared single-connection SSE hub to avoid opening duplicate /api/events/stream connections
type SseListener = (ev: MessageEvent) => void;
const sseListeners = new Map<string, Set<SseListener>>();
let sharedSse: EventSource | null = null;
let sharedSseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let sharedSseFailures = 0;
let visibilityBound = false;

function totalSseSubscribers(): number {
  let count = 0;
  for (const set of sseListeners.values()) count += set.size;
  return count;
}

function dispatchSharedSse(type: string, ev: MessageEvent) {
  const set = sseListeners.get(type);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(ev);
    } catch {}
  }
}

const KNOWN_SSE_EVENTS = [
  "sync",
  "git_sync",
  "mission_cycle",
  "image_generated",
  "desktop_status",
  "agent_task",
  "chat_message",
  "bidirectional_chat_status",
];

function closeSharedSse() {
  if (sharedSseReconnectTimer) {
    clearTimeout(sharedSseReconnectTimer);
    sharedSseReconnectTimer = null;
  }
  if (sharedSse) {
    try {
      sharedSse.close();
    } catch {}
    sharedSse = null;
  }
}

function ensureSharedSse() {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  if (totalSseSubscribers() === 0) {
    closeSharedSse();
    return;
  }
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    closeSharedSse();
    return;
  }
  if (sharedSse) return;

  const remaining = getRateLimitRemainingMs();
  if (remaining > 0) {
    if (!sharedSseReconnectTimer) {
      sharedSseReconnectTimer = setTimeout(() => {
        sharedSseReconnectTimer = null;
        ensureSharedSse();
      }, remaining + 300);
    }
    return;
  }

  if (!visibilityBound && typeof document !== "undefined") {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        ensureSharedSse();
      } else {
        closeSharedSse();
      }
    });
  }

  const es = new EventSource(buildApiUrl("/api/events/stream"));
  sharedSse = es;

  es.onopen = () => {
    sharedSseFailures = 0;
  };

  for (const evtName of KNOWN_SSE_EVENTS) {
    es.addEventListener(evtName, (ev) => dispatchSharedSse(evtName, ev as MessageEvent));
  }

  es.onerror = () => {
    // Close immediately so native EventSource does not hammer 3s reconnects on 429
    if (sharedSse === es) {
      try {
        es.close();
      } catch {}
      sharedSse = null;
    }
    if (totalSseSubscribers() === 0) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    sharedSseFailures = Math.min(sharedSseFailures + 1, 5);
    const delay = Math.max(
      getRateLimitRemainingMs(),
      Math.min(30000, 4000 * Math.pow(2, sharedSseFailures - 1))
    );
    if (!sharedSseReconnectTimer) {
      sharedSseReconnectTimer = setTimeout(() => {
        sharedSseReconnectTimer = null;
        ensureSharedSse();
      }, delay);
    }
  };
}

export function subscribeBastillaEvent(eventType: string, handler: SseListener): () => void {
  let set = sseListeners.get(eventType);
  if (!set) {
    set = new Set();
    sseListeners.set(eventType, set);
  }
  set.add(handler);
  ensureSharedSse();
  return () => {
    set?.delete(handler);
    if (set && set.size === 0) {
      sseListeners.delete(eventType);
    }
    if (totalSseSubscribers() === 0) {
      closeSharedSse();
    }
  };
}

export async function apiFetchJson<T = any>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs = 25000, body, signal: externalSignal, headers, ...rest } = options;
  const method = (rest.method || "GET").toUpperCase();
  const isIdempotentGet = method === "GET" || method === "HEAD";
  const maxAttempts = isIdempotentGet ? 3 : 2;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let onExternalAbort: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const resolvedHeaders = new Headers(headers);
  if (!resolvedHeaders.has("Accept")) {
    resolvedHeaders.set("Accept", "application/json");
  }
  if (isIdempotentGet && !resolvedHeaders.has("Cache-Control")) {
    resolvedHeaders.set("Cache-Control", "no-cache");
  }

  let preparedBody: BodyInit | undefined;
  if (body !== undefined) {
    if (
      typeof body === "string" ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof Blob
    ) {
      preparedBody = body as BodyInit;
      if (typeof body === "string" && !resolvedHeaders.has("Content-Type")) {
        resolvedHeaders.set("Content-Type", "application/json");
      }
    } else {
      preparedBody = JSON.stringify(body);
      if (!resolvedHeaders.has("Content-Type")) {
        resolvedHeaders.set("Content-Type", "application/json");
      }
    }
  }

  let forceLocalOrigin = false;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const targetUrl = buildApiUrl(path, forceLocalOrigin);
      const usingCustomExternal = !forceLocalOrigin && Boolean(getExternalBackendUrl()) && !/^https?:\/\//i.test(path);

      try {
        const response = await fetch(targetUrl, {
          ...rest,
          method,
          body: preparedBody,
          headers: resolvedHeaders,
          credentials: "include",
          signal: controller.signal,
        });

        if (response.status === 401) {
          notifyUnauthorized();
        }

        if (response.status === 429) {
          const waitMs = markApiRateLimited(parseRetryAfterMs(response));
          if (attempt < maxAttempts && waitMs <= timeoutMs * 0.6) {
            await delayMs(Math.min(waitMs, 6000), controller.signal);
            continue;
          }
          throw new ApiError(
            "Chwilowy limit zapytań proxy (HTTP 429) — odczekaj kilka sekund i ponów.",
            429
          );
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        const rawText = await response.text();

        if (looksLikeHtml(rawText) || contentType.includes("text/html")) {
          if (usingCustomExternal) {
            try {
              if (typeof window !== "undefined") {
                window.localStorage.removeItem(EXTERNAL_BACKEND_STORAGE_KEY);
              }
            } catch {}
            forceLocalOrigin = true;
            if (attempt < maxAttempts) {
              continue;
            }
          }
          if (isIdempotentGet && attempt < maxAttempts) {
            await delayMs(attempt * 1000, controller.signal);
            continue;
          }
          const hint =
            response.status === 302 || response.status === 401 || response.status === 403 || response.redirected
              ? "Przekierowanie logowania lub autoryzacji proxy"
              : `HTTP ${response.status} — endpoint zwrócił stronę HTML zamiast JSON`;
          throw new ApiError(
            `Błąd komunikacji z API (${hint}). Sprawdź adres backendu lub trasę ${path}.`,
            response.status
          );
        }

        if (
          isIdempotentGet &&
          attempt < maxAttempts &&
          (response.status === 502 || response.status === 503 || response.status === 504)
        ) {
          await delayMs(attempt * 800, controller.signal);
          continue;
        }

        if (!rawText.trim()) {
          if (response.ok) {
            resetApiRateLimit();
            return { ok: true } as unknown as T;
          }
          throw new ApiError(
            `Pusta odpowiedź serwera (HTTP ${response.status}).`,
            response.status
          );
        }

        let parsed: any;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          if (isIdempotentGet && attempt < maxAttempts) {
            await delayMs(attempt * 700, controller.signal);
            continue;
          }
          throw new ApiError(
            `Nieprawidłowy format JSON z serwera (HTTP ${response.status}).`,
            response.status
          );
        }

        if (!response.ok || (parsed && typeof parsed === "object" && parsed.ok === false)) {
          const msg =
            (parsed && typeof parsed.error === "string" && parsed.error) ||
            `Żądanie nie powiodło się (HTTP ${response.status}).`;
          throw new ApiError(msg, response.status, parsed);
        }

        resetApiRateLimit();
        return parsed as T;
      } catch (innerErr: any) {
        if (innerErr?.name === "AbortError" || controller.signal.aborted) {
          throw innerErr;
        }
        if (usingCustomExternal) {
          try {
            if (typeof window !== "undefined") {
              window.localStorage.removeItem(EXTERNAL_BACKEND_STORAGE_KEY);
            }
          } catch {}
          forceLocalOrigin = true;
          if (attempt < maxAttempts) {
            continue;
          }
        }
        if (!(innerErr instanceof ApiError) && isIdempotentGet && attempt < maxAttempts) {
          await delayMs(attempt * 700, controller.signal);
          continue;
        }
        throw innerErr;
      }
    }
    throw new ApiError("Błąd połączenia z serwerem backendu.", 0);
  } catch (err: any) {
    if (err instanceof ApiError) {
      throw err;
    }
    if (err?.name === "AbortError") {
      throw new ApiError(
        externalSignal?.aborted
          ? "Operacja została anulowana przez użytkownika."
          : `Przekroczono limit czasu połączenia (${Math.round(timeoutMs / 1000)} s).`,
        0
      );
    }
    throw new ApiError(err?.message || "Błąd połączenia z serwerem backendu.", 0);
  } finally {
    clearTimeout(timeout);
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

export async function apiFetchSafe<T = any>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<ApiResponse<T>> {
  try {
    const data = await apiFetchJson<T>(path, options);
    return { ok: true, status: 200, data };
  } catch (err: any) {
    return {
      ok: false,
      status: err instanceof ApiError ? err.status : 0,
      data: err instanceof ApiError ? (err.data as T) : undefined,
      error: err?.message || "Błąd połączenia z serwerem backendu.",
    };
  }
}
