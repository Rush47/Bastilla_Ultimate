import React, { useState, useEffect, useCallback } from "react";
import type { AgentId } from "../types/bastilla";
import {
  Terminal,
  Play,
  Square,
  RotateCcw,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  GitBranch,
  GitCommit,
  FileCode,
  ShieldCheck,
  FlaskConical,
} from "lucide-react";
import { apiFetchJson, buildApiUrl, isApiRateLimited } from "../utils/apiClient";

export interface CodexTask {
  id: number;
  agent_id: AgentId;
  session_id: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "error" | "cancelled";
  output: string;
  error: string;
  created_at: string;
  updated_at: string;
}

interface GitSummaryData {
  repository: string;
  branch: string;
  files: { status: string; path: string }[];
  diffStat: string;
  commits: { hash: string; author: string; date: string; message: string }[];
}

interface CodexTasksPanelProps {
  selectedAgent?: AgentId;
  onSelectAgent?: (agent: AgentId) => void;
  compact?: boolean;
}

const AGENTS: { id: AgentId; label: string; session: string }[] = [
  { id: "aria", label: "Aria", session: "codex-aria" },
  { id: "alex", label: "Alex", session: "codex-alex" },
  { id: "astyria", label: "Astyria", session: "codex-astyria" },
  { id: "aurelius", label: "Aurelius", session: "codex-aurelius" },
];

const STORAGE_AGENT_KEY = "bastilla_codex_active_agent";
const STORAGE_TASK_KEY = "bastilla_codex_active_task_id";

export function CodexTasksPanel({
  selectedAgent: propAgent,
  onSelectAgent,
  compact = false,
}: CodexTasksPanelProps) {
  const [activeAgent, setActiveAgent] = useState<AgentId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_AGENT_KEY) as AgentId | null;
      if (saved && ["aria", "alex", "astyria", "aurelius"].includes(saved)) {
        return saved;
      }
    } catch {}
    return propAgent && ["aria", "alex", "astyria", "aurelius"].includes(propAgent)
      ? propAgent
      : "aria";
  });

  useEffect(() => {
    if (propAgent && ["aria", "alex", "astyria", "aurelius"].includes(propAgent)) {
      setActiveAgent(propAgent);
    }
  }, [propAgent]);

  const handleAgentChange = (agent: AgentId) => {
    setActiveAgent(agent);
    try {
      localStorage.setItem(STORAGE_AGENT_KEY, agent);
    } catch {}
    onSelectAgent?.(agent);
  };

  const sessionId = `codex-${activeAgent}`;

  const [tasks, setTasks] = useState<CodexTask[]>([]);
  const [prompt, setPrompt] = useState<string>("");
  const [stdinInput, setStdinInput] = useState<string>("");
  const [showStdin, setShowStdin] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"queue" | "git">("queue");
  const [gitSummary, setGitSummary] = useState<GitSummaryData | null>(null);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [activeLogTaskId, setActiveLogTaskId] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_TASK_KEY);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return !isNaN(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
  const [streamingOutput, setStreamingOutput] = useState<string>("");
  const [codexStatus, setCodexStatus] = useState<{ installed: boolean; auth_ready: boolean; login_status: string; message: string } | null>(null);
  const [dispatchError, setDispatchError] = useState<string>("");

  const selectLogTask = useCallback((taskId: number | null) => {
    setActiveLogTaskId(taskId);
    try {
      if (taskId !== null) {
        localStorage.setItem(STORAGE_TASK_KEY, String(taskId));
      } else {
        localStorage.removeItem(STORAGE_TASK_KEY);
      }
    } catch {}
  }, []);

  const fetchCodexStatus = useCallback(async () => {
    try {
      const data = await apiFetchJson<any>("/api/codex/status");
      if (data.ok) {
        setCodexStatus({
          installed: Boolean(data.installed),
          auth_ready: Boolean(data.auth_ready),
          login_status: String(data.login_status || "unavailable"),
          message: String(data.message || ""),
        });
      }
    } catch {}
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await apiFetchJson<any>(
        `/api/codex/tasks?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (data.ok && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        if (data.tasks.length > 0) {
          const running = data.tasks.find((t: CodexTask) => t.status === "running");
          if (running && activeLogTaskId === null) {
            selectLogTask(running.id);
          } else if (
            activeLogTaskId !== null &&
            !data.tasks.some((t: CodexTask) => t.id === activeLogTaskId)
          ) {
            selectLogTask(data.tasks[0].id);
          } else if (activeLogTaskId === null) {
            selectLogTask(data.tasks[0].id);
          }
        }
      }
    } catch {}
  }, [sessionId, activeLogTaskId, selectLogTask]);

  const fetchGitSummary = useCallback(async () => {
    try {
      const data = await apiFetchJson<any>("/api/codex/git-summary");
      if (data.ok) {
        setGitSummary({
          repository: data.repository || "https://github.com/Rush47/Bastilla_Ultimate",
          branch: data.branch || "main",
          files: Array.isArray(data.files) ? data.files : [],
          diffStat: data.diffStat || "",
          commits: Array.isArray(data.commits) ? data.commits : [],
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCodexStatus();
    fetchTasks();
    fetchGitSummary();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (isApiRateLimited()) return;
      fetchTasks();
      if (activeTab === "git") fetchGitSummary();
    }, 15000);

    // Reconnect immediately when tab/browser regains visibility on Android/desktop
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchCodexStatus();
        fetchTasks();
        fetchGitSummary();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchCodexStatus, fetchTasks, fetchGitSummary, activeTab]);

  // SSE for active streaming task with automatic reconnect on transient disconnects
  useEffect(() => {
    if (!activeLogTaskId) {
      setSseConnected(false);
      return;
    }
    const task = tasks.find((t) => t.id === activeLogTaskId);
    if (task) {
      const combined = [task.output, task.error].filter(Boolean).join("\n");
      setStreamingOutput(combined || (task.status === "pending" ? "Zadanie oczekuje w kolejce..." : "Uruchamianie codex exec..."));
    }

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connectStream = () => {
      if (unmounted) return;
      eventSource = new EventSource(
        buildApiUrl(`/api/codex/tasks/${activeLogTaskId}/stream`)
      );
      eventSource.onopen = () => {
        if (!unmounted) setSseConnected(true);
      };
      eventSource.addEventListener("init", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data);
          const combined = [d.output, d.error].filter(Boolean).join("\n");
          if (combined) setStreamingOutput(combined);
        } catch {}
      });
      eventSource.addEventListener("data", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data);
          if (d.output !== undefined || d.error !== undefined) {
            const combined = [d.output, d.error].filter(Boolean).join("\n");
            setStreamingOutput(combined);
          }
        } catch {}
      });
      eventSource.addEventListener("complete", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data);
          if (d.output !== undefined || d.error !== undefined) {
            const combined = [d.output, d.error].filter(Boolean).join("\n");
            if (combined) setStreamingOutput(combined);
          }
          fetchTasks();
          fetchGitSummary();
        } catch {}
      });
      eventSource.onerror = () => {
        setSseConnected(false);
        eventSource?.close();
        if (!unmounted) {
          reconnectTimer = setTimeout(connectStream, 2000);
        }
      };
    };

    connectStream();

    return () => {
      unmounted = true;
      setSseConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSource?.close();
    };
  }, [activeLogTaskId, fetchTasks, fetchGitSummary]);

  const dispatchTask = async (taskPrompt: string, autoStart = true) => {
    if (!taskPrompt.trim() || submitting) return;
    setSubmitting(true);
    setDispatchError("");
    try {
      const data = await apiFetchJson<any>("/api/codex/tasks", {
        method: "POST",
        body: JSON.stringify({
          agentId: activeAgent,
          sessionId,
          prompt: taskPrompt.trim(),
          stdin: stdinInput.trim() || undefined,
          autoStart,
        }),
      });
      if (!data.ok) {
        setDispatchError(data.error || "Błąd serwera podczas zlecania zadania.");
        return;
      }
      if (data.taskId) {
        setPrompt("");
        setStdinInput("");
        selectLogTask(data.taskId);
        setActiveTab("queue");
        void fetchTasks();
      }
    } catch (err: any) {
      setDispatchError(err?.message || "Nie udało się połączyć z backendem.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatchTask(prompt, true);
  };

  const handleStart = async (taskId: number) => {
    try {
      await apiFetchJson(`/api/codex/tasks/${taskId}/start`, {
        method: "POST",
        body: "{}",
      });
      selectLogTask(taskId);
      void fetchTasks();
    } catch (err: any) {
      setDispatchError(err?.message || "Nie udało się uruchomić zadania.");
    }
  };

  const handleCancel = async (taskId: number) => {
    try {
      await apiFetchJson(`/api/codex/tasks/${taskId}/cancel`, {
        method: "POST",
        body: "{}",
      });
      void fetchTasks();
    } catch (err: any) {
      setDispatchError(err?.message || "Nie udało się anulować zadania.");
    }
  };

  const handleRetry = async (taskId: number) => {
    try {
      await apiFetchJson(`/api/codex/tasks/${taskId}/retry`, {
        method: "POST",
        body: "{}",
      });
      selectLogTask(taskId);
      void fetchTasks();
    } catch (err: any) {
      setDispatchError(err?.message || "Nie udało się ponowić zadania.");
    }
  };

  const activeTask = tasks.find((t) => t.id === activeLogTaskId);

  const getStatusBadge = (status: CodexTask["status"]) => {
    switch (status) {
      case "pending":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Oczekuje
          </span>
        );
      case "running":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" /> Uruchomione
          </span>
        );
      case "completed":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Zakończone
          </span>
        );
      case "error":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Błąd
          </span>
        );
      case "cancelled":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/20 text-slate-300 border border-slate-500/30 flex items-center gap-1">
            <Square className="w-3 h-3" /> Anulowane
          </span>
        );
    }
  };

  return (
    <div className="p-3 sm:p-4 rounded-xl bg-[#111723] border border-violet-500/40 space-y-3 text-xs font-mono-tabular">
      {/* Header & Status Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-500/20 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-white uppercase tracking-wider text-xs sm:text-sm truncate">
              Mobilny Panel Sterowania Codex CLI (`codex exec`)
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 mt-0.5">
              <span className={codexStatus?.auth_ready ? "text-emerald-400 flex items-center gap-1" : "text-amber-300 flex items-center gap-1"}>
                <ShieldCheck className="w-3 h-3" />
                {codexStatus === null
                  ? "Codex CLI: sprawdzanie statusu..."
                  : codexStatus.auth_ready
                  ? `Codex CLI: Zalogowano · Sesja: ${sessionId}`
                  : `Codex CLI: Niezalogowano (${codexStatus.login_status}) · Sesja: ${sessionId}`}
              </span>
              <span className={sseConnected ? "text-cyan-400" : "text-slate-500"}>
                · SSE: {sseConnected ? "Strumień aktywny" : "Brak aktywnego strumienia"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <a
            href="https://github.com/Rush47/Bastilla_Ultimate"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-violet-300 border border-violet-500/30 text-[10px] flex items-center gap-1"
            title="Repozytorium GitHub Bastilla_Ultimate"
          >
            <GitBranch className="w-3 h-3" /> GitHub
          </a>
          <button
            type="button"
            onClick={() => {
              fetchTasks();
              fetchGitSummary();
            }}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Odśwież
          </button>
        </div>
      </div>

      {/* 4 Isolated Agent Session Switcher + View Mode Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          {AGENTS.map((ag) => {
            const active = activeAgent === ag.id;
            return (
              <button
                key={ag.id}
                type="button"
                onClick={() => handleAgentChange(ag.id)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? "bg-violet-600 text-white shadow-sm"
                    : "bg-[#07090e] text-slate-300 border border-slate-800 hover:border-violet-500/40"
                }`}
              >
                {ag.label} <span className="text-[9px] opacity-80">({ag.session})</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 bg-[#07090e] p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab("queue")}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
              activeTab === "queue"
                ? "bg-violet-600/30 text-violet-200 border border-violet-500/50"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Kolejka i Logi ({tasks.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("git");
              fetchGitSummary();
            }}
            className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 ${
              activeTab === "git"
                ? "bg-cyan-600/30 text-cyan-200 border border-cyan-500/50"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <FileCode className="w-3 h-3" /> Zmiany, Commity i Testy
          </button>
        </div>
      </div>

      {/* Task Submission Form (codex exec) */}
      <form onSubmit={handleCreateTask} className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            aria-label="Zadanie dla Codex CLI"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`Zadanie codex exec dla sesji ${sessionId} (np. 'Sprawdź testy i git status')...`}
            className="flex-1 px-3 py-2 rounded-lg bg-[#07090e] border border-violet-500/30 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-xs"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowStdin((v) => !v)}
              className="px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] shrink-0"
              title="Dodaj strumień wejściowy stdin dla procesu codex exec"
            >
              stdin
            </button>
            <button
              type="submit"
              disabled={submitting || !prompt.trim()}
              className="flex-1 sm:flex-initial px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-1.5 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" /> Uruchom
            </button>
          </div>
        </div>

        {showStdin && (
          <textarea
            rows={2}
            value={stdinInput}
            onChange={(e) => setStdinInput(e.target.value)}
            placeholder="Opcjonalne dane wejściowe przekazywane przez standardowe wejście (stdin) do procesu codex exec..."
            className="w-full p-2 rounded-lg bg-[#07090e] border border-slate-700 text-[11px] text-slate-200 focus:outline-none focus:border-violet-500"
          />
        )}
        {dispatchError && (
          <div role="alert" className="p-2 rounded bg-rose-950/40 border border-rose-500/40 text-rose-300 text-[11px]">
            {dispatchError}
          </div>
        )}
      </form>

      {activeTab === "queue" ? (
        /* Tasks Queue & Live SSE Logs */
        <div className={`grid grid-cols-1 ${compact ? " gap-3" : "md:grid-cols-2 gap-4"}`}>
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase tracking-wide font-semibold px-1">
              <span>Kolejka sesji {sessionId} ({tasks.length})</span>
              <span>SQLite: codex_tasks</span>
            </div>
            {tasks.length === 0 ? (
              <div className="p-5 rounded-lg bg-[#07090e]/60 border border-slate-800 text-center text-slate-500">
                Brak zadań w sesji {sessionId}. Wpisz zadanie powyżej i kliknij „Uruchom”.
              </div>
            ) : (
              tasks.map((t) => (
                <div
                  key={t.id}
                  onClick={() => selectLogTask(t.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    activeLogTaskId === t.id
                      ? "bg-violet-950/30 border-violet-500 text-white shadow-lg shadow-violet-950/50"
                      : "bg-[#07090e]/80 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-violet-400 font-mono text-[11px]">
                      #{t.id} · {t.agent_id.toUpperCase()} ({t.session_id})
                    </span>
                    {getStatusBadge(t.status)}
                  </div>
                  <div className="text-slate-200 font-sans text-xs break-words mb-2">{t.prompt}</div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                    <span>{new Date(t.created_at).toLocaleTimeString()}</span>
                    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {t.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => handleStart(t.id)}
                          className="px-2 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1"
                          title="Uruchom zadanie"
                        >
                          <Play className="w-3 h-3" /> Uruchom
                        </button>
                      )}
                      {(t.status === "running" || t.status === "pending") && (
                        <button
                          type="button"
                          onClick={() => handleCancel(t.id)}
                          className="px-2 py-1 rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 flex items-center gap-1"
                          title="Anuluj zadanie"
                        >
                          <Square className="w-3 h-3" /> Anuluj
                        </button>
                      )}
                      {["completed", "error", "cancelled"].includes(t.status) && (
                        <button
                          type="button"
                          onClick={() => handleRetry(t.id)}
                          className="px-2 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 flex items-center gap-1"
                          title="Ponów zadanie"
                        >
                          <RotateCcw className="w-3 h-3" /> Ponów
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => selectLogTask(t.id)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1"
                        title="Pokaż logi"
                      >
                        <FileText className="w-3 h-3" /> Pokaż logi
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Live Logs & Output Console */}
          <div className="flex flex-col bg-[#07090e] rounded-lg border border-slate-800 p-3 h-[320px]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
              <div className="text-[11px] text-slate-300 font-semibold flex items-center gap-1.5 truncate">
                <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">
                  {activeTask
                    ? `Logi #${activeTask.id} · codex exec (${activeTask.session_id})`
                    : "Wybierz zadanie, aby zobaczyć logi"}
                </span>
              </div>
              {activeTask && getStatusBadge(activeTask.status)}
            </div>
            <div className="flex-1 overflow-y-auto font-mono text-[11px] text-slate-200 bg-[#040508] p-3 rounded border border-slate-900 whitespace-pre-wrap select-text">
              {activeTask ? (
                streamingOutput ||
                activeTask.output ||
                activeTask.error ||
                "Oczekiwanie na strumień stdout/stderr z procesu codex exec..."
              ) : (
                <span className="text-slate-500 italic">
                  Brak wybranego zadania. Kliknij „Pokaż logi” przy zadaniu w kolejce.
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* GitHub Repository, File Changes, Commits & Tests View */
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-[#07090e] border border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <GitBranch className="w-4 h-4 text-violet-400" />
              <span className="text-slate-300">Repozytorium:</span>
              <a
                href={gitSummary?.repository || "https://github.com/Rush47/Bastilla_Ultimate"}
                target="_blank"
                rel="noreferrer"
                className="text-violet-300 hover:underline font-semibold truncate"
              >
                {gitSummary?.repository || "https://github.com/Rush47/Bastilla_Ultimate"}
              </a>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                gałąź: {gitSummary?.branch || "main"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => dispatchTask("Przeprowadź audyt testów i zmian w repozytorium", true)}
                className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] flex items-center gap-1"
              >
                <FlaskConical className="w-3 h-3" /> Zleć Testy w Codex
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Modified Files & Diff Stat */}
            <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800 space-y-2 max-h-[260px] overflow-y-auto">
              <div className="text-[11px] font-semibold text-cyan-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <FileCode className="w-3.5 h-3.5" /> Zmienione pliki ({gitSummary?.files.length || 0})
                </span>
                <span className="text-[10px] text-slate-500">git status --short</span>
              </div>
              {gitSummary && gitSummary.files.length > 0 ? (
                <div className="space-y-1">
                  {gitSummary.files.map((f, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-[#0c1018] border border-slate-800/80"
                    >
                      <span className="text-slate-200 truncate">{f.path}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-bold ml-2">
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 text-[11px]">Czyste drzewo robocze lub brak zmian.</div>
              )}
              {gitSummary?.diffStat && (
                <pre className="mt-2 p-2 rounded bg-[#040508] border border-slate-900 text-[10px] text-slate-400 whitespace-pre-wrap">
                  {gitSummary.diffStat}
                </pre>
              )}
            </div>

            {/* Recent Commits */}
            <div className="p-3 rounded-lg bg-[#07090e] border border-slate-800 space-y-2 max-h-[260px] overflow-y-auto">
              <div className="text-[11px] font-semibold text-violet-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <GitCommit className="w-3.5 h-3.5" /> Ostatnie commity ({gitSummary?.commits.length || 0})
                </span>
                <span className="text-[10px] text-slate-500">git log</span>
              </div>
              {gitSummary && gitSummary.commits.length > 0 ? (
                <div className="space-y-1.5">
                  {gitSummary.commits.map((c, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#0c1018] border border-slate-800/80 text-[11px]"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                        <span className="text-violet-400 font-bold">{c.hash}</span>
                        <span>{c.date}</span>
                      </div>
                      <div className="text-slate-200 truncate">{c.message}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 text-[11px]">Brak historii commitów.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

