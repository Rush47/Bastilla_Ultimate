import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { redact } from "./security";

export const AGENTS = ["aria", "alex", "astyria", "aurelius"] as const;
export type Task = {
  id: string; agent_id: string; prompt: string; status: string; priority: number;
  provider: string; model: string; result: string; error: string; created_at: string;
  started_at: string | null; finished_at: string | null; heartbeat_at: string | null;
};
export type Inference = (task: Task, signal: AbortSignal) => Promise<string>;
type Submission = { agentId?: unknown; prompt?: unknown; priority?: unknown; idempotencyKey?: unknown };

// One model request per database, including when several HTTP processes share it.
// SQLite's atomic claim and renewable lease fence late results after cancellation.
export class TaskQueue {
  private db: DatabaseSync;
  private timer: ReturnType<typeof setInterval>;
  private active: { id: string; controller: AbortController } | null = null;
  private owner = randomUUID();
  private ticking = false;
  private stopped = false;
  constructor(dbPath: string, private infer: Inference) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout=5000");
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref();
  }
  list(): Task[] {
    return this.db.prepare("SELECT * FROM agent_tasks ORDER BY created_at DESC, rowid DESC LIMIT 100").all() as unknown as Task[];
  }
  latest(agent: string): Task | undefined {
    return this.db.prepare("SELECT * FROM agent_tasks WHERE agent_id=? AND status='succeeded' ORDER BY finished_at DESC LIMIT 1").get(agent) as Task | undefined;
  }
  submit(input: Submission) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const task = this.enqueue(input);
      this.db.exec("COMMIT");
      return task;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private enqueue(input: Submission) {
    const { agentId, prompt, priority = 0, idempotencyKey } = input;
    if (!AGENTS.includes(agentId as any) || typeof prompt !== "string" || !prompt.trim() || prompt.length > 8000 ||
        !Number.isInteger(priority) || Number(priority) < 0 || Number(priority) > 10 ||
        (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !/^[\w-]{1,100}$/.test(idempotencyKey)))) {
      throw new Error("Nieprawidłowy agent, treść (1–8000 znaków), priorytet (0–10) lub klucz zadania.");
    }
    const provider = process.env.BASTILLA_AGENT_PROVIDER || "ollama";
    if (!["ollama", "gemini"].includes(provider)) throw new Error("Nieobsługiwany dostawca modelu.");
    const profile = this.db.prepare("SELECT model_primary, model_fallback FROM agents WHERE id=?").get(String(agentId));
    const model = provider === "gemini" ? process.env.GEMINI_MODEL || "gemini-flash-latest" :
      String(profile?.model_primary || "ollama/llama3.2-vision:11b").replace(/^ollama\//, "");
    const existing = idempotencyKey ? this.db.prepare("SELECT * FROM agent_tasks WHERE idempotency_key=?").get(String(idempotencyKey)) as Task | undefined : undefined;
    if (existing) {
      if (existing.agent_id !== agentId || existing.prompt !== redact(prompt.trim()) || existing.priority !== priority) throw new Error("Klucz zadania jest już używany dla innej treści.");
      return existing;
    }
    if (Number(this.db.prepare("SELECT COUNT(*) AS n FROM agent_tasks WHERE status IN ('queued','running')").get()?.n) >= 100) throw new Error("Kolejka jest pełna (100 zadań).");
    const id = randomUUID();
    this.db.prepare("INSERT INTO agent_tasks (id,agent_id,prompt,priority,provider,model,status,created_at,idempotency_key) VALUES (?,?,?,?,?,?,'queued',?,?)")
      .run(id, String(agentId), redact(prompt.trim()), Number(priority), provider, model, new Date().toISOString(), idempotencyKey ? String(idempotencyKey) : null);
    return this.db.prepare("SELECT * FROM agent_tasks WHERE id=?").get(id) as Task;
  }
  cancel(id: string) {
    const changed = this.db.prepare("UPDATE agent_tasks SET status='cancelled', finished_at=? WHERE id=? AND status IN ('queued','running')")
      .run(new Date().toISOString(), id).changes;
    if (this.active?.id === id) this.active.controller.abort();
    return Number(changed) > 0;
  }
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date().toISOString();
      this.db.exec("BEGIN IMMEDIATE");
      let task: Task | undefined;
      try {
        this.db.prepare("UPDATE agent_tasks SET status='interrupted', error='Wygasła dzierżawa workera. Wymagane nowe zadanie.', finished_at=? WHERE status='running' AND lease_until < ?").run(now, now);
        const running = this.db.prepare("SELECT id FROM agent_tasks WHERE status='running' LIMIT 1").get();
        if (!running) {
          task = this.db.prepare("SELECT * FROM agent_tasks WHERE status='queued' ORDER BY priority DESC, created_at, rowid LIMIT 1").get() as Task | undefined;
          if (task) this.db.prepare("UPDATE agent_tasks SET status='running',owner=?,started_at=?,heartbeat_at=?,lease_until=? WHERE id=?")
            .run(this.owner, now, now, new Date(Date.now() + 30000).toISOString(), task.id);
        }
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      if (!task) return;
      const controller = new AbortController();
      this.active = { id: task.id, controller };
      const heartbeat = setInterval(() => {
        try {
          const updated = this.db.prepare("UPDATE agent_tasks SET heartbeat_at=?,lease_until=? WHERE id=? AND status='running' AND owner=?")
            .run(new Date().toISOString(), new Date(Date.now() + 30000).toISOString(), task!.id, this.owner).changes;
          if (!updated) controller.abort();
        } catch { controller.abort(); }
      }, 5000);
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const result = await this.infer(task, controller.signal);
        if (controller.signal.aborted) throw new Error("Zadanie przerwane lub przekroczono limit 60 s.");
        if (!result.trim()) throw new Error("Model zwrócił pustą odpowiedź.");
        this.finish(task.id, "succeeded", redact(result).slice(0, 32000), "");
      } catch (error) {
        this.finish(task.id, "failed", "", redact(error instanceof Error ? error.message : "Błąd modelu").slice(0, 1000));
      } finally {
        clearInterval(heartbeat); clearTimeout(timeout); this.active = null;
      }
    } catch { console.error("Agent queue: database operation failed."); }
    finally { this.ticking = false; if (this.stopped) this.db.close(); }
  }
  private finish(id: string, status: string, result: string, error: string) {
    this.db.prepare("UPDATE agent_tasks SET status=?,result=?,error=?,finished_at=? WHERE id=? AND status='running' AND owner=?")
      .run(status, result, error, new Date().toISOString(), id, this.owner);
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.active?.controller.abort();
    this.db.prepare("UPDATE agent_tasks SET status='interrupted',error='Serwer zatrzymany.',finished_at=? WHERE status='running' AND owner=?").run(new Date().toISOString(), this.owner);
    // Keep the connection until pending inference settles and discards its late result.
    if (!this.ticking) this.db.close();
  }
}
