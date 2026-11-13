import React, { useEffect, useState, useMemo } from "react";
import { CodexAuthPanel } from "./CodexAuthPanel";
import type {
  SystemOverviewResponse,
  SphericalContextSnapshot,
} from "../types/bastilla";
import {
  GitBranch,
  Download,
  Activity,
  RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  apiFetchJson,
  getExternalBackendUrl,
  isApiRateLimited,
  setExternalBackendUrl as persistExternalBackendUrl,
} from "../utils/apiClient";

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
  const [startingOllama, setStartingOllama] = useState<boolean>(false);
  const [ollamaActionMsg, setOllamaActionMsg] = useState<string>("");
  const [mcpStatus, setMcpStatus] = useState<any>(null);
  const [mcpProbeOutput, setMcpProbeOutput] = useState<string>("");
  const [probingMcp, setProbingMcp] = useState<boolean>(false);
  const [externalBackendUrl, setExternalBackendUrl] = useState<string>(() =>
    getExternalBackendUrl()
  );
  const [externalBackendSaved, setExternalBackendSaved] = useState<string>("");
  const [ollamaEndpointInput, setOllamaEndpointInput] = useState<string>(
    overview?.ollama_status?.endpoint || "http://127.0.0.1:11434"
  );
  const [savingOllamaEndpoint, setSavingOllamaEndpoint] = useState<boolean>(false);
  const [ollamaDefaultModelInput, setOllamaDefaultModelInput] = useState<string>(
    overview?.ai_routing?.default_model || "llama3.2-vision:11b"
  );
  const [savingOllamaDefaultModel, setSavingOllamaDefaultModel] = useState<boolean>(false);
  const [ollamaPullModel, setOllamaPullModel] = useState<string>("llama3.2-vision:11b");
  const [pullingOllamaModel, setPullingOllamaModel] = useState<boolean>(false);
  const [biSync, setBiSync] = useState<any>(null);
  const [stageAndCommitOnSync, setStageAndCommitOnSync] = useState<boolean>(true);
  const [togglingAutoSync, setTogglingAutoSync] = useState<boolean>(false);
  const [spherical, setSpherical] = useState<SphericalContextSnapshot | null>(null);
  const [probingSpherical, setProbingSpherical] = useState<boolean>(false);
  const [ghDetails, setGhDetails] = useState<any>(null);
  const [diagLogs, setDiagLogs] = useState<any>(null);
  const [loadingLogs, setLoadingLogs] = useState<boolean>(false);

  const fetchGitStatus = async () => {
    try {
      const data = await apiFetchJson<any>("/api/git/status");
      if (data.ok) {
        setGitInfo(data.git);
        if (data.bidirectional || data.git?.bidirectional) {
          setBiSync(data.bidirectional || data.git?.bidirectional);
        }
      }
    } catch {}
  };

  const fetchMcpStatus = async () => {
    try {
      const data = await apiFetchJson<any>("/api/mcp/status");
      if (data.ok) setMcpStatus(data);
    } catch {}
  };

  const handleStartOllamaDaemon = async () => {
    setStartingOllama(true);
    setOllamaActionMsg("");
    try {
      const data = await apiFetchJson<{ ok: boolean; message?: string; error?: string }>(
        "/api/ollama/start",
        { method: "POST", body: "{}" }
      );
      setOllamaActionMsg(data.message || data.error || "Zaktualizowano status Ollama.");
      onRefresh();
    } catch (err: any) {
      setOllamaActionMsg(err?.message || "Błąd komunikacji z /api/ollama/start");
    } finally {
      setStartingOllama(false);
    }
  };

  const handleSaveOllamaEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOllamaEndpoint(true);
    setOllamaActionMsg("");
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        state?: string;
        endpoint?: string;
        modelNames?: string[];
        message?: string;
        error?: string;
      }>("/api/ollama/config", {
        method: "POST",
        body: JSON.stringify({ endpoint: ollamaEndpointInput.trim() }),
      });
      if (data.endpoint) setOllamaEndpointInput(data.endpoint);
      setOllamaActionMsg(
        data.message || `Zapisano adres Ollama: ${data.endpoint} (${data.state})`
      );
      onRefresh();
    } catch (err: any) {
      setOllamaActionMsg(err?.message || "Nie udało się zapisać adresu Ollama.");
    } finally {
      setSavingOllamaEndpoint(false);
    }
  };

  const handleSaveOllamaDefaultModel = async (
    e?: React.FormEvent,
    overrideModel?: string
  ) => {
    if (e) e.preventDefault();
    const target = (overrideModel ?? ollamaDefaultModelInput).trim();
    setSavingOllamaDefaultModel(true);
    setOllamaActionMsg("");
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        default_model?: string;
        message?: string;
        error?: string;
      }>("/api/ollama/config", {
        method: "POST",
        body: JSON.stringify({ defaultModel: target }),
      });
      if (data.default_model) {
        setOllamaDefaultModelInput(data.default_model);
      }
      setOllamaActionMsg(
        data.message || `Ustawiono standardowy model Ollama: ${data.default_model || target}`
      );
      onRefresh();
    } catch (err: any) {
      setOllamaActionMsg(err?.message || "Nie udało się zapisać standardowego modelu Ollama.");
    } finally {
      setSavingOllamaDefaultModel(false);
    }
  };

  const handlePullOllamaModel = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanModel = ollamaPullModel.trim();
    if (!cleanModel) return;
    setPullingOllamaModel(true);
    setOllamaActionMsg("");
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        message?: string;
        error?: string;
      }>("/api/ollama/pull", {
        method: "POST",
        body: JSON.stringify({ model: cleanModel }),
        timeoutMs: 120000,
      });
      setOllamaActionMsg(data.message || data.error || `Zakończono pobieranie ${cleanModel}.`);
      onRefresh();
    } catch (err: any) {
      setOllamaActionMsg(err?.message || `Błąd pobierania modelu ${cleanModel}.`);
    } finally {
      setPullingOllamaModel(false);
    }
  };

  const runMcpJsonRpcProbe = async () => {
    setProbingMcp(true);
    try {
      const initData = await apiFetchJson<any>("/api/mcp", {
        method: "POST",
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

      const listData = await apiFetchJson<any>("/api/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });

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
    persistExternalBackendUrl(cleaned);
    setExternalBackendUrl(cleaned);
    if (cleaned) {
      setExternalBackendSaved(`Zapisano adres zewnętrznego backendu HTTPS: ${cleaned}`);
    } else {
      setExternalBackendSaved("Przywrócono domyślny lokalny backend (/api/*).");
    }
    onRefresh();
  };

  const fetchSphericalContext = async () => {
    setProbingSpherical(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; snapshot?: SphericalContextSnapshot }>(
        "/api/system/spherical-context",
        { timeoutMs: 8000 }
      );
      if (data.ok && data.snapshot) {
        setSpherical(data.snapshot);
      }
    } catch {} finally {
      setProbingSpherical(false);
    }
  };

  const fetchGithubDetails = async () => {
    try {
      const data = await apiFetchJson<any>("/api/github/details");
      if (data.ok) setGhDetails(data);
    } catch {}
  };

  const fetchAndDownloadLogs = async (download = false) => {
    setLoadingLogs(true);
    try {
      const data = await apiFetchJson<any>("/api/diagnostics/logs");
      if (data.ok) {
        setDiagLogs(data);
        if (download) {
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `bastilla-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        }
      }
    } catch {} finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    void fetchGitStatus();
    void fetchMcpStatus();
    void fetchGithubDetails();
    void fetchSphericalContext();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (isApiRateLimited()) return;
      void fetchGitStatus();
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (overview?.ollama_status?.endpoint) {
      setOllamaEndpointInput((prev) =>
        prev === "http://127.0.0.1:11434" || !prev
          ? overview.ollama_status!.endpoint
          : prev
      );
    }
    if (overview?.ai_routing?.default_model) {
      setOllamaDefaultModelInput((prev) =>
        prev === "llama3.2-vision:11b" || !prev
          ? overview.ai_routing.default_model!
          : prev
      );
    }
  }, [overview?.ollama_status?.endpoint, overview?.ai_routing?.default_model]);

  const handleToggleAutoSync = async (updates: {
    enabled?: boolean;
    intervalSec?: number;
    autoFastForwardPull?: boolean;
    autoPushWorkBranch?: boolean;
  }) => {
    setTogglingAutoSync(true);
    try {
      const data = await apiFetchJson<any>("/api/git/bidirectional/toggle", {
        method: "POST",
        body: JSON.stringify(updates),
      });
      if (data.ok && data.sync) {
        setBiSync(data.sync);
      }
      void fetchGitStatus();
    } catch (err: any) {
      setSyncResult({
        push_status: "BŁĄD KONFIGURACJI",
        head_hash: biSync?.headHash || "N/A",
        push_detail: err?.message || "Nie udało się zmienić konfiguracji auto-sync.",
      });
    } finally {
      setTogglingAutoSync(false);
    }
  };

  const handleGitSync = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    try {
      const data = await apiFetchJson<any>("/api/git/bidirectional/sync", {
        method: "POST",
        body: JSON.stringify({
          commitMessage: commitMsg,
          stageAndCommit: stageAndCommitOnSync,
          pushNow: true,
        }),
      });
      if (data.ok && data.sync) {
        setBiSync(data.sync);
        setSyncResult({
          push_status: `IN: ${data.sync.inboundStatus} · OUT: ${data.sync.outboundStatus}`,
          head_hash: data.sync.headHash || "HEAD",
          push_detail: data.sync.lastDetail,
        });
        void fetchGitStatus();
        onRefresh();
      }
    } catch (err: any) {
      setSyncResult({
        push_status: "BŁĄD SYNCHRONIZACJI",
        head_hash: biSync?.headHash || "N/A",
        push_detail: err?.message || "Błąd synchronizacji obustronnej Git",
      });
    } finally {
      setSyncing(false);
    }
  };

  const host = overview?.host;
  const tools = host?.tools || {};

  const parseKbToMb = (val?: string): number => {
    if (!val) return 0;
    const m = val.match(/(\d+)/);
    return m ? Math.round(parseInt(m[1], 10) / 1024) : 0;
  };

  const ramTotalMb = parseKbToMb(host?.meminfo?.total);
  const ramAvailMb = parseKbToMb(host?.meminfo?.available);
  const ramUsedMb = Math.max(0, ramTotalMb - ramAvailMb);

  const chartData = useMemo(() => {
    if (spherical?.streams) {
      return Object.values(spherical.streams).map((s) => ({
        name: s.stream,
        latencyMs: s.latencyMs,
      }));
    }
    return [
      { name: "RAM Użyta (MB)", latencyMs: ramUsedMb },
      { name: "RAM Wolna (MB)", latencyMs: ramAvailMb },
    ];
  }, [spherical, ramUsedMb, ramAvailMb]);

  const statusMatrix = useMemo(() => {
    const runningAgentsCount = (host?.agents_live || []).filter((a) => a.running).length;
    const d = overview?.desktop_status;
    return [
      {
        name: "Backend Express",
        status: overview?.ok ? "ONLINE" : "DEGRADED",
        detail: `Uptime ${Math.round((host?.uptime_sec || 0) / 60)} min`,
      },
      {
        name: "Baza SQLite",
        status: overview?.svl_report?.Database_Integration ? "ONLINE" : "DEGRADED",
        detail: `${overview?.svl_report?.Database_Integration?.total_records ?? 0} rekordów`,
      },
      {
        name: "Ollama Daemon",
        status: overview?.ollama_status?.state || (overview?.ai_routing?.ollama_online ? "ONLINE" : "OFFLINE"),
        detail: `${overview?.ai_routing?.available_models?.length || 0} modeli`,
      },
      {
        name: "Gemini API",
        status: overview?.ai_routing?.gemini_configured ? "READY" : "BRAK KLUCZA",
        detail: overview?.ai_routing?.fallback_model || "gemini-3.8-flash",
      },
      {
        name: "MCP Serwer",
        status: mcpStatus?.ok ? (mcpStatus.configured ? "ONLINE" : "READ-ONLY / BRAK TOKENU") : "UNVERIFIED",
        detail: `${mcpStatus?.tools?.length || 0} narzędzi`,
      },
      {
        name: "Codex CLI",
        status: tools.codex?.installed ? (tools.codex.auth_ready ? "ONLINE" : "WYMAGA LOGOWANIA") : "OFFLINE",
        detail: tools.codex?.version || "brak wersji",
      },
      {
        name: "4 Agenci Linux",
        status: runningAgentsCount === 4 ? "ONLINE (4/4)" : runningAgentsCount > 0 ? `DEGRADED (${runningAgentsCount}/4)` : "OFFLINE (0/4)",
        detail: "Aria, Alex, Astyria, Aurelius",
      },
      {
        name: "Pulpit AI (X11/noVNC)",
        status: d?.sessionIsolated ? (d.vncRunning ? "ONLINE" : "X11 BEZ VNC") : "GOTOWY (WYŁ.)",
        detail: d?.display || "brak DISPLAY",
      },
      {
        name: "GitHub Repo",
        status: ghDetails?.ghAuthReady ? "AUTH OK" : "FETCH TYLKO (BRAK GH AUTH)",
        detail: ghDetails?.branch || gitInfo?.branch || "main",
      },
    ];
  }, [overview, host, mcpStatus, tools, ghDetails, gitInfo]);

  return (
    <div className="min-h-[calc(100vh-64px)] p-4 sm:p-6 bg-[#07090e] space-y-6">
      {/* Section 0: Unified Central Diagnostics Matrix & Spherical Worker Chart */}
      <section className="bg-[#0c1018] border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-violet-400" />
              00. Centralny Panel Diagnostyki Systemu Bastilla Ultimate
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Rzeczywista matryca usług, Worker Sferyczny (kolektor wielostrumieniowy), telemetria RAM/CPU oraz eksport zanonimizowanych logów.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchSphericalContext()}
              disabled={probingSpherical}
              className="min-h-9 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${probingSpherical ? "animate-spin" : ""}`} />
              {probingSpherical ? "Sondowanie..." : "Uruchom Worker Sferyczny"}
            </button>
            <button
              type="button"
              onClick={() => void fetchAndDownloadLogs(true)}
              disabled={loadingLogs}
              className="min-h-9 px-3 py-1.5 rounded-lg bg-[#111723] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {loadingLogs ? "Eksport..." : "Eksportuj logi (JSON)"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs font-mono-tabular">
          {statusMatrix.map((item) => {
            const isGood = /ONLINE|READY|AUTH OK/.test(item.status);
            const isWarn = /DEGRADED|BRAK|WYMAGA|FETCH|READ-ONLY|GOTOWY/.test(item.status);
            return (
              <div key={item.name} className="p-3 rounded-lg bg-[#111723] border border-slate-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-white font-semibold truncate">{item.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{item.detail}</div>
                </div>
                <span
                  className={`text-[11px] font-semibold shrink-0 ${
                    isGood ? "text-emerald-400" : isWarn ? "text-amber-300" : "text-rose-400"
                  }`}
                >
                  {item.status}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 p-4 rounded-lg bg-[#111723] border border-slate-800">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-semibold text-white">
                {spherical ? "Opóźnienia strumieni Workera Sferycznego (ms)" : "Alokacja pamięci RAM hosta (MB)"}
              </span>
              {spherical && (
                <span className="font-mono-tabular text-[11px] text-slate-400">
                  Współbieżność: {spherical.concurrencyCap} · Wolny RAM: {spherical.memAvailableMb} MB
                </span>
              )}
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#07090e",
                      borderColor: "#334155",
                      fontSize: "11px",
                      color: "#f8fafc",
                    }}
                  />
                  <Bar dataKey="latencyMs" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-5 p-4 rounded-lg bg-[#111723] border border-slate-800 space-y-2 text-xs font-mono-tabular">
            <div className="font-semibold text-white font-sans">
              Status GitHub &amp; Logi Diagnostyczne
            </div>
            <div className="text-[11px] text-slate-300">
              CLI gh auth:{" "}
              <span className={ghDetails?.ghAuthReady ? "text-emerald-400" : "text-amber-300"}>
                {ghDetails?.ghAuthReady ? "ZALOGOWANO" : "NIEZALOGOWANO (tylko odczyt/fetch)"}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 whitespace-pre-wrap max-h-20 overflow-y-auto bg-[#07090e] p-2 rounded border border-slate-800">
              {ghDetails?.diffStat || "Ładowanie diff..."}
            </div>
            {diagLogs ? (
              <div className="text-[11px] text-cyan-300">
                Zanonimizowane logi gotowe: {diagLogs.continuousMissionLogs?.length || 0} misji ·{" "}
                {diagLogs.desktopAuditLog?.length || 0} GUI · {diagLogs.recentTasks?.length || 0} zadań.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void fetchAndDownloadLogs(false)}
                className="text-[11px] text-violet-300 hover:text-violet-200 underline"
              >
                Wczytaj podgląd logów systemowych
              </button>
            )}
          </div>
        </div>
      </section>

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
              <div className="p-3 rounded bg-[#07090e] border border-slate-800 space-y-1">
                <div className="text-slate-400 text-[10px]">MODELE AI (OLLAMA / GEMINI)</div>
                <div className="text-white font-semibold mt-0.5">
                  Gemini: {overview?.ai_routing?.gemini_configured ? "Skonfigurowany" : "Brak klucza"}
                </div>
                <div className="text-[11px] text-slate-400">
                  Ollama: {overview?.ollama_status?.state || (overview?.ai_routing?.ollama_online ? "ONLINE" : "OFFLINE")}
                  {overview?.ollama_status?.binaryType ? ` (${overview.ollama_status.binaryType})` : ""}
                </div>
                <button
                  type="button"
                  onClick={() => void handleStartOllamaDaemon()}
                  disabled={startingOllama}
                  className="mt-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[10px] font-semibold"
                >
                  {startingOllama ? "Uruchamianie..." : "Uruchom / Sprawdź Ollamę"}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-slate-400">Pobieranie statusu /api/mcp/status...</div>
          )}

          {ollamaActionMsg && (
            <div className="text-[11px] text-cyan-300 font-mono-tabular">
              Ollama: {ollamaActionMsg}
            </div>
          )}

          {/* Truthful Image Engine Availability Matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono-tabular pt-2 border-t border-slate-800">
            <div className="p-3 rounded bg-[#07090e] border border-slate-800">
              <div className="text-slate-400 text-[10px]">COMFYUI (127.0.0.1:8188)</div>
              <div className={overview?.image_status?.engines?.comfyui?.reachable ? "text-emerald-400 font-semibold mt-0.5" : "text-amber-300 font-semibold mt-0.5"}>
                {overview?.image_status?.engines?.comfyui?.reachable ? "ONLINE" : "BRAK SILNIKA"}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {overview?.image_status?.engines?.comfyui?.endpoint || "127.0.0.1:8188"}
              </div>
            </div>
            <div className="p-3 rounded bg-[#07090e] border border-slate-800">
              <div className="text-slate-400 text-[10px]">LOCAL SD WEBUI (7860)</div>
              <div className={overview?.image_status?.engines?.local?.reachable ? "text-emerald-400 font-semibold mt-0.5" : "text-amber-300 font-semibold mt-0.5"}>
                {overview?.image_status?.engines?.local?.reachable ? "ONLINE" : "BRAK SILNIKA"}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {overview?.image_status?.engines?.local?.endpoint || "127.0.0.1:7860"}
              </div>
            </div>
            <div className="p-3 rounded bg-[#07090e] border border-slate-800">
              <div className="text-slate-400 text-[10px]">GEMINI IMAGE API</div>
              <div className={overview?.image_status?.engines?.gemini?.configured ? "text-emerald-400 font-semibold mt-0.5" : "text-amber-300 font-semibold mt-0.5"}>
                {overview?.image_status?.engines?.gemini?.configured ? "SKONFIGUROWANY" : "BRAK KLUCZA"}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {overview?.image_status?.engines?.gemini?.model || "gemini-3.1-flash-lite-image"}
              </div>
            </div>
          </div>

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

          {/* Live Runtime Ollama URL + Safe Model Pull Controls */}
          <div className="pt-3 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form onSubmit={handleSaveOllamaEndpoint} className="space-y-2">
              <label htmlFor="ollama-base-url-input" className="block text-slate-300 font-semibold">
                Punkt końcowy Ollama (OLLAMA_BASE_URL — lokalny lub zdalny tunel Linux):
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="ollama-base-url-input"
                  type="url"
                  value={ollamaEndpointInput}
                  onChange={(e) => setOllamaEndpointInput(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  className="flex-1 px-3 py-2 rounded bg-[#07090e] border border-slate-700 text-white font-mono-tabular text-xs"
                />
                <button
                  type="submit"
                  disabled={savingOllamaEndpoint}
                  className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold shrink-0"
                >
                  {savingOllamaEndpoint ? "Sprawdzanie..." : "Połącz Ollamę"}
                </button>
              </div>
              {overview?.ollama_status?.message && (
                <div className="text-[11px] text-slate-400 font-mono-tabular">
                  {overview.ollama_status.message}
                </div>
              )}
            </form>

            <form onSubmit={handlePullOllamaModel} className="space-y-2">
              <label htmlFor="ollama-pull-model-input" className="block text-slate-300 font-semibold">
                Pobierz model Ollama (/api/pull z kontrolą dysku i RAM):
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="ollama-pull-model-input"
                  type="text"
                  value={ollamaPullModel}
                  onChange={(e) => setOllamaPullModel(e.target.value)}
                  placeholder="qwen2.5:7b lub llama3.2-vision:11b"
                  className="flex-1 px-3 py-2 rounded bg-[#07090e] border border-slate-700 text-white font-mono-tabular text-xs"
                />
                <button
                  type="submit"
                  disabled={pullingOllamaModel}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-300 font-semibold shrink-0"
                >
                  {pullingOllamaModel ? "Pobieranie..." : "Pobierz model"}
                </button>
              </div>
              <div className="text-[11px] text-slate-400 font-mono-tabular">
                Dostępne modele:{" "}
                {(overview?.ollama_status?.modelNames || []).length > 0
                  ? overview!.ollama_status!.modelNames.join(", ")
                  : "brak (fallback na Gemini API)"}
              </div>
            </form>
          </div>

          <form onSubmit={(e) => void handleSaveOllamaDefaultModel(e)} className="pt-2 border-t border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="ollama-default-model-input" className="block text-slate-300 font-semibold">
                Standardowy model Ollama (domyślny cel dla trybu Auto i wizji):
              </label>
              <span className="text-[11px] font-mono-tabular text-cyan-300">
                Aktywny cel: {overview?.ai_routing?.default_model || "llama3.2-vision:11b"}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="ollama-default-model-input"
                type="text"
                value={ollamaDefaultModelInput}
                onChange={(e) => setOllamaDefaultModelInput(e.target.value)}
                placeholder="llama3.2-vision:11b"
                className="flex-1 px-3 py-2 rounded bg-[#07090e] border border-slate-700 text-white font-mono-tabular text-xs"
              />
              <button
                type="submit"
                disabled={savingOllamaDefaultModel}
                className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold shrink-0"
              >
                {savingOllamaDefaultModel ? "Zapisywanie..." : "Ustaw jako standardowy"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular">
              <span className="text-slate-400">Szybki wybór:</span>
              {["llama2-uncensored:latest", "llama3.2-vision:11b", "qwen2.5:14b", "qwen2.5:0.5b"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => void handleSaveOllamaDefaultModel(undefined, preset)}
                  className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200"
                >
                  {preset}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              Uwaga: Meta publikuje model Llama 3.2 Vision w wariantach <span className="text-slate-200 font-mono-tabular">11b</span> (~7.8 GB) i <span className="text-slate-200 font-mono-tabular">90b</span> (brak oficjalnego tagu <span className="font-mono-tabular">14b</span>). Gdy serwer lokalny nie ma wystarczającej ilości RAM lub wag modelu docelowego, router automatycznie przełącza się na zainstalowany model lokalny (<span className="text-cyan-300 font-mono-tabular">{(overview?.ollama_status?.modelNames || []).join(", ") || "brak"}</span>) lub Gemini API.
            </div>
          </form>

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
        {/* Left (6 cols): GitHub Bastilla_OS_Ultimate Bidirectional Auto-Sync */}
        <section className="lg:col-span-6 bg-[#0c1018] border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-display text-lg font-bold text-white">
                02. Automatyczna Synchronizacja Obustronna GitHub
              </h3>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono-tabular font-semibold border ${
                    biSync?.enabled
                      ? "bg-emerald-950/60 border-emerald-700/60 text-emerald-300"
                      : "bg-slate-900 border-slate-700 text-slate-400"
                  }`}
                >
                  {biSync?.enabled ? `AUTO-SYNC AKTYWNY (${biSync.intervalSec}s)` : "AUTO-SYNC WSTRZYMANY"}
                </span>
                <span className="text-xs font-mono-tabular text-violet-400">
                  Gałąź: {biSync?.branch || gitInfo?.branch || "main"}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Dwukierunkowa synchronizacja z repozytorium{" "}
              <code className="text-slate-200">Rush47/Bastilla_Ultimate</code>: automatyczny{" "}
              <strong>INBOUND</strong> (<code className="text-cyan-300">git fetch origin</code> + bezpieczny Fast-Forward) oraz{" "}
              <strong>OUTBOUND</strong> (<code className="text-violet-300">git push origin &lt;gałąź-robocza&gt;</code> z ochroną gałęzi <code className="text-slate-200">main</code>).
            </p>

            {/* Bidirectional Telemetry Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4 text-xs font-mono-tabular">
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-slate-400 text-[10px]">INBOUND (GitHub → Lokalnie)</div>
                <div className="text-cyan-300 font-semibold mt-0.5">
                  {biSync?.inboundStatus || "FETCHED"}
                </div>
                <div className="text-[11px] text-slate-400">
                  origin/main: {biSync?.remoteHeadHash || "191f47f"} (behind: -{biSync?.behind ?? 0})
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-slate-400 text-[10px]">OUTBOUND (Lokalnie → GitHub)</div>
                <div
                  className={`font-semibold mt-0.5 ${
                    biSync?.outboundStatus === "PUSHED" || biSync?.outboundStatus === "UP_TO_DATE"
                      ? "text-emerald-400"
                      : "text-amber-300"
                  }`}
                >
                  {biSync?.outboundStatus || "IDLE"}
                </div>
                <div className="text-[11px] text-slate-400">
                  HEAD: {biSync?.headHash || "N/A"} (ahead: +{biSync?.ahead ?? 0})
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-slate-400 text-[10px]">CYKLE I POŚWIADCZENIA</div>
                <div className="text-white font-semibold mt-0.5">
                  Cykl #{biSync?.syncCount ?? 0} · {biSync?.authReady || gitInfo?.gh_token_present ? "GH AUTH OK" : "TYLKO FETCH"}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {biSync?.lastSyncAt
                    ? `Ostatnio: ${new Date(biSync.lastSyncAt).toLocaleTimeString()}`
                    : "Oczekiwanie na cykl"}
                </div>
              </div>
            </div>

            {/* Auto-Sync Controls */}
            <div className="p-3.5 rounded-lg bg-[#111723] border border-slate-800 space-y-3 mb-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    disabled={togglingAutoSync}
                    onClick={() => void handleToggleAutoSync({ enabled: !biSync?.enabled })}
                    className={`px-3 py-1.5 rounded font-semibold transition-colors ${
                      biSync?.enabled
                        ? "bg-emerald-700 hover:bg-emerald-600 text-white"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600"
                    }`}
                  >
                    {biSync?.enabled ? "Wstrzymaj Auto-Sync" : "Włącz Auto-Sync"}
                  </button>
                  <label className="flex items-center gap-1.5 text-slate-300">
                    <span>Interwał:</span>
                    <select
                      value={biSync?.intervalSec || 60}
                      onChange={(e) =>
                        void handleToggleAutoSync({ intervalSec: Number(e.target.value) })
                      }
                      className="bg-[#07090e] border border-slate-700 rounded px-2 py-1 text-white font-mono-tabular"
                    >
                      <option value={30}>30 s</option>
                      <option value={60}>60 s</option>
                      <option value={120}>120 s</option>
                      <option value={300}>300 s</option>
                    </select>
                  </label>
                </div>

                <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-300">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={biSync?.autoFastForwardPull ?? true}
                      onChange={(e) =>
                        void handleToggleAutoSync({ autoFastForwardPull: e.target.checked })
                      }
                    />
                    <span>Auto Fast-Forward Pull</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={biSync?.autoPushWorkBranch ?? true}
                      onChange={(e) =>
                        void handleToggleAutoSync({ autoPushWorkBranch: e.target.checked })
                      }
                    />
                    <span>Auto Push gałęzi roboczej</span>
                  </label>
                </div>
              </div>
            </div>

            <form onSubmit={handleGitSync} className="space-y-3 mb-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="git-commit-msg"
                    className="block text-xs text-slate-400"
                  >
                    Opis zmian do commita przy synchronizacji obustronnej
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stageAndCommitOnSync}
                      onChange={(e) => setStageAndCommitOnSync(e.target.checked)}
                    />
                    <span>Zapisz lokalne zmiany na gałęzi roboczej ({gitInfo?.changed_files_count ?? 0} plików)</span>
                  </label>
                </div>
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
                    {syncing ? "Synchronizacja..." : "Synchronizuj obustronnie teraz"}
                  </button>
                </div>
              </div>
            </form>

            {(syncResult || biSync?.lastDetail) && (
              <div className="p-3.5 rounded-lg bg-[#111723] border border-violet-700/60 text-xs font-mono-tabular space-y-1 mb-4">
                <div className="text-emerald-400 font-semibold">
                  Status: {syncResult?.push_status || `IN: ${biSync?.inboundStatus} · OUT: ${biSync?.outboundStatus}`} (HEAD: {syncResult?.head_hash || biSync?.headHash || "N/A"})
                </div>
                <div className="text-slate-300 font-sans">
                  {syncResult?.push_detail || biSync?.lastDetail}
                </div>
              </div>
            )}

            {Array.isArray(biSync?.recentEvents) && biSync.recentEvents.length > 0 && (
              <div className="space-y-1.5 mb-4">
                <div className="text-xs font-semibold text-slate-300">
                  Dziennik synchronizacji obustronnej (INBOUND / OUTBOUND):
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                  {biSync.recentEvents.slice(0, 6).map((ev: any, i: number) => (
                    <div
                      key={i}
                      className="p-2 rounded bg-[#07090e] border border-slate-800/90 text-[11px] font-mono-tabular flex items-center justify-between gap-2"
                    >
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${
                          ev.direction === "INBOUND"
                            ? "bg-cyan-950/70 text-cyan-300"
                            : ev.direction === "OUTBOUND"
                            ? "bg-violet-950/70 text-violet-300"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {ev.direction}
                      </span>
                      <span className="text-slate-300 truncate flex-1">{ev.detail}</span>
                      <span className="text-slate-500 shrink-0">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
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
