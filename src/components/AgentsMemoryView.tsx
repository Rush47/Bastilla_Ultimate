import React, { useState } from "react";
import type { AgentId, SystemOverviewResponse } from "../types/bastilla";
import { AGENT_AVATARS } from "./BastillaDesktopView";
import {
  RotateCcw,
  Send,
  Plus,
  Database,
  CheckCircle2,
  Cpu,
  History,
  MessageSquareShare,
} from "lucide-react";

interface AgentsMemoryViewProps {
  overview: SystemOverviewResponse | null;
  onRefresh: () => void;
}

export const AgentsMemoryView: React.FC<AgentsMemoryViewProps> = ({
  overview,
  onRefresh,
}) => {
  const [ipcSender, setIpcSender] = useState<AgentId>("aria");
  const [ipcRecipient, setIpcRecipient] = useState<AgentId>("astyria");
  const [ipcSubject, setIpcSubject] = useState<string>("SVL_DOMAIN_CALIBRATION");
  const [ipcPayload, setIpcPayload] = useState<string>("");
  const [ipcError, setIpcError] = useState<string>("");

  const [memAgent, setMemAgent] = useState<AgentId>("aria");
  const [memCategory, setMemCategory] = useState<string>("SVL_KERNEL");
  const [memContent, setMemContent] = useState<string>("");
  const [memError, setMemError] = useState<string>("");
  const [busyAgent, setBusyAgent] = useState<string | null>(null);

  const host = overview?.host;
  const svl = overview?.svl_report;
  const memories = host?.db?.memories || [];
  const ipcList = host?.db?.ipc || [];
  const tasks = host?.db?.tasks || [];

  const handleDaemonControl = async (
    agentId: AgentId,
    action: "restart" | "start" | "stop"
  ) => {
    setBusyAgent(`${agentId}-${action}`);
    try {
      await fetch("/api/agents/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, action }),
      });
      onRefresh();
    } finally {
      setBusyAgent(null);
    }
  };

  const handleAutonomousRootCycle = async (agentId: AgentId) => {
    setBusyAgent(`${agentId}-autonomy`);
    try {
      await fetch("/api/agents/autonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      onRefresh();
    } finally {
      setBusyAgent(null);
    }
  };

  const handleSendIpc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipcPayload.trim()) {
      setIpcError("Wprowadź treść komunikatu IPC przed wysłaniem.");
      return;
    }
    setIpcError("");
    const res = await fetch("/api/agents/ipc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: ipcSender,
        recipient: ipcRecipient,
        subject: ipcSubject,
        payload: ipcPayload,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setIpcPayload("");
      onRefresh();
    } else {
      setIpcError(data.error || "Błąd zapisu IPC");
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memContent.trim()) {
      setMemError("Wprowadź treść wpisu pamięci długoterminowej.");
      return;
    }
    setMemError("");
    const res = await fetch("/api/agents/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: memAgent,
        category: memCategory,
        content: memContent,
        importance: 5,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      setMemContent("");
      onRefresh();
    } else {
      setMemError(data.error || "Błąd zapisu pamięci");
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] p-6 bg-[#07090e] space-y-6">
      {/* Section 1: 4 Linux Accounts & Worker Daemons */}
      <section className="bg-[#0c1018] border border-slate-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              01. Autonomiczni Agenci Linux ROOT, Workery Python i Izolacja SVL
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pełna autonomia i niezależność (zero promptów sterujących) · Uprawnienia ROOT (GID 0 + sudo UID 0 NOPASSWD)
            </p>
          </div>
          <div className="text-xs font-mono-tabular text-emerald-400">
            Uprawnienia: ROOT (UID 0 / GID 0) · Baza SQLite: {svl?.Database_Integration?.total_records ?? 36} rekordów
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(["aria", "alex", "astyria", "aurelius"] as AgentId[]).map((agentId) => {
            const live = host?.agents_live?.find((a) => a.id === agentId);
            const svlInfo = svl?.Connected_SVL_Agents?.[agentId];
            return (
              <div
                key={agentId}
                className="p-4 rounded-lg bg-[#111723] border border-slate-800 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={AGENT_AVATARS[agentId]}
                      alt={agentId}
                      referrerPolicy="no-referrer"
                      className="w-11 h-11 rounded-lg object-cover border border-slate-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-display font-bold text-base text-white capitalize">
                        {svlInfo?.name || agentId}
                      </div>
                      <div className="text-xs font-mono-tabular text-emerald-400">
                        {live?.running
                          ? `ROOT ONLINE · PID ${live.pid}`
                          : "STANDBY DAEMON"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs font-mono-tabular text-slate-300 border-t border-slate-800 pt-2.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Konto Linux:</span>
                      <span>
                        {agentId} (UID {live?.uid ?? svlInfo?.uid} / GID 0)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Uprawnienia:</span>
                      <span className="text-emerald-400 font-semibold">
                        ROOT (sudo UID 0)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Autonomia:</span>
                      <span className="text-violet-300">
                        PEŁNA (Bez promptów)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Metryka C:</span>
                      <span className="text-cyan-300">
                        {svlInfo?.metric_c ?? 2.5}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cykle Workera:</span>
                      <span>{live?.worker_status?.cycle ?? 1}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => handleAutonomousRootCycle(agentId)}
                    disabled={busyAgent === `${agentId}-autonomy`}
                    className="w-full py-1.5 px-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    {busyAgent === `${agentId}-autonomy`
                      ? "Wykonywanie cyklu ROOT..."
                      : "Autonomiczny Cykl ROOT"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDaemonControl(agentId, "restart")}
                      disabled={busyAgent === `${agentId}-restart`}
                      className="flex-1 py-1.5 px-2.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      Restartuj Workera
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDaemonControl(
                          agentId,
                          live?.running ? "stop" : "start"
                        )
                      }
                      className="py-1.5 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono-tabular transition-colors whitespace-nowrap"
                    >
                      {live?.running ? "Stop" : "Start"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 2: Inter-Agent IPC Bus & Long-Term SQLite Memory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left (6 cols): Inter-Agent IPC Bus */}
        <section className="lg:col-span-6 bg-[#0c1018] border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-white mb-1">
              02. Magistrala Komunikacji Agentów (IPC + /home/&lt;agent&gt;/inbox.jsonl)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Wysyłaj komunikaty między kontami Linux agentów i zapisuj je w tabeli agent_ipc_messages
            </p>

            <form onSubmit={handleSendIpc} className="space-y-3 mb-5">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label
                    htmlFor="ipc-sender"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Nadawca
                  </label>
                  <select
                    id="ipc-sender"
                    value={ipcSender}
                    onChange={(e) => setIpcSender(e.target.value as AgentId)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  >
                    <option value="aria">Aria (UID 1001)</option>
                    <option value="alex">Alex (UID 1002)</option>
                    <option value="astyria">Astyria (UID 1003)</option>
                    <option value="aurelius">Aurelius (UID 1004)</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="ipc-recipient"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Odbiorca
                  </label>
                  <select
                    id="ipc-recipient"
                    value={ipcRecipient}
                    onChange={(e) => setIpcRecipient(e.target.value as AgentId)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  >
                    <option value="astyria">Astyria (UID 1003)</option>
                    <option value="aurelius">Aurelius (UID 1004)</option>
                    <option value="alex">Alex (UID 1002)</option>
                    <option value="aria">Aria (UID 1001)</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="ipc-subject"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Temat Protokołu
                  </label>
                  <input
                    id="ipc-subject"
                    type="text"
                    value={ipcSubject}
                    onChange={(e) => setIpcSubject(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#111723] border border-slate-700 text-xs font-mono-tabular text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="Treść komunikatu IPC"
                  placeholder="Wpisz dyrektywę międzyagentową IPC..."
                  value={ipcPayload}
                  onChange={(e) => setIpcPayload(e.target.value)}
                  className="flex-1 px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  Wyślij IPC
                </button>
              </div>
              {ipcError && (
                <div className="text-xs text-rose-400">{ipcError}</div>
              )}
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {ipcList.map((m) => (
                <div
                  key={m.id}
                  className="p-3 rounded-lg bg-[#111723] border border-slate-800 text-xs"
                >
                  <div className="flex items-center justify-between font-mono-tabular text-slate-400 mb-1">
                    <span className="text-violet-300 font-semibold">
                      {m.sender.toUpperCase()} → {m.recipient.toUpperCase()} ·{" "}
                      {m.subject}
                    </span>
                    <span className="text-emerald-400">{m.status}</span>
                  </div>
                  <div className="text-slate-200">{m.payload}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right (6 cols): Long-Term SQLite Memory */}
        <section className="lg:col-span-6 bg-[#0c1018] border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-white mb-1">
              03. Długoterminowa Pamięć Agentów (SQLite agent_memories)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Trwała pamięć semantyczna i operacyjna współdzielona w /var/lib/bastilla/bastilla.db
            </p>

            <form onSubmit={handleAddMemory} className="space-y-3 mb-5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="mem-agent"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Przypisany Agent
                  </label>
                  <select
                    id="mem-agent"
                    value={memAgent}
                    onChange={(e) => setMemAgent(e.target.value as AgentId)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                  >
                    <option value="aria">Aria</option>
                    <option value="alex">Alex</option>
                    <option value="astyria">Astyria</option>
                    <option value="aurelius">Aurelius</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="mem-category"
                    className="block text-xs text-slate-400 mb-1"
                  >
                    Kategoria Pamięci
                  </label>
                  <input
                    id="mem-category"
                    type="text"
                    value={memCategory}
                    onChange={(e) => setMemCategory(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded bg-[#111723] border border-slate-700 text-xs font-mono-tabular text-white"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="Nowy fakt do pamięci długoterminowej"
                  placeholder="Dodaj nowy fakt do długoterminowej bazy wiedzy..."
                  value={memContent}
                  onChange={(e) => setMemContent(e.target.value)}
                  className="flex-1 px-3 py-2 rounded bg-[#111723] border border-slate-700 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  Zapisz w SQLite
                </button>
              </div>
              {memError && (
                <div className="text-xs text-rose-400">{memError}</div>
              )}
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {memories.map((mem) => (
                <div
                  key={mem.id}
                  className="p-3 rounded-lg bg-[#111723] border border-slate-800 text-xs"
                >
                  <div className="flex items-center justify-between font-mono-tabular text-slate-400 mb-1">
                    <span className="text-cyan-300 font-semibold">
                      [{mem.agent_id.toUpperCase()}] · {mem.category}
                    </span>
                    <span>Priorytet: {mem.importance}/5</span>
                  </div>
                  <div className="text-slate-200">{mem.content}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Section 3: Persistent Task History Table */}
      <section className="bg-[#0c1018] border border-slate-800 rounded-xl p-6">
        <h3 className="font-display text-lg font-bold text-white mb-1">
          04. Historia Zadań i Operacji Jądra (SQLite task_history)
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Rejestr wszystkich zadań wykonanych przez agentów oraz 5 terminali systemowych
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-mono-tabular">
                <th className="py-2.5 px-3">ID</th>
                <th className="py-2.5 px-3">Zadanie</th>
                <th className="py-2.5 px-3">Agent</th>
                <th className="py-2.5 px-3">Terminal</th>
                <th className="py-2.5 px-3">Polecenie / Skrypt</th>
                <th className="py-2.5 px-3">Wynik</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-slate-900/50">
                  <td className="py-2.5 px-3 text-slate-400">#{t.id}</td>
                  <td className="py-2.5 px-3 font-sans font-medium text-white">
                    {t.title}
                  </td>
                  <td className="py-2.5 px-3 text-violet-300 uppercase">
                    {t.assigned_agent}
                  </td>
                  <td className="py-2.5 px-3 text-cyan-300">{t.terminal_type}</td>
                  <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate">
                    {t.command_or_prompt}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 max-w-sm truncate">
                    {t.output_summary}
                  </td>
                  <td className="py-2.5 px-3 text-right text-emerald-400">
                    {t.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
