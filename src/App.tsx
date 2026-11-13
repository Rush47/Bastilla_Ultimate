import { AgentControlView } from "./components/AgentControlView";
import React, { useEffect, useState, useCallback, useRef } from "react";
import type {
  AgentId,
  SystemOverviewResponse,
  WorkspaceTab,
} from "./types/bastilla";
import {
  BastillaDesktopView,
  OPERATOR_AVATAR,
  getOperatorAvatarUrl,
} from "./components/BastillaDesktopView";
import {
  apiFetchJson,
  ApiError,
  isApiRateLimited,
  onApiUnauthorized,
  subscribeBastillaEvent,
} from "./utils/apiClient";
import { useBastillaStore } from "./store/bastillaStore";
import {
  LayoutGrid,
  MessageSquare,
  Sliders,
  Terminal,
  Users,
  Globe,
  Activity,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from "lucide-react";

const ChatWorkView = React.lazy(() => import("./components/ChatWorkView").then(m => ({ default: m.ChatWorkView })));
const TerminalsView = React.lazy(() => import("./components/TerminalsView").then(m => ({ default: m.TerminalsView })));
const AgentsMemoryView = React.lazy(() => import("./components/AgentsMemoryView").then(m => ({ default: m.AgentsMemoryView })));
const SolarSystem3DView = React.lazy(() => import("./components/SolarSystem3DView").then(m => ({ default: m.SolarSystem3DView })));
const DistroDiagnosticsView = React.lazy(() => import("./components/DistroDiagnosticsView").then(m => ({ default: m.DistroDiagnosticsView })));

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "control", label: "Sterowanie", icon: Sliders },
  { id: "desktop", label: "Pulpit Violet", icon: LayoutGrid },
  { id: "chat", label: "ChatGPT Work", icon: MessageSquare },
  { id: "terminals", label: "Terminale", icon: Terminal },
  { id: "agents", label: "Agenci Linux", icon: Users },
  { id: "space3d", label: "Układ 3D", icon: Globe },
  { id: "diagnostics", label: "Diagnostyka i GitHub", icon: Activity },
];

export default function App() {
  const {
    activeTab,
    selectedChatAgent,
    sidebarCollapsed,
    overview,
    overviewError,
    setActiveTab,
    setSelectedChatAgent,
    toggleSidebar,
    setOverview,
    setOverviewError,
  } = useBastillaStore();

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
      innovationsAdded?: number;
      linuxAdaptations?: number;
      backendUpgrades?: number;
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
  }, [setOverview, setOverviewError]);

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
    void fetchOverview();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (isApiRateLimited()) return;
      void fetchOverview();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  useEffect(() => {
    void fetchContinuousMission();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (isApiRateLimited()) return;
      void fetchContinuousMission();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchContinuousMission]);

  useEffect(() => {
    if (needsLogin) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleOverviewRefresh = () => {
      if (isApiRateLimited()) return;
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (!isApiRateLimited()) {
          void fetchOverview();
        }
      }, 2500);
    };
    const handleMissionCycle = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        if (parsed?.mission) {
          setContinuousMission(parsed.mission);
        }
      } catch {}
      scheduleOverviewRefresh();
    };
    const handleGitSyncEvent = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        const s = parsed?.sync;
        if (s && s.branch) {
          setSyncNotice(
            `GitHub Sync (${s.branch} · +${s.ahead ?? 0}/-${s.behind ?? 0} · IN:${s.inboundStatus} OUT:${s.outboundStatus})`
          );
        }
      } catch {}
    };
    const unsubs = [
      subscribeBastillaEvent("sync", scheduleOverviewRefresh),
      subscribeBastillaEvent("git_sync", handleGitSyncEvent),
      subscribeBastillaEvent("mission_cycle", handleMissionCycle),
      subscribeBastillaEvent("image_generated", scheduleOverviewRefresh),
      subscribeBastillaEvent("desktop_status", scheduleOverviewRefresh),
      subscribeBastillaEvent("agent_task", scheduleOverviewRefresh),
    ];
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubs.forEach((fn) => fn());
    };
  }, [needsLogin, fetchOverview]);

  const toggleMission = async () => {
    try {
      const data = await apiFetchJson<{ ok: boolean; mission: any }>(
        "/api/missions/continuous/toggle",
        { method: "POST", body: "{}" }
      );
      if (data.ok) setContinuousMission(data.mission);
    } catch {}
  };

  const triggerMissionCycle = async (aiGenerate = true) => {
    setTriggeringCycle(true);
    try {
      const data = await apiFetchJson<{ ok: boolean; mission: any }>(
        aiGenerate ? "/api/missions/continuous/innovate" : "/api/missions/continuous/trigger",
        {
          method: "POST",
          body: JSON.stringify({ aiGenerate }),
          timeoutMs: 35000,
        }
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
        git_sync?: {
          ahead?: number;
          behind?: number;
          branch?: string;
          inbound_status?: string;
          outbound_status?: string;
        };
        error?: string;
      }>("/api/system/sync", { method: "POST", body: "{}", timeoutMs: 25000 });
      await Promise.all([fetchOverview(), fetchContinuousMission()]);
      if (data.ok) {
        const ahead = data.git_sync?.ahead ?? 0;
        const behind = data.git_sync?.behind ?? 0;
        const inSt = data.git_sync?.inbound_status || "FETCHED";
        const outSt = data.git_sync?.outbound_status || "IDLE";
        setSyncNotice(
          `Zsynchronizowano (${data.git_sync?.branch || "main"} · +${ahead}/-${behind} · IN:${inSt} OUT:${outSt})`
        );
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

  const ollamaOnline = Boolean(overview?.ai_routing?.ollama_online);
  const desktopIsolated = Boolean(overview?.desktop_status?.sessionIsolated);

  return (
    <div
      className={`${
        activeTab === "chat"
          ? "h-[100dvh] overflow-hidden"
          : "min-h-screen overflow-x-hidden"
      } bg-[#07090e] text-slate-100 flex flex-col lg:flex-row`}
    >
      {/* Desktop Collapsible Left Sidebar (lg+) — hidden on <lg so accessible button names stay unique */}
      <aside
        aria-label="Panel boczny Bastilla"
        className={`hidden lg:flex lg:sticky lg:top-0 lg:h-screen overflow-y-auto flex-col justify-between border-r border-slate-800/90 bg-[#0a0d14] shrink-0 transition-[width] duration-200 ${
          sidebarCollapsed ? "w-16" : "w-60"
        }`}
      >
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-800/80">
            {!sidebarCollapsed && (
              <a
                href="#desktop"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveTab("desktop");
                }}
                className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap truncate"
              >
                Bastilla OS Ultimate
              </a>
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Rozwiń menu boczne" : "Zwiń menu boczne"}
              title={sidebarCollapsed ? "Rozwiń menu boczne" : "Zwiń menu boczne"}
              className="min-h-9 min-w-9 flex items-center justify-center rounded-lg bg-[#111723] hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors shrink-0"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-violet-400" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-violet-400" />
              )}
            </button>
          </div>

          <nav aria-label="Główna nawigacja systemu" className="p-2 space-y-1">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  aria-label={label}
                  title={sidebarCollapsed ? label : undefined}
                  className={`w-full min-h-10 px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors whitespace-nowrap ${
                    sidebarCollapsed ? "justify-center" : "justify-start"
                  } ${
                    active
                      ? "bg-violet-600/20 border border-violet-500/60 text-white"
                      : "border border-transparent text-slate-400 hover:text-white hover:bg-[#111723]"
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? "text-violet-400" : "text-slate-400"}`} />
                  {!sidebarCollapsed && <span className="truncate">{label}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Operator & Compact Subsystem Telemetry */}
        <div className="p-2.5 border-t border-slate-800/80 space-y-2">
          {!sidebarCollapsed && (
            <div className="px-2 py-1.5 rounded-lg bg-[#0d121c] border border-slate-800/80 text-[11px] font-mono-tabular space-y-1">
              <div className="flex items-center justify-between text-slate-400">
                <span>Ollama</span>
                <span className={ollamaOnline ? "text-emerald-400 font-semibold" : "text-amber-300"}>
                  {overview?.ollama_status?.state || (ollamaOnline ? "ONLINE" : "OFFLINE")}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Pulpit X11</span>
                <span className={desktopIsolated ? "text-violet-300 font-semibold" : "text-slate-400"}>
                  {desktopIsolated ? overview?.desktop_status?.display || ":99" : "GOTOWY"}
                </span>
              </div>
            </div>
          )}

          <div className={`flex items-center gap-2 p-1.5 rounded-lg bg-[#111723] border border-slate-800 ${sidebarCollapsed ? "justify-center" : ""}`}>
            <img
              src={getOperatorAvatarUrl(overview)}
              alt="Operator Mateusz Mitek"
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full object-cover border border-violet-500/70 shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = OPERATOR_AVATAR;
              }}
            />
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white truncate">
                  {overview?.svl_report?.Operator || "Mateusz Mitek"}
                </div>
                <div className="text-[10px] text-slate-400 font-mono-tabular truncate">
                  SVL {overview?.svl_report?.System?.slice(0, 14) || "5.7.0"}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Mobile & Tablet Compact Header (<lg) — hidden on lg+ */}
        <header className="flex lg:hidden flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 bg-[#0a0d14] shrink-0">
          <a
            href="#desktop"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("desktop");
            }}
            className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Bastilla OS Ultimate
          </a>

          <div className="flex items-center gap-2 shrink-0">
            <img
              src={getOperatorAvatarUrl(overview)}
              alt="Operator Mateusz Mitek"
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full object-cover border border-violet-500/70 shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = OPERATOR_AVATAR;
              }}
            />
          </div>

          <nav
            aria-label="Nawigacja mobilna systemu"
            className="flex w-full min-w-0 items-center gap-3 text-xs font-medium text-slate-300 overflow-x-auto no-scrollbar"
          >
            {NAV_ITEMS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`min-h-10 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  activeTab === id
                    ? "text-white border-violet-500"
                    : "text-slate-400 border-transparent hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        {/* Continuous Autonomous Background Mission & Sync Bar */}
        <div className="bg-[#0b0f1a] border-b border-violet-900/40 px-3 sm:px-6 py-1.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5 sm:gap-2 text-xs font-mono-tabular shrink-0">
          <div className="flex items-center gap-2 min-w-0 w-full lg:w-auto lg:flex-1">
            <span
              className={`inline-block rounded-full h-2 w-2 shrink-0 ${
                continuousMission?.active ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            <span className="font-bold text-white uppercase text-[11px] tracking-wide truncate min-w-0">
              {continuousMission?.active
                ? "MISJA CIĄGŁA AI: LINUX & BACKEND"
                : "MISJA CIĄGŁA AI WSTRZYMANA"}
            </span>
            <span className="text-violet-300 text-[11px] shrink-0 whitespace-nowrap">
              · Cykl #{continuousMission?.cycle ?? 0} (+{continuousMission?.stats?.innovationsAdded ?? 0})
            </span>
            <span className="text-slate-400 hidden md:inline truncate text-[11px] min-w-0">
              · {syncNotice || continuousMission?.lastAction || "Gotowość operacyjna Bastilla OS"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleGlobalSync}
              disabled={syncing}
              className="min-h-8 sm:min-h-7 px-2.5 sm:px-3 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
              <span>{syncing ? "Synchronizacja..." : "Synchronizuj"}</span>
            </button>
            <button
              type="button"
              onClick={() => void triggerMissionCycle(true)}
              disabled={triggeringCycle}
              className="min-h-8 sm:min-h-7 px-2 sm:px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
              title="Wygeneruj i wdróż nową innowację AI dla Linuxa i backendu"
            >
              {triggeringCycle ? "Wdrażanie..." : "Wdróż Nowość AI"}
            </button>
            <button
              type="button"
              onClick={toggleMission}
              className={`min-h-8 sm:min-h-7 px-2 sm:px-2.5 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                continuousMission?.active
                  ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                  : "bg-emerald-600 hover:bg-emerald-500 text-white"
              }`}
            >
              {continuousMission?.active ? "Wstrzymaj" : "Wznów misję"}
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
          <p className={`px-3 sm:px-6 py-1.5 sm:py-2 text-xs text-amber-200 border-b border-amber-900 shrink-0 ${activeTab === "chat" ? "hidden sm:block" : ""}`}>
            Zachowano historię starszej wersji, która może zawierać dane demonstracyjne. Dostęp agentów i rzeczywiste wyniki sprawdź w zakładce Sterowanie.
          </p>
        )}
        <main className={`flex-1 min-w-0 ${activeTab === "chat" ? "min-h-0 flex flex-col overflow-hidden" : ""}`}>
          <React.Suspense fallback={<p className="p-6 text-xs text-slate-400">Ładowanie panelu…</p>}>
          {loading && !overview ? (
            <div className="p-8 max-w-5xl mx-auto space-y-4">
              <div className="h-24 rounded-xl bg-slate-900/80 border border-slate-800 animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    </div>
  );
}
