import React, { useCallback, useEffect, useState } from "react";
import type { CodexStatus } from "../types/codex";
import { apiFetchJson } from "../utils/apiClient";

export function CodexAuthPanel() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const data = await apiFetchJson<CodexStatus & { ok: boolean; error?: string }>(
        "/api/codex/status"
      );
      if (!data.ok) throw new Error(data.error || "Nie udało się odczytać stanu Codex CLI.");
      setStatus(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Błąd połączenia z serwerem.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const pending = status?.login?.state === "starting" || status?.login?.state === "pending";
  useEffect(() => {
    if (!pending) return;
    const interval = setInterval(() => void refresh(), 2000);
    return () => clearInterval(interval);
  }, [pending, refresh]);

  const act = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      const data = await apiFetchJson<CodexStatus & { ok: boolean; error?: string }>(
        "/api/codex/auth",
        {
          method: "POST",
          body: JSON.stringify({ action }),
        }
      );
      if (!data.ok) throw new Error(data.error || "Operacja Codex CLI nie powiodła się.");
      setStatus(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Błąd połączenia z serwerem.");
    } finally { setBusy(false); }
  };

  return (
    <section aria-label="Logowanie Codex CLI" className="p-4 rounded-lg bg-[#111723] border border-violet-500/40 space-y-3 text-xs">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h3 className="font-display font-semibold text-white">OpenAI Codex CLI</h3>
        <span className={status?.auth_ready ? "text-emerald-400" : "text-amber-300"}>
          {status ? status.version || "CLI niedostępny" : "Sprawdzanie instalacji"}
        </span>
      </div>
      <p role="status" className="text-slate-300">{status?.message || "Sprawdzanie stanu logowania…"}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || pending || !status?.installed} onClick={() => void act("device_login")}
          className="px-3 py-1.5 rounded bg-violet-600 text-white disabled:opacity-50">
          Zaloguj przez ChatGPT
        </button>
        <button type="button" disabled={busy || pending || !status?.installed || !status?.api_key_configured} onClick={() => void act("use_api_key")}
          title="Korzysta z OPENAI_API_KEY skonfigurowanego w sekretach serwera"
          className="px-3 py-1.5 rounded border border-slate-600 text-slate-200 disabled:opacity-50">
          Użyj klucza z serwera
        </button>
        <button type="button" disabled={busy} onClick={() => { setError(""); void refresh(); }}
          className="px-3 py-1.5 rounded border border-slate-600 text-slate-200 disabled:opacity-50">
          Sprawdź status Codex
        </button>
        {pending && <button type="button" disabled={busy} onClick={() => void act("cancel_login")}
          className="px-3 py-1.5 rounded border border-rose-600 text-rose-300">Anuluj logowanie</button>}
      </div>
      {status && !status.api_key_configured && <p className="text-slate-400">Aby użyć klucza API, skonfiguruj OPENAI_API_KEY w sekretach serwera.</p>}
      {pending && <div className="rounded border border-violet-500/40 p-3 space-y-2 text-slate-200">
        {status?.login?.verification_url && status.login.user_code ? <>
          <a href={status.login.verification_url} target="_blank" rel="noopener noreferrer" className="text-violet-300 underline">
            Otwórz stronę logowania ChatGPT
          </a>
          <p>Wpisz kod: <strong className="font-mono text-base tracking-wider">{status.login.user_code}</strong></p>
          <p className="text-slate-400">Potwierdź logowanie w przeglądarce. Panel odświeży status automatycznie.</p>
        </> : <p>Oczekiwanie na kod logowania z Codex CLI…</p>}
      </div>}
      {status?.login && ["failed", "expired", "cancelled"].includes(status.login.state) && <p className="text-amber-300">
        {status.login.state === "expired" ? "Kod logowania wygasł. Rozpocznij logowanie ponownie." : status.login.state === "cancelled" ? "Logowanie anulowane." : "Logowanie nie powiodło się. Sprawdź dostęp do usługi i ustawienia logowania kodem urządzenia na koncie ChatGPT."}
      </p>}
      {error && <p role="alert" className="text-rose-300">{error}</p>}
    </section>
  );
}
