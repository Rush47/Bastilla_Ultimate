import React, { useState, useRef } from "react";
import ariaAvatar from "../assets/images/agent_aria_avatar_1794463014168.jpg";
import alexAvatar from "../assets/images/agent_alex_avatar_1794463014976.jpg";
import astyriaAvatar from "../assets/images/agent_astyria_avatar_1794463015211.jpg";
import aureliusAvatar from "../assets/images/agent_aurelius_avatar_1794463016020.jpg";
import wallpaper from "../assets/images/bastilla_violet_wallpaper_1794463012010.jpg";
import type { SystemOverviewResponse, WorkspaceTab, AgentId } from "../types/bastilla";
import {
  Terminal,
  MessageSquare,
  Cpu,
  Globe,
  ShieldCheck,
  Database,
  Play,
  RefreshCw,
  Hand,
  Layers,
  GitBranch,
  HardDrive,
} from "lucide-react";

export const AGENT_AVATARS: Record<AgentId, string> = {
  aria: ariaAvatar,
  alex: alexAvatar,
  astyria: astyriaAvatar,
  aurelius: aureliusAvatar,
};

const WALLPAPER_PATH = wallpaper;

interface BastillaDesktopViewProps {
  overview: SystemOverviewResponse | null;
  onNavigate: (tab: WorkspaceTab) => void;
  onSelectAgentForChat: (agentId: AgentId) => void;
  onRefresh: () => void;
}

export const BastillaDesktopView: React.FC<BastillaDesktopViewProps> = ({
  overview,
  onNavigate,
  onSelectAgentForChat,
  onRefresh,
}) => {
  const [xStartInput, setXStartInput] = useState<string>("-inf");
  const [xEndInput, setXEndInput] = useState<string>("inf");
  const [omniToken, setOmniToken] = useState<string>("364_OMNIKLUCZ_ROOT");
  const [svlOutput, setSvlOutput] = useState<string>("");
  const [runningSvl, setRunningSvl] = useState<boolean>(false);
  const [gestureLog, setGestureLog] = useState<string>(
    "Tryb dotykowy i gesty aktywne: Przesuń poziomo (Swipe) lub użyj gestu wielodotykowego na pulpicie Bastilla Violet."
  );
  const [virtualDesktopIdx, setVirtualDesktopIdx] = useState<number>(1);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const svl = overview?.svl_report;
  const host = overview?.host;

  const handleRunSvlMaxUpgrade = async () => {
    setRunningSvl(true);
    try {
      const res = await fetch("/api/svl/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xStart: xStartInput,
          xEnd: xEndInput,
          token: omniToken,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSvlOutput(data.raw_output || JSON.stringify(data.report, null, 2));
        onRefresh();
      } else {
        setSvlOutput(`Błąd wykonania SVL: ${data.error}`);
      }
    } catch (e: any) {
      setSvlOutput(`Błąd połączenia: ${e?.message || String(e)}`);
    } finally {
      setRunningSvl(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    touchStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.clientX - touchStartRef.current.x;
    const dy = e.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
      const dir = dx < 0 ? 1 : -1;
      const next = ((virtualDesktopIdx - 1 + dir + 4) % 4) + 1;
      setVirtualDesktopIdx(next);
      setGestureLog(
        `Wykryto gest poziomy (${dx < 0 ? "Swipe Left" : "Swipe Right"}, Δx=${Math.round(
          dx
        )}px) · Przełączono na Wirtualny Pulpit #${next}`
      );
    } else if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx)) {
      setGestureLog(
        `Wykryto gest pionowy (${dy < 0 ? "Overview Up" : "Show Dock"}, Δy=${Math.round(
          dy
        )}px) · Zsynchronizowano okna Wayland/Plasma`
      );
    }
  };

  const triggerSimulatedGesture = (type: string) => {
    if (type === "swipe-next") {
      const next = (virtualDesktopIdx % 4) + 1;
      setVirtualDesktopIdx(next);
      setGestureLog(`Gest 3-palcowy Swipe -> Aktywowano Wirtualny Pulpit #${next}`);
    } else if (type === "pinch-overview") {
      setGestureLog(
        "Gest Pinch-to-Overview -> Wyświetlono macierz 4 agentów Linux (Aria, Alex, Astyria, Aurelius)"
      );
    } else if (type === "edge-terminal") {
      onNavigate("terminals");
    }
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className="relative min-h-[calc(100vh-64px)] flex flex-col justify-between p-6 select-none overflow-hidden"
    >
      {/* Bastilla Violet High-Resolution Wallpaper Backdrop with Measured Scrim */}
      <div className="absolute inset-0 -z-10 bg-[#07090e]">
        <img
          src={WALLPAPER_PATH}
          alt="Bastilla Violet Geometric Desktop Wallpaper"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-35"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07090e]/85 via-[#07090e]/75 to-[#07090e]/95" />
      </div>

      {/* Top Desktop Telemetry & Touch/Gesture Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-2 font-mono-tabular">
          <span className="text-violet-400 font-semibold">
            PULPIT BASTILLA VIOLET #{virtualDesktopIdx}
          </span>
          <span aria-hidden="true">·</span>
          <span>Baza: AgenticLinux ({host?.os_release?.PRETTY_NAME || "Debian 12 / Fedora 45 bootc"})</span>
          <span aria-hidden="true">·</span>
          <span>Kernel: {svl?.System || "5.7.0-QuantumWheel-Max [DB-SYNCED]"}</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-400 font-semibold">
            Operator: {svl?.Operator || "Mateusz Mitek"} [SUPREME ROOT UID=0 / GID=0 · SYSTEM & AI ODBLOKOWANE]
          </span>
          <span aria-hidden="true">·</span>
          <span>Metryka C: {svl?.Compact_Metric_C ?? 2.5}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400 hidden sm:inline">Gesty dotykowe:</span>
          <button
            type="button"
            onClick={() => triggerSimulatedGesture("swipe-next")}
            className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700/80 hover:border-violet-500/60 text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Swipe Pulpit ({virtualDesktopIdx}/4)
          </button>
          <button
            type="button"
            onClick={() => triggerSimulatedGesture("pinch-overview")}
            className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700/80 hover:border-violet-500/60 text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Pinch Macierz
          </button>
          <button
            type="button"
            onClick={() => triggerSimulatedGesture("edge-terminal")}
            className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700/80 hover:border-violet-500/60 text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Edge Terminal Root
          </button>
        </div>
      </div>

      {/* Main Desktop Grid: Left 4 Linux AI Agents + Right SVL Core v5.7.0-QuantumWheel-Max Kernel Engine */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 my-6 items-stretch">
        {/* Left Column (7 cols): 4 Autonomous Linux AI Agents (Aria, Alex, Astyria, Aurelius) */}
        <div className="lg:col-span-7 flex flex-col justify-between bg-[#0c1018]/90 border border-slate-800 rounded-xl p-6">
          <div>
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-white tracking-tight">
                  01. Czterej Agenci Linux i Konta Systemowe (SVL Core)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Rzeczywiste konta użytkowników w /etc/passwd, izolowane procesy workerów Python i pamięć SQLite
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("agents")}
                className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Zarządzaj Workerami i IPC
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(["aria", "alex", "astyria", "aurelius"] as AgentId[]).map((agentId) => {
                const liveAgent = host?.agents_live?.find((a) => a.id === agentId);
                const svlAgent = svl?.Connected_SVL_Agents?.[agentId];
                const displayName =
                  svlAgent?.name || liveAgent?.worker_status?.display_name || agentId.toUpperCase();
                const role =
                  svlAgent?.role ||
                  liveAgent?.worker_status?.role ||
                  "Autonomous Linux Agent";
                const uid = liveAgent?.uid ?? svlAgent?.uid ?? 1001;
                const pid = liveAgent?.pid ?? 0;
                const metricC = svlAgent?.metric_c ?? 2.5;
                const compactDom = svlAgent?.compact_domain || [-1, 1];

                return (
                  <div
                    key={agentId}
                    className="flex flex-col justify-between p-4 rounded-lg bg-[#111723] border border-slate-800/90 hover:border-violet-500/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-800 shrink-0 border border-slate-700">
                          <img
                            src={AGENT_AVATARS[agentId]}
                            alt={displayName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-base font-bold text-white truncate">
                              {displayName}
                            </h3>
                            <span className="text-xs font-mono-tabular text-emerald-400">
                              {pid > 0 ? `PID ${pid}` : "READY"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-1">{role}</p>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-slate-800/80 text-xs text-slate-300 font-mono-tabular space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Konto Linux:</span>
                          <span>
                            /home/{agentId} · UID {uid}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Domena Zwarta:</span>
                          <span>
                            [{compactDom[0]}, {compactDom[1]}]
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">SVL Metryka C:</span>
                          <span className="text-violet-300 font-semibold">{metricC}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAgentForChat(agentId);
                          onNavigate("chat");
                        }}
                        className="flex-1 py-1.5 px-3 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-md transition-colors whitespace-nowrap"
                      >
                        Otwórz Czat ({displayName})
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate("terminals")}
                        className="py-1.5 px-2.5 text-xs font-mono-tabular bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors whitespace-nowrap"
                      >
                        su - {agentId}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gesture & Touch Feedback Strip */}
          <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2 truncate">
              <Hand className="w-4 h-4 text-violet-400 shrink-0" />
              <span className="truncate">{gestureLog}</span>
            </div>
            <span className="font-mono-tabular text-slate-400 shrink-0">
              SQLite Rekordy: {svl?.Database_Integration?.total_records ?? 36}
            </span>
          </div>
        </div>

        {/* Right Column (5 cols): SVLSystemKernel v5.7.0-QuantumWheel-Max & Database Upgrade Executor */}
        <div className="lg:col-span-5 flex flex-col justify-between bg-[#0c1018]/90 border border-slate-800 rounded-xl p-6">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="font-display text-xl font-bold text-white tracking-tight">
                  02. Jądro SVL Core i Baza Danych SQLite
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  TopologicalInfinityEngine (Algebra 97) · SVLProtectedVariable · Dyrektywa Maksymalna
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunSvlMaxUpgrade}
                disabled={runningSvl}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5" />
                {runningSvl ? "Wykonywanie..." : "Ulepsz System Maksymalnie"}
              </button>
            </div>

            {/* Key SVL Kernel Telemetry Readout */}
            <div className="grid grid-cols-2 gap-3 mb-4 font-mono-tabular">
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-xs text-slate-400">WERSJA JĄDRA SVL</div>
                <div className="text-sm font-bold text-white mt-0.5 truncate">
                  {svl?.System || "5.7.0-QuantumWheel-Max"}
                </div>
                <div className="text-xs text-violet-400 mt-0.5">
                  {svl?.Performance || "+1456% (Wzorzec: 364)"}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#111723] border border-slate-800">
                <div className="text-xs text-slate-400">COMPACT METRIC C</div>
                <div className="text-xl font-bold text-cyan-400 mt-0.5">
                  {svl?.Compact_Metric_C ?? 2.5}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Bufor Fouriera: {svl?.Config_Snapshot?.fourier_buffer || "0xFAAA_MAX"} · 880 Hz
                </div>
              </div>
            </div>

            {/* Interactive Topological Domain & Omnikey Inputs */}
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              <div>
                <label
                  htmlFor="svl-xstart"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Domena x_start
                </label>
                <input
                  id="svl-xstart"
                  type="text"
                  value={xStartInput}
                  onChange={(e) => setXStartInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#111723] border border-slate-700 rounded text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="svl-xend"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Domena x_end
                </label>
                <input
                  id="svl-xend"
                  type="text"
                  value={xEndInput}
                  onChange={(e) => setXEndInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#111723] border border-slate-700 rounded text-white"
                />
              </div>
              <div>
                <label
                  htmlFor="svl-token"
                  className="block text-xs text-slate-400 mb-1"
                >
                  Token Autoryzacji SVL
                </label>
                <input
                  id="svl-token"
                  type="text"
                  value={omniToken}
                  onChange={(e) => setOmniToken(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono-tabular bg-[#111723] border border-slate-700 rounded text-emerald-300"
                />
              </div>
            </div>

            {/* Live Python Execution Output of SVLSystemKernel */}
            <div className="rounded-lg bg-[#07090e] border border-slate-800 p-3 font-mono-tabular text-xs text-slate-200 max-h-56 overflow-y-auto">
              <div className="flex items-center justify-between text-slate-400 pb-2 mb-2 border-b border-slate-800">
                <span>python3 /usr/lib/bastilla/svl_kernel.py</span>
                <span className="text-emerald-400">SQLite 3.40.1 Zsynchronizowany</span>
              </div>
              <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
                {svlOutput || JSON.stringify(svl, null, 2)}
              </pre>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono-tabular">
            <span>Silnik Wizji: Ollama 11B → Fallback Gemini 3.8 Flash</span>
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Odśwież Stan
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Interactive Bastilla Violet Dock */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0c1018]/95 border border-slate-800 shadow-lg max-w-full overflow-x-auto">
          <button
            type="button"
            onClick={() => onNavigate("chat")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/40 hover:bg-violet-600/30 text-violet-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-4 h-4 text-violet-400" />
            ChatGPT Work (4 Agenci + Wizja)
          </button>
          <button
            type="button"
            onClick={() => onNavigate("terminals")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Terminal className="w-4 h-4 text-cyan-400" />
            5 Terminali (Linux/Python/AI/ELF/Agenci)
          </button>
          <button
            type="button"
            onClick={() => onNavigate("agents")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Database className="w-4 h-4 text-emerald-400" />
            Pamięć SQLite, IPC i Historia Zadań
          </button>
          <button
            type="button"
            onClick={() => onNavigate("space3d")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="w-4 h-4 text-amber-400" />
            Układ Słoneczny 3D, Flota i Hiperkomunikacja
          </button>
          <button
            type="button"
            onClick={() => onNavigate("diagnostics")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
          >
            <GitBranch className="w-4 h-4 text-violet-400" />
            Codex CLI, GitHub main i Diagnostyka
          </button>
        </div>
      </div>
    </div>
  );
};
