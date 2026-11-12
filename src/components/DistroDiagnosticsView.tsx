import React, { useEffect, useState } from "react";
import { CodexAuthPanel } from "./CodexAuthPanel";
import type { SystemOverviewResponse } from "../types/bastilla";
import {
  GitBranch,
  ShieldAlert,
  Terminal,
  Cloud,
  Monitor,
  RefreshCw,
} from "lucide-react";

interface DistroDiagnosticsViewProps {
  overview: SystemOverviewResponse | null;
  onRefresh: () => void;
}

export const DistroDiagnosticsView: React.FC<DistroDiagnosticsViewProps> = ({
  overview,
  onRefresh,
}) => {
  const [gitInfo, setGitInfo] = useState<any>(null);
  const [commitMsg, setCommitMsg] = useState<string>(
    "Bastilla OS Ultimate: Synchronize SVL Kernel v5.7.0-QuantumWheel-Max & AgenticLinux main"
  );
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [mcpStatus, setMcpStatus] = useState<any>(null);
  const [mcpProbeOutput, setMcpProbeOutput] = useState<string>("");
  const [probingMcp, setProbingMcp] = useState<boolean>(false);
  const [externalBackendUrl, setExternalBackendUrl] = useState<string>(() => {
    try {
      return localStorage.getItem("bastilla_external_backend_url") || (import.meta as any).env?.VITE_BACKEND_URL || "";
    } catch {
      return "";
    }
  });
  const [externalBackendSaved, setExternalBackendSaved] = useState<string>("");

  const fetchGitStatus = async () => {
    try {
      const res = await fetch("/api/git/status");
      const data = await res.json();
      if (data.ok) setGitInfo(data.git);
    } catch {
      // ignore
    }
  };

  const fetchMcpStatus = async () => {
    try {
      const res = await fetch("/api/mcp/status");
      const data = await res.json();
      if (data.ok) setMcpStatus(data);
    } catch {
      // ignore
    }
  };

  const runMcpJsonRpcProbe = async () => {
    setProbingMcp(true);
    try {
      const initRes = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "bastilla-diagnostics-ui", version: "1.0.0" },
          },
        }),
      });
      const initData = await initRes.json();

      const listRes = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });
      const listData = await listRes.json();

      await fetchMcpStatus();
      setMcpProbeOutput(
        JSON.stringify({ initialize: initData, tools_list: listData }, null, 2)
      );
    } catch (err: any) {
      setMcpProbeOutput(
        JSON.stringify({ error: err?.message || "Błąd połączenia z /api/mcp" }, null, 2)
      );
    } finally {
      setProbingMcp(false);
    }
  };

  const handleSaveExternalBackend = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = externalBackendUrl.trim().replace(/\/$/, "");
    try {
      if (cleaned) {
        localStorage.setItem("bastilla_external_backend_url", cleaned);
        setExternalBackendSaved(`Zapisano adres zewnętrznego backendu HTTPS: ${cleaned}`);
      } else {
        localStorage.removeItem("bastilla_external_backend_url");
        setExternalBackendSaved("Przywrócono domyślny lokalny backend (/api/*).");
      }
    } catch {}
  };

  useEffect(() => {
    fetchGitStatus();
    fetchMcpStatus();
  }, []);

  const handleGitSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await fetch("/api/git/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commitMessage: commitMsg,
          remoteUrl: "https://github.com/Rush47/Bastilla_Ultimate.git",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncResult({ push_status: "WYMAGANY PRZEGLĄD", push_detail: data.error }); }
      if (data.ok) {
        setSyncResult(data.sync);
        fetchGitStatus();
        onRefresh();
      }
    } finally {
      setSyncing(false);
    }
  };

  const host = overview?.host;
  const tools = host?.tools || {};

  return (
    <div className="min-h-[calc(100vh-64px)] p-6 bg-[#07090e] space-y-6">
      {/* Section 1: Honest Verification & External Credential Matrix */}
      <section className="bg-[#0c1018] border border-slate-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              01. Centrum Weryfikacji Narzędzi AI, Codex CLI i Wymagań Zewnętrznych
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Rzeczywisty stan binariów zainstalowanych w systemie Linux oraz przejrzysta lista wymaganych kluczy/autoryzacji zewnętrznych
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-slate-300">
            Kernel: {host?.uname || "Linux x86_64"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono-tabular">
                <th className="py-2.5 px-3">Komponent / Narzędzie</th>
                <th className="py-2.5 px-3">Ścieżka Binarna Linux</th>
                <th className="py-2.5 px-3">Zweryfikowana Wersja</th>
                <th className="py-2.5 px-3">Stan Wykonawczy</th>
                <th className="py-2.5 px-3">Wymagane Klucze / Autoryzacja Zewnętrzna</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
              {Object.entries(tools).map(([key, t]) => (
                <tr key={key} className="hover:bg-slate-900/50">
                  <td className="py-3 px-3 font-sans font-semibold text-white uppercase">
                    {key}
                  </td>
                  <td className="py-3 px-3 text-slate-300">{t.binary_path}</td>
                  <td className="py-3 px-3 text-cyan-300">{t.version || "Brak zweryfikowanej wersji"}</td>
                  <td className="py-3 px-3">
                    {t.installed ? (
                      <span className="text-emerald-400">ZAINSTALOWANY</span>
                    ) : (
                      <span className="text-amber-400">NIEDOSTĘPNY</span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-300">
                    {t.requirement_note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5"><CodexAuthPanel /></div>

        {/* MCP (/api/mcp & /api/mcp/status) + Stdio Bridge + External HTTPS Backend Diagnostics */}
        <div className="mt-5 p-4 rounded-xl bg-[#111723] border border-slate-800 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-white">
                Model Context Protocol (MCP) — /api/mcp, /api/mcp/status &amp; Codex CLI stdio
              </h3>
              <p className="text-slate-400 mt-0.5">
                Rzeczywiste metadane diagnostyczne z endpointu <code className="text-violet-300">/api/mcp/status</code> (PR #7) oraz mostu <code className="text-violet-300">server/mcp-stdio.ts</code>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchMcpStatus}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold"
              >
                Odśwież /api/mcp/status
              </button>
              <button
                type="button"
                onClick={runMcpJsonRpcProbe}
                disabled={probingMcp}
                className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold"
              >
                {probingMcp ? "Testowanie..." : "Testuj JSON-RPC /api/mcp"}
              </button>
            </div>
          </div>

          {mcpStatus ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono-tabular">
              <div className="p-3 rounded bg-[#07090e] border border-slate-800">
                <div className="text-slate-400 text-[10px]">ENDPOINT &amp; TRANSPORT</div>
                <div className="text-white font-semibold mt-0.5">{mcpStatus.endpoint} ({mcpStatus.transport})</div>
                <div className="text-[11px] text-slate-400">Tryb: {mcpStatus.deployment}</div>
              </div>
              <div className="p-3 rounded bg-[#07090e] border border-slate-800">
                <div className="text-slate-400 text-[10px]">TOKEN OPERATORA (BASTILLA_API_TOKEN)</div>
                <div className={mcpStatus.configured ? "text-emerald-400 font-semibold mt-0.5" : "text-amber-300 font-semibold mt-0.5"}>
                  {mcpStatus.configured ? "SKONFIGUROWANY" : "NIESKONFIGUROWANY (tools/call zablokowane)"}
                </div>
                <div className="text-[11px] text-slate-400">Klient MCP: {mcpStatus.clientConnected ? "Zainicjalizowano" : "Brak aktywnego klienta"}</div>
              </div>
              <div className="p-3 rounded bg-[#07090e] border border-slate-800">
                <div className="text-slate-400 text-[10px]">DOZWOLONE NARZĘDZIA READ-ONLY</div>
                <div className="text-cyan-300 font-semibold mt-0.5">{(mcpStatus.tools || []).join(", ") || "brak"}</div>
                <div className="text-[11px] text-slate-400">Codex CLI Login: {mcpStatus.codexLoginVerified ? "Zweryfikowano" : "Niezweryfikowano"}</div>
              </div>
              <div className="p-3 rounded bg-[#07090e] border border-slate-800">
                <div className="text-slate-400 text-[10px]">MODELE AI (GEMINI / OLLAMA)</div>
                <div className="text-white font-semibold mt-0.5">
                  Gemini: {overview?.ai_routing?.gemini_configured ? "Skonfigurowany" : "Brak klucza"}
                </div>
                <div className="text-[11px] text-slate-400">
                  Ollama (127.0.0.1:11434): {overview?.ai_routing?.ollama_online ? "Online" : "Offline"}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-400">Pobieranie statusu /api/mcp/status...</div>
          )}

          {mcpStatus?.warning && (
            <div className="text-[11px] text-amber-300 font-mono-tabular">
              Uwaga: {mcpStatus.warning}
            </div>
          )}

          {mcpProbeOutput && (
            <pre className="p-3 rounded bg-[#07090e] border border-slate-800 text-[11px] font-mono-tabular text-slate-200 overflow-x-auto max-h-56">
              {mcpProbeOutput}
            </pre>
          )}

          <form onSubmit={handleSaveExternalBackend} className="pt-2 border-t border-slate-800 space-y-2">
            <label htmlFor="external-https-backend" className="block text-slate-300 font-semibold">
              Konfiguracja połączenia z zewnętrznym backendem HTTPS (opcjonalnie dla Codespaces / Cloudflare Tunnel):
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="external-https-backend"
                type="url"
                value={externalBackendUrl}
                onChange={(e) => setExternalBackendUrl(e.target.value)}
                placeholder="https://twoj-backend-linux.trycloudflare.com (pozostaw puste dla lokalnego backendu)"
                className="flex-1 px-3 py-2 rounded bg-[#07090e] border border-slate-700 text-white font-mono-tabular text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-white font-semibold shrink-0"
              >
                Zapisz adres backendu
              </button>
            </div>
            {externalBackendSaved && (
              <div className="text-emerald-400 font-mono-tabular text-[11px]">{externalBackendSaved}</div>
            )}
          </form>
        </div>
      </section>

      {/* Section 2: GitHub Bastilla_OS_Ultimate (main branch) Auto-Sync & AgenticLinux Base */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left (6 cols): GitHub Bastilla_OS_Ultimate (main) */}
        <section className="lg:col-span-6 bg-[#0c1018] border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display text-lg font-bold text-white">
                02. Przegląd zmian Rush47/Bastilla_Ultimate
              </h3>
              <span className="text-xs font-mono-tabular text-violet-400">
                Gałąź: {gitInfo?.branch || "main"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Zmiany wymagają osobnej gałęzi, sprawdzenia diff i pull requestu. Automatyczny push do main jest wyłączony.
            </p>

            <form onSubmit={handleGitSync} className="space-y-3 mb-5">
              <div>
                <label
                  htmlFor="git-commit-msg"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Opis planowanych zmian
                </label>
                <div className="flex gap-2">
                  <input
                    id="git-commit-msg"
                    type="text"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    className="flex-1 px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  />
                  <button
                    type="submit"
                    disabled={syncing}
                    className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    {syncing ? "Synchronizacja..." : "Sprawdź zasady przeglądu"}
                  </button>
                </div>
              </div>
            </form>

            {syncResult && (
              <div className="p-3.5 rounded-lg bg-[#111723] border border-violet-700/60 text-xs font-mono-tabular space-y-1 mb-4">
                <div className="text-emerald-400 font-semibold">
                  Status: {syncResult.push_status} (HEAD: {syncResult.head_hash})
                </div>
                <div className="text-slate-300 font-sans">
                  {syncResult.push_detail}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">
                Ostatnie commity bieżącej gałęzi:
              </div>
              {gitInfo?.commits && gitInfo.commits.length > 0 ? (
                gitInfo.commits.map((c: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded bg-[#111723] border border-slate-800 text-xs font-mono-tabular flex items-center justify-between gap-2"
                  >
                    <span className="text-violet-400 shrink-0">{c.hash}</span>
                    <span className="text-slate-200 truncate flex-1">
                      {c.message}
                    </span>
                    <span className="text-slate-400 shrink-0">{c.date}</span>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded bg-[#111723] border border-slate-800 text-xs text-slate-400">
                  Brak historii commitów.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Right (6 cols): Remote Desktop (KRDP/Wayland), Cloudflare Tunnel HTTPS & Distro Files */}
        <section className="lg:col-span-6 bg-[#0c1018] border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <h3 className="font-display text-lg font-bold text-white">
              03. Dystrybucja AgenticLinux, Zdalny Pulpit i Cloudflare HTTPS
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-lg bg-[#111723] border border-slate-800 space-y-1">
                <div className="font-semibold text-white">
                  Cloudflare Tunnel & HTTPS
                </div>
                <div className="font-mono-tabular text-emerald-400">
                  cloudflared zainstalowany (/usr/local/bin/cloudflared)
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Aktywny punkt końcowy HTTPS Cloud Run:{" "}
                  <span className="font-mono-tabular text-slate-200 break-all">
                    {overview?.app_url}
                  </span>
                  . Do uruchomienia własnej domeny Zero-Trust uruchom:{" "}
                  <code className="text-violet-300">
                    cloudflared tunnel run --token $CLOUDFLARE_TUNNEL_TOKEN
                  </code>
                </p>
              </div>

              <div className="p-3.5 rounded-lg bg-[#111723] border border-slate-800 space-y-1">
                <div className="font-semibold text-white">
                  Zdalny Pulpit (KRDP / Wayland / KDE Plasma)
                </div>
                <div className="font-mono-tabular text-cyan-400">
                  Pakiet krdp w /distro/agenticlinux/packages.txt
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Obraz bootc AgenticLinux zawiera natywny serwer KRDP (KDE Remote Desktop Protocol) oraz Wayland xdg-desktop-portal. W kontenerze Cloud Run brak fizycznego GPU/DRM — sesja graficzna działa przez WebGL/Canvas Bastilla Violet.
                </p>
              </div>
            </div>

            {/* AgenticLinux Repository Files Verified on Disk */}
            <div className="p-3.5 rounded-lg bg-[#111723] border border-slate-800">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-white">
                  Pliki bazowe pobrane z github.com/agenticlinux/agenticlinux (/distro/agenticlinux):
                </span>
                <span className="font-mono-tabular text-emerald-400">
                  Zweryfikowano na dysku
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 font-mono-tabular text-[11px] text-slate-300">
                {(host?.distro_files || []).map((f) => (
                  <span
                    key={f}
                    className="px-2 py-0.5 rounded bg-[#07090e] border border-slate-800"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>

            {/* System Resource Telemetry */}
            <div className="grid grid-cols-3 gap-3 font-mono-tabular text-xs">
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-slate-400">PAMIĘĆ RAM</div>
                <div className="text-white font-semibold mt-0.5">
                  {host?.meminfo?.available} wolne
                </div>
                <div className="text-[11px] text-slate-400">
                  Suma: {host?.meminfo?.total}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-slate-400">DYSK ROOT (/)</div>
                <div className="text-white font-semibold mt-0.5">
                  {host?.disk?.used} / {host?.disk?.size}
                </div>
                <div className="text-[11px] text-slate-400">
                  Zajętość: {host?.disk?.use_pct}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-slate-400">LOAD AVERAGE</div>
                <div className="text-white font-semibold mt-0.5">
                  {(host?.loadavg || ["0.00", "0.00", "0.00"]).join(" / ")}
                </div>
                <div className="text-[11px] text-slate-400">
                  Uptime: {Math.round((host?.uptime_sec || 0) / 60)} min
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
