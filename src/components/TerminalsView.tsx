import React, { useState } from "react";
import type { AgentId } from "../types/bastilla";
import { Play, Sparkles, Terminal, CheckCircle2, ShieldCheck, Key } from "lucide-react";

type TerminalMode =
  | "LINUX_ROOT"
  | "PYTHON_ROOT"
  | "AI_CLI"
  | "BINARY_ELF"
  | "AGENT_USER";

interface TerminalLogEntry {
  id: number;
  mode: TerminalMode;
  agentUser: string;
  command: string;
  naturalPrompt?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timestamp: string;
}

const MODE_CONFIG: Record<
  TerminalMode,
  {
    label: string;
    subtitle: string;
    defaultCommand: string;
    nlpPlaceholder: string;
    commands: { label: string; cmd: string }[];
  }
> = {
  LINUX_ROOT: {
    label: "1. Linux Root (bash)",
    subtitle:
      "Rzeczywista powłoka root (uid=0) w systemie Linux — z obsługą poleceń językiem naturalnym (NLP)",
    defaultCommand:
      "id && uname -a && grep -E 'aria|alex|astyria|aurelius' /etc/passwd && ps -ef | grep agent_worker | grep -v grep",
    nlpPlaceholder:
      "np. 'pokaż wolne miejsce na dysku', 'sprawdź procesy workerów', 'zainstaluj pakiet htop', 'sprawdź pamięć RAM'",
    commands: [
      {
        label: "Status Kont i Workerów 4 Agentów",
        cmd: "id && grep -E 'aria|alex|astyria|aurelius' /etc/passwd && ps -ef | grep agent_worker | grep -v grep",
      },
      {
        label: "Pliki bazowe AgenticLinux (/distro/agenticlinux)",
        cmd: "ls -la /app/applet/distro/agenticlinux && head -n 25 /app/applet/distro/agenticlinux/packages.txt",
      },
      {
        label: "Zasoby Jądra (/proc/meminfo & df -h)",
        cmd: "head -n 8 /proc/meminfo && echo '---' && df -h /",
      },
    ],
  },
  PYTHON_ROOT: {
    label: "2. Python Root (SVL Kernel)",
    subtitle:
      "Natywny interpreter Python 3.10 (root) z modułem svl_kernel i bazą SQLite — z poleceniami naturalnymi",
    defaultCommand: `from svl_kernel import SVLSystemKernel\nkernel = SVLSystemKernel()\nkernel.ulepsz_system_maksymalnie("364_OMNIKLUCZ_ROOT")\nprint(kernel.generate_system_status_report())`,
    nlpPlaceholder:
      "np. 'odpal ulepszenie systemu svl_kernel', 'wypisz tabele sqlite', 'oblicz metrykę c dla [-364, 364]'",
    commands: [
      {
        label: "Uruchom SVLSystemKernel + Ulepsz System Maksymalnie",
        cmd: `from svl_kernel import SVLSystemKernel\nkernel = SVLSystemKernel()\nkernel.ulepsz_system_maksymalnie("364_OMNIKLUCZ_ROOT")\nprint(kernel.generate_system_status_report())`,
      },
      {
        label: "Sprawdź tabele bazy SQLite (/var/lib/bastilla/bastilla.db)",
        cmd: `import sqlite3\nconn = sqlite3.connect('/var/lib/bastilla/bastilla.db')\ncur = conn.cursor()\ntables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]\nprint("Tabele SQLite:", tables)\nfor t in tables:\n    print(f"  {t}: {cur.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]} rekordów")`,
      },
      {
        label: "Test TopologicalInfinityEngine [-364, 364]",
        cmd: `from svl_kernel import TopologicalInfinityEngine\neng = TopologicalInfinityEngine(-364.0, 364.0)\nprint("Compact domain:", eng.compact_start, eng.compact_end, "Metric C:", eng.calculate_metric_c())`,
      },
    ],
  },
  AI_CLI: {
    label: "3. Terminal Narzędzi CLI",
    subtitle:
      "Binaria CLI: Ollama (Qwen3.8-27B-Uncensored, Vision), OpenAI Codex CLI, GitHub CLI (gh), llmman, OpenCode, OpenClaw",
    defaultCommand:
      "ollama --version && ollama list && ollama ps && ollama show Qwen3.8-27B-Uncensored && codex --version && gh --version | head -n 1 && llmman --version && opencode --version && openclaw --version",
    nlpPlaceholder:
      "np. 'sprawdź modele ollama', 'sprawdź status logowania codex cli', 'napraw token codex cli'",
    commands: [
      {
        label: "Status Ollama (127.0.0.1:11434): Qwen3.8-27B-Uncensored + llama3.2-vision:11b",
        cmd: "ollama --version && ollama list && ollama ps && ollama show Qwen3.8-27B-Uncensored",
      },
      {
        label: "Weryfikacja OpenAI Codex CLI & usunięcie blokad tokenu",
        cmd: "rm -f /root/.codex/*.lock && codex login status",
      },
      {
        label: "Wersje wszystkich zainstalowanych binariów CLI",
        cmd: "ollama --version && codex --version && gh --version | head -n 1 && llmman --version && opencode --version && openclaw --version && cloudflared --version",
      },
      {
        label: "Status GitHub CLI i gałęzi main (Bastilla_OS_Ultimate)",
        cmd: "git status -sb && git remote -v",
      },
    ],
  },
  BINARY_ELF: {
    label: "4. Terminal Binarny / ELF Hex",
    subtitle:
      "Inspektor nagłówków ELF (readelf, ldd, file) i zrzut szesnastkowy 256B",
    defaultCommand: "/usr/local/bin/llmman.fedora45.elf",
    nlpPlaceholder:
      "np. 'zbadaj binarium codex', 'zbadaj binarium llmman.fedora45.elf', 'zbadaj bash'",
    commands: [
      {
        label: "Zbadaj binarium AgenticLinux (/usr/local/bin/llmman.fedora45.elf)",
        cmd: "/usr/local/bin/llmman.fedora45.elf",
      },
      {
        label: "Zbadaj binarium OpenAI Codex CLI (/usr/local/bin/codex)",
        cmd: "/usr/local/bin/codex",
      },
      {
        label: "Zbadaj binarium GitHub CLI (/usr/local/bin/gh)",
        cmd: "/usr/local/bin/gh",
      },
      {
        label: "Zbadaj binarium Cloudflare Tunnel (/usr/local/bin/cloudflared)",
        cmd: "/usr/local/bin/cloudflared",
      },
      {
        label: "Zbadaj binarium Python 3.10 (/usr/bin/python3.10)",
        cmd: "/usr/bin/python3.10",
      },
    ],
  },
  AGENT_USER: {
    label: "5. Terminale Agentów ROOT (runuser)",
    subtitle:
      "Wykonanie bezpośrednio na koncie Linux wybranego agenta z uprawnieniami ROOT (GID 0 + sudo UID 0)",
    defaultCommand:
      "whoami && id && sudo id && sudo whoami && cat worker_status.json",
    nlpPlaceholder:
      "np. 'sprawdź moje id i uprawnienia sudo', 'pokaż inbox.jsonl', 'pokaż zawartość memory.json'",
    commands: [
      {
        label: "Weryfikacja Uprawnień ROOT (id & sudo id) i worker_status.json",
        cmd: "whoami && id && sudo id && sudo whoami && cat worker_status.json",
      },
      {
        label: "Sprawdź pamięć lokalną agenta (memory.json)",
        cmd: "cat memory.json",
      },
      {
        label: "Sprawdź skrzynkę odbiorczą IPC (inbox.jsonl)",
        cmd: "cat inbox.jsonl || true",
      },
    ],
  },
};

interface TerminalsViewProps {
  onRefresh: () => void;
}

export const TerminalsView: React.FC<TerminalsViewProps> = ({ onRefresh }) => {
  const [mode, setMode] = useState<TerminalMode>("LINUX_ROOT");
  const [agentUser, setAgentUser] = useState<AgentId>("astyria");
  const [command, setCommand] = useState<string>(
    MODE_CONFIG.LINUX_ROOT.defaultCommand
  );
  const [naturalPrompt, setNaturalPrompt] = useState<string>("");
  const [translatingNlp, setTranslatingNlp] = useState<boolean>(false);
  const [running, setRunning] = useState<boolean>(false);
  const [codexFixing, setCodexFixing] = useState<boolean>(false);
  const [codexNotice, setCodexNotice] = useState<string | null>(null);
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);

  const handleModeSwitch = (newMode: TerminalMode) => {
    setMode(newMode);
    setCommand(MODE_CONFIG[newMode].defaultCommand);
    setNaturalPrompt("");
  };

  const executeTerminalCommand = async (cmdOverride?: string) => {
    const targetCmd = cmdOverride ?? command;
    if (!targetCmd.trim()) return;
    setRunning(true);
    try {
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          command: targetCmd,
          agentUser,
        }),
      });
      const data = await res.json();
      const entry: TerminalLogEntry = {
        id: Date.now(),
        mode,
        agentUser: mode === "AGENT_USER" ? agentUser : "root",
        command: targetCmd,
        stdout: data.stdout || "",
        stderr: data.stderr || data.error || "",
        exitCode: data.exitCode ?? (data.ok ? 0 : 1),
        timestamp: new Date().toLocaleTimeString(),
      };
      setLogs((prev) => [entry, ...prev]);
      onRefresh();
    } finally {
      setRunning(false);
    }
  };

  const handleExecuteNaturalLanguage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = naturalPrompt.trim();
    if (!trimmed) return;
    setTranslatingNlp(true);
    try {
      const res = await fetch("/api/terminal/nlp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          mode,
          agentUser,
          autoExecute: true,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCommand(data.generatedCommand);
        const entry: TerminalLogEntry = {
          id: Date.now(),
          mode,
          agentUser: mode === "AGENT_USER" ? agentUser : "root",
          naturalPrompt: trimmed,
          command: data.generatedCommand,
          stdout: data.stdout || "",
          stderr: data.stderr || "",
          exitCode: data.exitCode ?? 0,
          timestamp: new Date().toLocaleTimeString(),
        };
        setLogs((prev) => [entry, ...prev]);
        setNaturalPrompt("");
        onRefresh();
      }
    } finally {
      setTranslatingNlp(false);
    }
  };

  const handleFixCodexToken = async () => {
    setCodexFixing(true);
    setCodexNotice(null);
    try {
      const res = await fetch("/api/codex/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_token",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCodexNotice(
          `Naprawiono token Codex CLI: ${data.message} (${data.token_type})`
        );
        onRefresh();
      } else {
        setCodexNotice(`Błąd naprawy tokenu Codex: ${data.error}`);
      }
    } catch (e: any) {
      setCodexNotice(`Błąd połączenia: ${e?.message || e}`);
    } finally {
      setCodexFixing(false);
    }
  };

  const currentCfg = MODE_CONFIG[mode];

  return (
    <div className="min-h-[calc(100vh-64px)] p-4 sm:p-6 bg-[#07090e] flex flex-col gap-4">
      {/* Mode Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0c1018] border border-slate-800 rounded-xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
          {(Object.keys(MODE_CONFIG) as TerminalMode[]).map((mKey) => (
            <button
              key={mKey}
              type="button"
              onClick={() => handleModeSwitch(mKey)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mode === mKey
                  ? "bg-violet-600 text-white"
                  : "bg-[#111723] text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {MODE_CONFIG[mKey].label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === "AGENT_USER" && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">Agent:</span>
              {(["aria", "alex", "astyria", "aurelius"] as AgentId[]).map(
                (a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAgentUser(a)}
                    className={`px-2 py-1 rounded text-[11px] font-mono-tabular uppercase transition-colors ${
                      agentUser === a
                        ? "bg-cyan-600 text-white"
                        : "bg-slate-900 text-slate-300 border border-slate-700"
                    }`}
                  >
                    {a}
                  </button>
                )
              )}
            </div>
          )}

          <button
            type="button"
            onClick={handleFixCodexToken}
            disabled={codexFixing}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 text-xs font-mono-tabular flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            title="Usuń uszkodzone blokady i wygeneruj poprawny token OpenAI Codex CLI"
          >
            <Key className="w-3.5 h-3.5" />
            {codexFixing ? "Naprawianie..." : "Napraw Token Codex CLI"}
          </button>
        </div>
      </div>

      {codexNotice && (
        <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-700/60 text-xs text-emerald-200 font-mono-tabular flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{codexNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setCodexNotice(null)}
            className="text-emerald-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Terminal Console & Direct Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 flex-1">
        {/* Left Commands Column (4 cols) */}
        <div className="lg:col-span-4 bg-[#0c1018] border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-white">
              {currentCfg.label}
            </h2>
            <p className="text-xs text-slate-400 mt-1 mb-3">
              {currentCfg.subtitle}
            </p>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 mb-1">
                Szybkie polecenia Linux / Python / CLI:
              </div>
              {currentCfg.commands.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setCommand(item.cmd);
                    executeTerminalCommand(item.cmd);
                  }}
                  className="w-full text-left p-2.5 rounded-lg bg-[#111723] hover:bg-slate-800/90 border border-slate-800 hover:border-violet-500/40 transition-colors"
                >
                  <div className="text-xs font-semibold text-white">
                    {item.label}
                  </div>
                  <div className="text-[11px] font-mono-tabular text-slate-400 truncate mt-0.5">
                    {item.cmd}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 font-mono-tabular space-y-1">
            <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              Polecenia językiem naturalnym (NLP): WŁĄCZONE
            </div>
            <div>
              Kontekst:{" "}
              {mode === "AGENT_USER"
                ? `runuser -u ${agentUser} (sudo UID 0)`
                : "root (uid=0 / gid=0)"}
            </div>
            <div>Baza SQLite: /var/lib/bastilla/bastilla.db (task_history)</div>
          </div>
        </div>

        {/* Right Command Input & Output Stream (8 cols) */}
        <div className="lg:col-span-8 bg-[#0c1018] border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-3">
          {/* Natural Language Command Bar */}
          <form
            onSubmit={handleExecuteNaturalLanguage}
            className="p-3 rounded-lg bg-[#111723] border border-violet-500/50 space-y-2"
          >
            <div className="flex items-center justify-between text-xs font-medium text-violet-300">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                Polecenie językiem naturalnym (NLP &rarr; Linux/Python/CLI):
              </span>
              <span className="text-[11px] text-slate-400 font-mono-tabular">
                Automatyczne tłumaczenie i wykonanie
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                aria-label="Polecenie w języku naturalnym"
                placeholder={currentCfg.nlpPlaceholder}
                value={naturalPrompt}
                onChange={(e) => setNaturalPrompt(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg bg-[#07090e] border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={translatingNlp}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {translatingNlp ? "Generowanie..." : "Wykonaj NLP"}
              </button>
            </div>
          </form>

          {/* Raw Terminal Command Area */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="terminal-command-input"
                className="text-xs font-mono-tabular text-slate-300"
              >
                {mode === "AGENT_USER"
                  ? `${agentUser}@bastilla-os:/home/${agentUser}$`
                  : "root@bastilla-os:/app/applet#"}
              </label>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                Tryb: {mode} (Bezpośrednie polecenie Linux)
              </span>
            </div>
            <div className="flex gap-2">
              <textarea
                id="terminal-command-input"
                rows={mode === "PYTHON_ROOT" ? 3 : 2}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="flex-1 p-2.5 rounded-lg bg-[#07090e] border border-slate-700 font-mono-tabular text-xs text-emerald-300 focus:outline-none focus:border-violet-500"
              />
              <button
                type="button"
                onClick={() => executeTerminalCommand()}
                disabled={running}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 self-start"
              >
                <Play className="w-3.5 h-3.5" />
                {running ? "Wykonywanie..." : "Wykonaj"}
              </button>
            </div>
          </div>

          {/* Output Stream */}
          <div className="flex-1 rounded-lg bg-[#05070b] border border-slate-800 p-3 sm:p-4 font-mono-tabular text-xs min-h-[300px] max-h-[460px] overflow-y-auto space-y-3">
            {logs.length === 0 ? (
              <div className="text-slate-400">
                Wpisz polecenie w języku naturalnym powyżej lub kliknij „Wykonaj”, aby uruchomić polecenie bezpośrednio w systemie Linux.
              </div>
            ) : (
              logs.map((entry) => (
                <div
                  key={entry.id}
                  className="pb-3 border-b border-slate-800/80 last:border-none"
                >
                  <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 mb-1 gap-1">
                    <span className="text-violet-300">
                      [{entry.timestamp}] [{entry.mode}] ({entry.agentUser})
                      {entry.naturalPrompt && (
                        <span className="text-cyan-300 ml-1">
                          · NLP: &quot;{entry.naturalPrompt}&quot;
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        entry.exitCode === 0
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      kod: {entry.exitCode}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300 mb-1 font-semibold">
                    $ {entry.command}
                  </div>
                  {entry.stdout && (
                    <pre className="whitespace-pre-wrap break-words text-slate-100 leading-relaxed text-[11px]">
                      {entry.stdout}
                    </pre>
                  )}
                  {entry.stderr && (
                    <pre className="whitespace-pre-wrap break-words text-amber-300 leading-relaxed mt-1 text-[11px]">
                      {entry.stderr}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
