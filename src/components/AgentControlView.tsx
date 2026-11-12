import React, { useCallback, useEffect, useState } from "react";
import type { AgentId } from "../types/bastilla";
import { apiFetchJson } from "../utils/apiClient";

type Job = { id: string; agent_id: string; prompt: string; priority: number; status: string; provider: string; model: string; result: string; error: string; created_at: string; heartbeat_at: string | null };
type Capability = { id: string; checked_at: string; linux: { state: string; uid?: number; gid?: number; tools: Record<string, boolean>; repository: { read: boolean; write: boolean }; github: { state: string; read: boolean; push: boolean } }; model: { state: string; model: string | null; last_success_at: string | null }; note: string };
const names: AgentId[] = ["aria", "alex", "astyria", "aurelius"];
const labels: Record<string, string> = { queued: "W kolejce", running: "Wykonywane", succeeded: "Zakończone", failed: "Błąd", cancelled: "Anulowane", interrupted: "Przerwane" };

export function AgentControlView() {
  const [agents, setAgents] = useState<Capability[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [agentId, setAgentId] = useState<AgentId>("aria");
  const [prompt, setPrompt] = useState("");
  const [priority, setPriority] = useState(0);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState("");
  const refresh = useCallback(async (remote = false) => {
    try {
      const [tasks, capabilities] = await Promise.all([
        apiFetchJson<{ tasks: Job[] }>("/api/agent-tasks"),
        apiFetchJson<{ agents: Capability[] }>(
          `/api/agents/capabilities${remote ? "?remote=true" : ""}`
        ),
      ]);
      setJobs(tasks.tasks); setAgents(capabilities.agents); setCheckedAt(new Date().toLocaleTimeString()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Brak połączenia."); }
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 5000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [refresh]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await apiFetchJson("/api/agent-tasks", {
        method: "POST",
        body: JSON.stringify({ agentId, prompt, priority, idempotencyKey: crypto.randomUUID() }),
      });
      setPrompt(""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Błąd zapisu zadania."); }
    finally { setBusy(false); }
  }
  async function cancel(id: string) {
    try {
      await apiFetchJson(`/api/agent-tasks/${id}/cancel`, {
        method: "POST",
        body: "{}",
      });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Błąd anulowania."); }
  }
  return <div className="max-w-6xl mx-auto p-3 sm:p-6 space-y-5" aria-label="Panel sterowania agentami">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <div><h1 className="text-xl sm:text-2xl font-bold">Sterowanie agentami</h1><p className="text-sm text-slate-400">Stan kont, dostęp i rzeczywiste wyniki zadań. Odczyt: {checkedAt || "oczekiwanie"}.</p></div>
      <button className="min-h-11 px-4 rounded-lg bg-violet-600" onClick={() => void refresh(true)}>Sprawdź dostęp GitHub</button>
    </div>
    {error && <p role="alert" className="p-3 border border-amber-600 rounded-lg text-amber-200">{error}</p>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {names.map(id => {
        const agent = agents.find(a => a.id === id);
        return <article key={id} className="bg-[#111723] border border-slate-700 p-4 rounded-xl space-y-2 text-sm min-w-0">
          <h2 className="capitalize text-lg font-bold">{id}</h2>
          <p>Konto Linux: {agent?.linux.state === "verified" ? `UID ${agent.linux.uid}, GID ${agent.linux.gid}` : agent?.linux.state === "identity_not_accessible" ? "brak dostępu do tożsamości" : "niepotwierdzone"}</p>
          <p>Model: {agent?.model.last_success_at ? "odpowiedź potwierdzona w serwerze" : "niezweryfikowany"}</p>
          {agent?.model.last_success_at && <p className="text-slate-400 break-words">{agent.model.model} · {new Date(agent.model.last_success_at).toLocaleString()}</p>}
          <p>Narzędzia konta: {Object.entries(agent?.linux.tools || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "brak potwierdzenia"}</p>
          <p>Repo lokalne: {agent?.linux.repository.read ? "odczyt" : "brak potwierdzenia"}{agent?.linux.repository.write ? " i zapis" : ""}</p>
          <p>GitHub: {agent?.linux.github.state === "verified" ? `${agent.linux.github.read ? "odczyt" : "bez odczytu"}, ${agent.linux.github.push ? "prawo push" : "bez push"}` : "niezweryfikowany"}</p>
          <p className="text-xs text-slate-400">Model otrzymuje treść zadania. Narzędzia i pliki repozytorium wymagają osobnego wykonawcy.</p>
        </article>;
      })}
    </div>
    <form onSubmit={submit} className="p-4 sm:p-5 rounded-xl border border-slate-700 bg-[#111723] space-y-3">
      <h2 className="text-lg font-semibold">Nowe zadanie modelu</h2>
      <div className="grid grid-cols-2 gap-3">
        <label>Agent<select className="block w-full min-h-11 mt-1 bg-slate-900 border border-slate-600 rounded px-3" value={agentId} onChange={e => setAgentId(e.target.value as AgentId)}>{names.map(id => <option key={id}>{id}</option>)}</select></label>
        <label>Priorytet<select className="block w-full min-h-11 mt-1 bg-slate-900 border border-slate-600 rounded px-3" value={priority} onChange={e => setPriority(Number(e.target.value))}><option value={0}>Zwykły</option><option value={5}>Wysoki</option><option value={10}>Pilny</option></select></label>
      </div>
      <label className="block">Treść zadania<textarea className="block w-full min-h-28 mt-1 bg-slate-900 border border-slate-600 rounded p-3" value={prompt} maxLength={8000} required onChange={e => setPrompt(e.target.value)} placeholder="Opisz zadanie dla modelu…" /></label>
      <p className="text-xs text-slate-400">Wykonanie przez serwer, limit 60 s, jeden model naraz. Status zakończony wymaga niepustej odpowiedzi modelu.</p>
      <button disabled={busy || !prompt.trim()} className="min-h-11 w-full sm:w-auto px-5 rounded-lg bg-violet-600 disabled:opacity-50">{busy ? "Zapisywanie…" : "Dodaj do kolejki"}</button>
    </form>
    <section aria-label="Kolejka zadań" className="space-y-3">
      <h2 className="text-lg font-semibold">Kolejka i wyniki</h2>
      {!jobs.length && <p className="text-slate-400">Brak zadań. Dodanie zadania nie potwierdza wykonania.</p>}
      {jobs.map(job => <article key={job.id} className="p-4 rounded-xl border border-slate-700 bg-[#111723] min-w-0">
        <div className="flex flex-wrap items-center gap-2"><strong className="capitalize">{job.agent_id}</strong><span className={job.status === "succeeded" ? "text-emerald-300" : job.status === "failed" ? "text-amber-300" : "text-slate-300"}>{labels[job.status] || job.status}</span><span className="text-xs text-slate-400 break-all">{job.provider}/{job.model} · P{job.priority}</span></div>
        <p className="whitespace-pre-wrap break-words mt-2">{job.prompt}</p>
        {job.heartbeat_at && <p className="text-xs text-slate-400 mt-2">Heartbeat zadania: {new Date(job.heartbeat_at).toLocaleTimeString()}</p>}
        {(job.result || job.error) && <pre className="text-sm whitespace-pre-wrap break-words mt-3 bg-slate-950 p-3 rounded">{job.result || job.error}</pre>}
        {["queued", "running"].includes(job.status) && <button className="min-h-11 mt-3 px-4 rounded border border-slate-500" onClick={() => void cancel(job.id)}>Anuluj zadanie</button>}
      </article>)}
    </section>
  </div>;
}
