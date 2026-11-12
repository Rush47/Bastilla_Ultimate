import React, { useEffect, useState, useCallback } from "react";
import type {
  AgentId,
  SystemOverviewResponse,
  WorkspaceTab,
} from "./types/bastilla";
import { BastillaDesktopView } from "./components/BastillaDesktopView";
import { ChatWorkView } from "./components/ChatWorkView";
import { TerminalsView } from "./components/TerminalsView";
import { AgentsMemoryView } from "./components/AgentsMemoryView";
import { SolarSystem3DView } from "./components/SolarSystem3DView";
import { DistroDiagnosticsView } from "./components/DistroDiagnosticsView";

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("desktop");
  const [selectedChatAgent, setSelectedChatAgent] = useState<
    AgentId | "council"
  >("aria");
  const [overview, setOverview] = useState<SystemOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

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

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/system/overview");
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.ok) {
          setOverview(data);
        }
      }
    } catch (e) {
      console.error("Failed to fetch Bastilla OS overview:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchContinuousMission = useCallback(async () => {
    try {
      const res = await fetch("/api/missions/continuous/status");
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.ok) {
          setContinuousMission(data.mission);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 4000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  useEffect(() => {
    fetchContinuousMission();
    const interval = setInterval(fetchContinuousMission, 3500);
    return () => clearInterval(interval);
  }, [fetchContinuousMission]);

  const toggleMission = async () => {
    try {
      const res = await fetch("/api/missions/continuous/toggle", { method: "POST" });
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.ok) setContinuousMission(data.mission);
      }
    } catch {}
  };

  const triggerMissionCycle = async () => {
    setTriggeringCycle(true);
    try {
      const res = await fetch("/api/missions/continuous/trigger", { method: "POST" });
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.includes("application/json")) {
        const data = await res.json();
        if (data.ok) {
          setContinuousMission(data.mission);
          fetchOverview();
        }
      }
    } finally {
      setTriggeringCycle(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col">
      {/* Responsive Compact Top Bar */}
      <header className="h-12 sm:h-16 flex items-center justify-between gap-3 sm:gap-8 px-3 sm:px-6 border-b border-slate-800 bg-[#0a0d14]">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#desktop"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("desktop");
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Bastilla OS Ultimate
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Główna nawigacja systemu"
          className="flex items-center gap-6 text-sm font-medium text-slate-300 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => setActiveTab("desktop")}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
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
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
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
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
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
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
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
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === "space3d"
                ? "text-white border-violet-500"
                : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Układ 3D
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("diagnostics")}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
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
      <div className="bg-[#0b0f1a] border-b border-violet-900/40 px-3 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular">
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
            {continuousMission?.active ? "🟢 MISJA CIĄGŁA AKTYWNA" : "🟡 MISJA WSTRZYMANA"}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-violet-950/80 border border-violet-700/50 text-violet-300 text-[10px] shrink-0 font-bold">
            Cykl #{continuousMission?.cycle ?? 0}
          </span>
          <span className="text-slate-400 hidden md:inline truncate max-w-sm lg:max-w-xl text-[11px]">
            {continuousMission?.lastAction || "Samoleczenie i ulepszanie backendu i GUI (Aria, Alex, Astyria, Aurelius)"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-slate-400 hidden xl:inline">
            RAM zwolniony: <strong className="text-cyan-300">+{continuousMission?.stats?.memoryFreedMb || 0} MB</strong>
          </span>
          <button
            type="button"
            onClick={triggerMissionCycle}
            disabled={triggeringCycle}
            className="px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            <span>{triggeringCycle ? "Wykonywanie..." : "⚡ Wymuś cykl"}</span>
          </button>
          <button
            type="button"
            onClick={toggleMission}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
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
      <main className="flex-1">
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
      </main>
    </div>
  );
}
