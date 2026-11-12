import { AgentControlView } from "./components/AgentControlView";
import React, { useEffect, useState, useCallback, useRef } from "react";
import type {
  AgentId,
  SystemOverviewResponse,
  WorkspaceTab,
} from "./types/bastilla";
import { BastillaDesktopView } from "./components/BastillaDesktopView";
import {
  apiFetchJson,
  ApiError,
  buildApiUrl,
  onApiUnauthorized,
} from "./utils/apiClient";
const ChatWorkView = React.lazy(() => import("./components/ChatWorkView").then(m => ({ default: m.ChatWorkView })));
const TerminalsView = React.lazy(() => import("./components/TerminalsView").then(m => ({ default: m.TerminalsView })));
const AgentsMemoryView = React.lazy(() => import("./components/AgentsMemoryView").then(m => ({ default: m.AgentsMemoryView })));
const SolarSystem3DView = React.lazy(() => import("./components/SolarSystem3DView").then(m => ({ default: m.SolarSystem3DView })));
const DistroDiagnosticsView = React.lazy(() => import("./components/DistroDiagnosticsView").then(m => ({ default: m.DistroDiagnosticsView })));

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("desktop");
  const [selectedChatAgent, setSelectedChatAgent] = useState<
    AgentId | "council"
  >("aria");
  const [overview, setOverview] = useState<SystemOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessError, setAccessError] = useState("");
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const overviewBusyRef = useRef(false);
  const overviewFailCountRef = useRef(0);
  const missionBusyRef = useRef(false);

  const [continuousMission, setContinuousMission] = useState<{
    active: boolean;
    cycle: number;
    missionId: string;
    codename: string;
    leadAgent: string;
    agents: string[];
    lastAction: string;
    stats: {
      memoryFreedMb: number;
      repairedMessages: number;
      dbIntegrityChecks: number;
      operator: string;
      version: string;
    };
  } | null>(null);
  const [triggeringCycle, setTriggeringCycle] = useState(false);

  useEffect(() => {
    return onApiUnauthorized(() => setNeedsLogin(true));
  }, []);

  const fetchOverview = useCallback(async () => {
    if (overviewBusyRef.current) return;
    overviewBusyRef.current = true;
    try {
      const data = await apiFetchJson<SystemOverviewResponse>("/api/system/overview", {
        timeoutMs: 15000,
      });
      if (data.ok) {
        setOverview(data);
        overviewFailCountRef.current = 0;
        setOverviewError(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setNeedsLogin(true);
        return;
      }
      overviewFailCountRef.current += 1;
      if (overviewFailCountRef.current >= 2) {
        setOverviewError(
          e instanceof Error ? e.message : "Chwilowy brak połączenia z backendem Bastilla OS."
        );
      }
    } finally {
      overviewBusyRef.current = false;
      setLoading(false);
    }
  }, []);

  const fetchContinuousMission = useCallback(async () => {
    if (missionBusyRef.current) return;
    missionBusyRef.current = true;
    try {
      const data = await apiFetchJson<{ ok: boolean; mission: any }>(
        "/api/missions/continuous/status",
        { timeoutMs: 8000 }
      );
      if (data.ok) {
        setContinuousMission(data.mission);
      }
    } catch {
    } finally {
      missionBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 5000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  useEffect(() => {
    fetchContinuousMission();
    const interval = setInterval(fetchContinuousMission, 4500);
    return () => clearInterval(interval);
  }, [fetchContinuousMission]);

  useEffect(() => {
    if (needsLogin || typeof EventSource === "undefined") return;
    const es = new EventSource(buildApiUrl("/api/events/stream"));
    const handleRefreshEvent = () => {
      void fetchOverview();
      void fetchContinuousMission();
    };
    es.addEventListener("sync", handleRefreshEvent);
    es.addEventListener("mission_cycle", handleRefreshEvent);
    es.addEventListener("image_generated", handleRefreshEvent);
    return () => {
      es.close();
    };
  }, [needsLogin, fetchOverview, fetchContinuousMission]);

  const toggleMission = async () => {
    try {
      const data = await apiFetchJson<{ ok: boolean; mission: any }>(
        "/api/missions/continuous/toggle",
        { method: "POST", body: "{}" }
      );
      if (data.ok) setContinuousMission(data.mission);
    } catch {}
  };

  const triggerMissionCycle = async () => {
    setTriggeringCycle(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; mission: any }>(
        "/api/missions/continuous/trigger",
        { method: "POST", body: "{}" }
      );
      if (data.ok) {
        setContinuousMission(data.mission);
        void fetchOverview();
      }
    } catch {
    } finally {
      setTriggeringCycle(false);
    }
  };

  const handleGlobalSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    try {
      const data = await apiFetchJson<{
        ok: boolean;
        git_sync?: { ahead?: number; behind?: number; branch?: string };
        error?: string;
      }>("/api/system/sync", { method: "POST", body: "{}", timeoutMs: 25000 });
      await Promise.all([fetchOverview(), fetchContinuousMission()]);
      if (data.ok) {
        const ahead = data.git_sync?.ahead ?? 0;
        const behind = data.git_sync?.behind ?? 0;
        setSyncNotice(`Zsynchronizowano (${data.git_sync?.branch || "main"} · +${ahead}/-${behind})`);
      }
    } catch (err: any) {
      setSyncNotice(err?.message || "Błąd synchronizacji");
    } finally {
      setSyncing(false);
    }
  };

  if (needsLogin) return <main className="max-w-md mx-auto p-6 space-y-4">
    <h1 className="text-xl font-bold">Dostęp do Bastilla</h1>
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      try {
        await apiFetchJson("/api/access/login", {
          method: "POST",
          body: JSON.stringify({ token: accessToken }),
        });
        setAccessToken(""); setAccessError(""); setNeedsLogin(false); void fetchOverview();
      } catch (error) { setAccessError(error instanceof Error ? error.message : "Błąd połączenia."); }
    }}>
      <label>Token panelu<input type="password" autoComplete="off" className="block w-full min-h-11 bg-slate-900 border border-slate-600 rounded px-3 mt-1" value={accessToken} onChange={e => setAccessToken(e.target.value)} required /></label>
      <button className="min-h-11 bg-violet-600 px-4 rounded">Połącz</button>
      {accessError && <p role="alert">{accessError}</p>}
    </form>
  </main>;

  return (
    <div
      className={`${
        activeTab === "chat"
          ? "h-[100dvh] overflow-hidden"
          : "min-h-screen overflow-x-hidden"
      } bg-[#07090e] text-slate-100 flex flex-col`}
    >
      {/* Responsive Compact Top Bar */}
      <header className="flex flex-wrap lg:flex-nowrap items-center justify-between gap-2 sm:gap-3 px-3 sm:px-6 py-2 border-b border-slate-800 bg-[#0a0d14] shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#desktop"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("desktop");
          }}
          className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Bastilla OS Ultimate
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Główna nawigacja systemu"
          className="order-3 lg:order-none flex w-full lg:w-auto min-w-0 items-center gap-4 sm:gap-5 text-xs sm:text-sm font-medium text-slate-300 overflow-x-auto no-scrollbar"
        >
          <button type="button" onClick={() => setActiveTab("control")} className={`min-h-11 whitespace-nowrap shrink-0 border-b-2 ${activeTab === "control" ? "border-violet-500 text-white" : "border-transparent text-slate-400"}`}>Sterowanie</button>
          <button
            type="button"
            onClick={() => setActiveTab("desktop")}
            className={`min-h-11 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === "desktop"
                ? "text-white border-violet-500"
                : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Pulpit Violet
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`min-h-11 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === "chat"
                ? "text-white border-violet-500"
                : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            ChatGPT Work
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("terminals")}
            className={`min-h-11 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === "terminals"
                ? "text-white border-violet-500"
                : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Terminale
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("agents")}
            className={`min-h-11 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === "agents"
                ? "text-white border-violet-500"
                : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Agenci Linux
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("space3d")}
            className={`min-h-11 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === "space3d"
                ? "text-white border-violet-500"
                : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Układ 3D
          </button>
        </nav>

        {/* Zone 3: Primary actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("diagnostics")}
            className={`min-h-11 px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "diagnostics"
                ? "bg-violet-500 text-white"
                : "bg-violet-600 hover:bg-violet-500 text-white"
            }`}
          >
            Diagnostyka i GitHub
          </button>
        </div>
      </header>

      {/* Continuous Autonomous Background Mission Bar (Aria, Alex, Astyria, Aurelius) */}
      <div className="bg-[#0b0f1a] border-b border-violet-900/40 px-3 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 text-xs font-mono-tabular shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {continuousMission?.active && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                continuousMission?.active ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
          </span>
          <span className="font-bold text-white uppercase text-[11px] tracking-wide shrink-0 flex items-center gap-1.5">
            {continuousMission?.active ? "KONTROLA SQLITE AKTYWNA" : "KONTROLA SQLITE WSTRZYMANA"}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-violet-950/80 border border-violet-700/50 text-violet-300 text-[10px] shrink-0 font-bold">
            Cykl #{continuousMission?.cycle ?? 0}
          </span>
          <span className="text-slate-400 hidden md:inline truncate max-w-sm lg:max-w-xl text-[11px]">
            {syncNotice || continuousMission?.lastAction || "Kontrola SQLite wykonywana przez serwer"}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          <span className="text-[10px] text-slate-400 hidden xl:inline">
            RAM zwolniony: <strong className="text-cyan-300">+{continuousMission?.stats?.memoryFreedMb || 0} MB</strong>
          </span>
          <button
            type="button"
            onClick={handleGlobalSync}
            disabled={syncing}
            className="min-h-9 sm:min-h-7 px-2.5 sm:px-3 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? "Synchronizacja..." : "Synchronizuj"}
          </button>
          <button
            type="button"
            onClick={triggerMissionCycle}
            disabled={triggeringCycle}
            className="min-h-9 sm:min-h-7 px-2 sm:px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
          >
            <span>{triggeringCycle ? "Wykonywanie..." : "Wymuś cykl"}</span>
          </button>
          <button
            type="button"
            onClick={toggleMission}
            className={`min-h-9 sm:min-h-7 px-2 sm:px-2.5 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
              continuousMission?.active
                ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }`}
          >
            {continuousMission?.active ? "Wstrzymaj" : "Wznów kontrolę"}
          </button>
        </div>
      </div>

      {/* Main Content Stage */}
      {overviewError && (
        <div role="status" className="px-3 sm:px-6 py-1.5 text-xs text-amber-200 bg-amber-950/50 border-b border-amber-800/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="truncate">{overviewError}</span>
          <button
            type="button"
            onClick={() => void fetchOverview()}
            className="px-2.5 py-0.5 rounded bg-amber-800/80 hover:bg-amber-700 text-amber-100 font-semibold shrink-0"
          >
            Ponów połączenie
          </button>
        </div>
      )}
      {overview?.host.legacy_records_unverified && (
        <p className={`px-3 sm:px-6 py-1.5 sm:py-2.5 text-xs sm:text-sm text-amber-200 border-b border-amber-900 shrink-0 ${activeTab === "chat" ? "hidden sm:block" : ""}`}>
          Zachowano historię starszej wersji, która może zawierać dane demonstracyjne. Dostęp agentów i rzeczywiste wyniki sprawdź w zakładce Sterowanie.
        </p>
      )}
      <main className={`flex-1 min-w-0 ${activeTab === "chat" ? "min-h-0 flex flex-col overflow-hidden" : ""}`}>
        <React.Suspense fallback={<p className="p-6">Ładowanie panelu…</p>}>
        {loading && !overview ? (
          <div className="p-8 max-w-5xl mx-auto space-y-4">
            <div className="h-24 rounded-xl bg-slate-900/80 border border-slate-800 animate-pulse" />
            <div className="grid grid-cols-2 gap-4">
              <div className="h-64 rounded-xl bg-slate-900/80 border border-slate-800 animate-pulse" />
              <div className="h-64 rounded-xl bg-slate-900/80 border border-slate-800 animate-pulse" />
            </div>
          </div>
        ) : (
          <>
            {activeTab === "control" && <AgentControlView />}
            {activeTab === "desktop" && (
              <BastillaDesktopView
                overview={overview}
                onNavigate={setActiveTab}
                onSelectAgentForChat={(a) => setSelectedChatAgent(a)}
                onRefresh={fetchOverview}
              />
            )}
            {activeTab === "chat" && (
              <ChatWorkView
                overview={overview}
                selectedAgent={selectedChatAgent}
                onSelectAgent={setSelectedChatAgent}
                onRefresh={fetchOverview}
              />
            )}
            {activeTab === "terminals" && (
              <TerminalsView onRefresh={fetchOverview} />
            )}
            {activeTab === "agents" && (
              <AgentsMemoryView
                overview={overview}
                onRefresh={fetchOverview}
              />
            )}
            {activeTab === "space3d" && (
              <SolarSystem3DView
                overview={overview}
                onRefresh={fetchOverview}
              />
            )}
            {activeTab === "diagnostics" && (
              <DistroDiagnosticsView
                overview={overview}
                onRefresh={fetchOverview}
              />
            )}
          </>
        )}
        </React.Suspense>
      </main>
    </div>
  );
}
