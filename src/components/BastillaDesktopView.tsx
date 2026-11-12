import React, { useState, useRef } from "react";
import ariaAvatar from "../assets/images/agent_aria_avatar_1794463014168.jpg";
import alexAvatar from "../assets/images/agent_alex_avatar_1794463014976.jpg";
import astyriaAvatar from "../assets/images/agent_astyria_avatar_1794463015211.jpg";
import aureliusAvatar from "../assets/images/agent_aurelius_avatar_1794463016020.jpg";
import operatorLucyAvatar from "../assets/images/operator_lucy_vault33.webp";
import wallpaper from "../assets/images/bastilla_violet_wallpaper_1794463012010.jpg";
import type {
  SystemOverviewResponse,
  WorkspaceTab,
  AgentId,
  DesktopStatusReport,
} from "../types/bastilla";
import {
  Terminal,
  MessageSquare,
  Globe,
  Database,
  Play,
  RefreshCw,
  Hand,
  GitBranch,
  Monitor,
  Camera,
  Eye,
  ShieldOff,
  Power,
} from "lucide-react";
import { apiFetchJson, buildApiUrl } from "../utils/apiClient";

export const AGENT_AVATARS: Record<AgentId, string> = {
  aria: ariaAvatar,
  alex: alexAvatar,
  astyria: astyriaAvatar,
  aurelius: aureliusAvatar,
};

export const OPERATOR_AVATAR: string = operatorLucyAvatar;

export function getAgentAvatarUrl(
  overview: SystemOverviewResponse | null | undefined,
  agentId: string
): string {
  const safeId = (["aria", "alex", "astyria", "aurelius"].includes(agentId)
    ? agentId
    : "aria") as AgentId;
  const liveUrl = overview?.host?.agents_live?.find((a) => a.id === safeId)?.avatar_url;
  if (liveUrl && liveUrl.trim().length > 0 && !liveUrl.startsWith("/avatars/")) {
    return liveUrl.trim();
  }
  return AGENT_AVATARS[safeId];
}

export function getOperatorAvatarUrl(
  overview?: SystemOverviewResponse | null
): string {
  const custom = overview?.host?.operator_avatar_url;
  if (
    custom &&
    custom.trim().length > 0 &&
    !custom.includes("operator_lucy_vault33.webp")
  ) {
    return custom.trim();
  }
  return OPERATOR_AVATAR;
}

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
  const [selectingAvatars, setSelectingAvatars] = useState<boolean>(false);
  const [gestureLog, setGestureLog] = useState<string>(
    "Tryb dotykowy i gesty aktywne: Przesuń poziomo (Swipe) lub użyj gestu wielodotykowego na pulpicie Bastilla Violet."
  );
  const [virtualDesktopIdx, setVirtualDesktopIdx] = useState<number>(1);
  const [desktopBusy, setDesktopBusy] = useState<boolean>(false);
  const [novncConnected, setNovncConnected] = useState<boolean>(false);
  const [desktopScreenshot, setDesktopScreenshot] = useState<{
    base64: string;
    mimeType: string;
    width: number;
    height: number;
    display: string;
    capturedAt: string;
    sessionId: string;
  } | null>(null);
  const [visionGoal, setVisionGoal] = useState<string>(
    "Opisz aktualny stan pulpitu Linux i otwarte okna."
  );
  const [visionResult, setVisionResult] = useState<{
    modelUsed: string;
    analysis: string;
    proposedAction?: any;
  } | null>(null);
  const [desktopNotice, setDesktopNotice] = useState<string>("");
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const svl = overview?.svl_report;
  const host = overview?.host;
  const desktop: DesktopStatusReport | undefined = overview?.desktop_status;

  const handleDesktopSession = async (action: "start" | "stop") => {
    setDesktopBusy(true);
    setDesktopNotice("");
    try {
      const res = await apiFetchJson<{ ok: boolean; status?: DesktopStatusReport; error?: string }>(
        "/api/desktop/session",
        {
          method: "POST",
          body: JSON.stringify({ action, agentId: "aria" }),
          timeoutMs: 15000,
        }
      );
      if (action === "stop") {
        setNovncConnected(false);
        setDesktopScreenshot(null);
      }
      setDesktopNotice(
        res.status?.sessionIsolated
          ? `Sesja X11 ${res.status.display} uruchomiona (noVNC ${res.status.vncRunning ? "ONLINE" : "OFFLINE"}).`
          : "Sesja X11 została zatrzymana."
      );
      onRefresh();
    } catch (e: any) {
      setDesktopNotice(`Błąd sesji pulpitu: ${e?.message || String(e)}`);
    } finally {
      setDesktopBusy(false);
    }
  };

  const handleToggleAiControl = async (enable: boolean) => {
    setDesktopBusy(true);
    setDesktopNotice("");
    try {
      const res = await apiFetchJson<{ ok: boolean; aiControlEnabled: boolean; activeAgent: string | null }>(
        "/api/desktop/control",
        {
          method: "POST",
          body: JSON.stringify({ aiControlEnabled: enable, agentId: "astyria" }),
        }
      );
      setDesktopNotice(
        res.aiControlEnabled
          ? `Sterowanie GUI aktywne dla agenta ${res.activeAgent}.`
          : "Sterowanie pulpitem przez AI zostało natychmiast zatrzymane."
      );
      onRefresh();
    } catch (e: any) {
      setDesktopNotice(`Błąd sterowania AI: ${e?.message || String(e)}`);
    } finally {
      setDesktopBusy(false);
    }
  };

  const handleCaptureDesktopScreenshot = async () => {
    setDesktopBusy(true);
    setDesktopNotice("");
    try {
      const res = await apiFetchJson<{ ok: boolean; screenshot?: any; error?: string }>(
        "/api/desktop/screenshot",
        {
          method: "POST",
          body: JSON.stringify({ agentId: "astyria" }),
        }
      );
      if (res.ok && res.screenshot) {
        setDesktopScreenshot(res.screenshot);
        setDesktopNotice(
          `Świeży zrzut ekranu: ${res.screenshot.display} (${res.screenshot.width}x${res.screenshot.height}px)`
        );
        onRefresh();
      }
    } catch (e: any) {
      setDesktopNotice(`Zrzut X11 niedostępny: ${e?.message || String(e)}`);
    } finally {
      setDesktopBusy(false);
    }
  };

  const handleRunVisionLoop = async (executeAction = false) => {
    setDesktopBusy(true);
    setDesktopNotice("");
    try {
      const res = await apiFetchJson<any>("/api/desktop/vision-analyze", {
        method: "POST",
        body: JSON.stringify({
          agentId: "astyria",
          goal: visionGoal,
          executeAction,
        }),
        timeoutMs: 45000,
      });
      if (res.ok) {
        if (res.verificationScreenshot || res.screenshot) {
          setDesktopScreenshot(res.verificationScreenshot || res.screenshot);
        }
        setVisionResult({
          modelUsed: res.modelUsed,
          analysis: res.analysis,
          proposedAction: res.proposedAction,
        });
        setDesktopNotice(`Analiza wizualna zakończona (${res.modelUsed}).`);
        onRefresh();
      }
    } catch (e: any) {
      setDesktopNotice(`Błąd analizy wizualnej: ${e?.message || String(e)}`);
    } finally {
      setDesktopBusy(false);
    }
  };

  const handleAiSelectAvatars = async () => {
    setSelectingAvatars(true);
    try {
      const res = await apiFetchJson<any>("/api/agents/avatar/ai-select", {
        method: "POST",
        body: JSON.stringify({ announceInChat: true }),
        timeoutMs: 45000,
      });
      if (res.ok) {
        setGestureLog(
          "Agenci AI (Aria, Alex, Astyria, Aurelius) wybrali nowe awatary z internetu i ogłosili swój wybór na kanale @wszyscy."
        );
        onRefresh();
      }
    } catch (e: any) {
      setGestureLog(`Błąd wyboru awatarów: ${e?.message || String(e)}`);
    } finally {
      setSelectingAvatars(false);
    }
  };

  const handleRunSvlMaxUpgrade = async () => {
    setRunningSvl(true);
    try {
      const data = await apiFetchJson<any>("/api/svl/execute", {
        method: "POST",
        body: JSON.stringify({
          xStart: xStartInput,
          xEnd: xEndInput,
          token: omniToken,
        }),
      });
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
        )}px) · Gest zarejestrowany w panelu webowym`
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
          <span>System: {host?.os_release?.PRETTY_NAME || "niezweryfikowany"}</span>
          <span aria-hidden="true">·</span>
          <span>Linux: {host?.uname || "niezweryfikowany"}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <img
              src={getOperatorAvatarUrl(overview)}
              alt="Operator Mateusz Mitek"
              referrerPolicy="no-referrer"
              className="w-5 h-5 rounded-full object-cover border border-emerald-400/70 shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = OPERATOR_AVATAR;
              }}
            />
            <span>Operator: {svl?.Operator || "Mateusz Mitek"} · uprawnienia wymagają weryfikacji</span>
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
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-white tracking-tight">
                  01. Czterej Agenci Linux i Konta Systemowe (SVL Core)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Profile agentów. Istnienie kont, heartbeat i dostęp wymagają potwierdzenia w diagnostyce.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleAiSelectAvatars}
                  disabled={selectingAvatars}
                  className="px-3 py-1.5 text-xs font-medium bg-violet-600/80 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {selectingAvatars ? "AI wybiera awatary..." : "AI: Wybierz avatary z internetu"}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate("agents")}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Zarządzaj Workerami i IPC
                </button>
              </div>
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
                const uid = liveAgent?.uid ?? "?";
                const pid = liveAgent?.pid ?? 0;
                const metricC = svlAgent?.metric_c ?? 2.5;
                const compactDom = svlAgent?.compact_domain || [-1, 1];
                const avatarSrc = getAgentAvatarUrl(overview, agentId);

                return (
                  <div
                    key={agentId}
                    className="flex flex-col justify-between p-4 rounded-lg bg-[#111723] border border-slate-800/90 hover:border-violet-500/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-800 shrink-0 border border-slate-700">
                          <img
                            src={avatarSrc}
                            alt={displayName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = AGENT_AVATARS[agentId];
                            }}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-base font-bold text-white truncate">
                              {displayName}
                            </h3>
                            <span className="text-xs font-mono-tabular text-emerald-400">
                              {liveAgent?.running ? `PID ${pid}` : "NIEPOTWIERDZONY"}
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
              SQLite Rekordy: {svl?.Database_Integration?.total_records ?? 0}
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
                  {svl?.Performance || "Brak pomiaru wydajności"}
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
            <span>Silnik AI: {overview?.ai_routing.active_engine || "niezweryfikowany"}</span>
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

      {/* Section 03: Local AI Desktop (X11, TigerVNC/x11vnc, Authenticated noVNC & Visual Loop) */}
      <section className="mb-6 bg-[#0c1018]/95 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-white flex items-center gap-2">
              <Monitor className="w-5 h-5 text-violet-400" />
              03. Lokalny Pulpit AI (X11 · x11vnc · noVNC · Analiza Wizualna)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono-tabular">
              DISPLAY: {desktop?.display || "brak"} · Rozdzielczość:{" "}
              {desktop?.resolution ? `${desktop.resolution.width}x${desktop.resolution.height}` : "N/A"} · Okno:{" "}
              {desktop?.activeWindow || "brak"} · Sesja: {desktop?.sessionIsolated ? desktop.sessionId : "nieuruchomiona"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {desktop?.sessionIsolated ? (
              <button
                type="button"
                disabled={desktopBusy}
                onClick={() => void handleDesktopSession("stop")}
                className="min-h-9 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-rose-300 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Power className="w-3.5 h-3.5" />
                Zatrzymaj sesję X11
              </button>
            ) : (
              <button
                type="button"
                disabled={desktopBusy}
                onClick={() => void handleDesktopSession("start")}
                className="min-h-9 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <Power className="w-3.5 h-3.5" />
                Uruchom sesję X11 + noVNC
              </button>
            )}

            <button
              type="button"
              disabled={!desktop?.vncRunning || !desktop?.novncUrl}
              onClick={() => setNovncConnected((v) => !v)}
              className={`min-h-9 px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap disabled:opacity-40 ${
                novncConnected
                  ? "bg-emerald-700/80 border-emerald-500 text-white"
                  : "bg-[#111723] hover:bg-slate-800 border-slate-700 text-cyan-300"
              }`}
            >
              {novncConnected ? "Rozłącz noVNC" : "Połącz noVNC"}
            </button>

            <button
              type="button"
              disabled={desktopBusy || !desktop?.x11CaptureAvailable}
              onClick={() => void handleCaptureDesktopScreenshot()}
              className="min-h-9 px-3 py-1.5 rounded-lg bg-[#111723] hover:bg-slate-800 disabled:opacity-40 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              Zrób zrzut X11
            </button>

            <button
              type="button"
              disabled={desktopBusy || !desktop?.sessionIsolated}
              onClick={() => void handleToggleAiControl(!desktop?.aiControlEnabled)}
              className={`min-h-9 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 ${
                desktop?.aiControlEnabled
                  ? "bg-rose-600 hover:bg-rose-500 text-white"
                  : "bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/60 text-amber-200"
              }`}
            >
              <ShieldOff className="w-3.5 h-3.5" />
              {desktop?.aiControlEnabled
                ? `Zatrzymaj sterowanie AI (${desktop.activeAgent || "AI"})`
                : "Włącz sterowanie AI"}
            </button>
          </div>
        </div>

        {desktopNotice && (
          <div className="px-3 py-2 rounded-lg bg-[#111723] border border-violet-700/50 text-xs font-mono-tabular text-cyan-200">
            {desktopNotice}
          </div>
        )}

        {desktop?.displayAccessError && !desktop.sessionIsolated && (
          <div className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/50 text-xs font-mono-tabular text-amber-200">
            {desktop.displayAccessError}
          </div>
        )}

        {/* Interactive Visual Loop (Etap D) + Live Preview / noVNC Stage */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={visionGoal}
                onChange={(e) => setVisionGoal(e.target.value)}
                aria-label="Cel analizy wizualnej pulpitu AI"
                placeholder="Opisz zadanie dla agenta wizualnego na pulpicie..."
                className="flex-1 min-h-10 px-3 py-1.5 rounded-lg bg-[#07090e] border border-slate-700 text-xs text-white focus:outline-none focus:border-violet-500"
              />
              <button
                type="button"
                disabled={desktopBusy || !desktop?.x11CaptureAvailable}
                onClick={() => void handleRunVisionLoop(false)}
                className="min-h-10 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5" />
                Analiza wizualna AI
              </button>
            </div>

            {novncConnected && desktop?.novncUrl ? (
              <div className="rounded-lg overflow-hidden border border-violet-500/60 bg-black aspect-[16/10] w-full">
                <iframe
                  src={buildApiUrl(desktop.novncUrl)}
                  title="Zdalny Pulpit Bastilla noVNC"
                  className="w-full h-full border-0"
                />
              </div>
            ) : desktopScreenshot ? (
              <div className="rounded-lg overflow-hidden border border-slate-700 bg-[#07090e] p-2 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-400">
                  <span>
                    Zrzut sesji {desktopScreenshot.sessionId} ({desktopScreenshot.width}x{desktopScreenshot.height})
                  </span>
                  <span>{new Date(desktopScreenshot.capturedAt).toLocaleTimeString()}</span>
                </div>
                <img
                  src={`data:${desktopScreenshot.mimeType};base64,${desktopScreenshot.base64}`}
                  alt="Aktualny zrzut pulpitu X11"
                  className="w-full max-h-80 object-contain rounded bg-black"
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-800 bg-[#07090e]/80 p-6 text-center text-xs text-slate-400 font-mono-tabular">
                Uruchom izolowaną sesję X11 (:99), aby wyświetlić pulpit w przeglądarce przez noVNC lub wykonać zrzut ekranu do analizy AI.
              </div>
            )}
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between rounded-lg bg-[#111723] border border-slate-800 p-4 space-y-3 text-xs">
            <div className="space-y-2">
              <div className="font-semibold text-white">Wynik pętli wizualnej i narzędzia GUI</div>
              <div className="grid grid-cols-2 gap-1.5 font-mono-tabular text-[11px] text-slate-300">
                <div>Xvfb: <span className={desktop?.tools?.xvfb ? "text-emerald-400" : "text-amber-400"}>{desktop?.tools?.xvfb ? "OK" : "BRAK"}</span></div>
                <div>x11vnc: <span className={desktop?.tools?.x11vnc ? "text-emerald-400" : "text-amber-400"}>{desktop?.tools?.x11vnc ? "OK" : "BRAK"}</span></div>
                <div>noVNC: <span className={desktop?.tools?.novnc ? "text-emerald-400" : "text-amber-400"}>{desktop?.tools?.novnc ? "OK" : "BRAK"}</span></div>
                <div>xdotool: <span className={desktop?.tools?.xdotool ? "text-emerald-400" : "text-amber-400"}>{desktop?.tools?.xdotool ? "OK" : "BRAK"}</span></div>
                <div>import: <span className={desktop?.tools?.import ? "text-emerald-400" : "text-amber-400"}>{desktop?.tools?.import ? "OK" : "BRAK"}</span></div>
                <div>wmctrl: <span className={desktop?.tools?.wmctrl ? "text-emerald-400" : "text-amber-400"}>{desktop?.tools?.wmctrl ? "OK" : "BRAK"}</span></div>
              </div>

              {visionResult && (
                <div className="p-2.5 rounded bg-[#07090e] border border-violet-700/40 space-y-1.5 max-h-40 overflow-y-auto">
                  <div className="text-[10px] font-mono-tabular text-violet-300">
                    Model: {visionResult.modelUsed}
                  </div>
                  <p className="text-[11px] text-slate-200 whitespace-pre-wrap">{visionResult.analysis}</p>
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-300">Dziennik operacji GUI:</div>
                <div className="max-h-32 overflow-y-auto space-y-1 font-mono-tabular text-[10px]">
                  {(desktop?.auditLog || []).length === 0 ? (
                    <div className="text-slate-500">Brak zarejestrowanych operacji pulpitu w tej sesji.</div>
                  ) : (
                    (desktop?.auditLog || []).slice(0, 6).map((entry) => (
                      <div key={entry.id} className="p-1.5 rounded bg-[#07090e] border border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-violet-300 shrink-0">{entry.agentId}</span>
                        <span className="text-slate-300 truncate flex-1">{entry.summary}</span>
                        <span className="text-slate-500 shrink-0">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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
