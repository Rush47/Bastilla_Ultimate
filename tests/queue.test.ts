import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TaskQueue, type Task } from "../server/task-queue";

const root = path.resolve(import.meta.dirname, "..");
function fixture(infer: (task: Task, signal: AbortSignal) => Promise<string>) {
  const directory = mkdtempSync(path.join(tmpdir(), "bastilla-queue-"));
  const db = path.join(directory, "test.db");
  execFileSync("python3", [path.join(root, "distro/bastilla-overlay/init_db.py"), db]);
  const queue = new TaskQueue(db, infer);
  return { queue, db, close() { queue.close(); rmSync(directory, { recursive: true, force: true }); } };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 7000;
  while (!check()) {
    assert.ok(Date.now() < deadline, "queue transition timed out");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test("durable queue honors priority, deduplicates submissions, and records actual model results", async () => {
  const called: string[] = [];
  const f = fixture(async task => { called.push(task.prompt); return "model response"; });
  try {
    const normal = f.queue.submit({ agentId: "aria", prompt: "normal", idempotencyKey: "once" });
    assert.equal(f.queue.submit({ agentId: "aria", prompt: "normal", idempotencyKey: "once" }).id, normal.id);
    assert.throws(() => f.queue.submit({ agentId: "alex", prompt: "different", idempotencyKey: "once" }));
    const urgent = f.queue.submit({ agentId: "alex", prompt: "urgent", priority: 10 });
    await until(() => f.queue.list().every(t => t.status === "succeeded"));
    assert.deepEqual(called, ["urgent", "normal"]);
    assert.equal(f.queue.latest("alex")?.id, urgent.id);
    assert.equal(f.queue.latest("alex")?.result, "model response");
  } finally { f.close(); }
});

test("cancellation fences late inference and expired leases survive restart as interrupted", async () => {
  let release: (result: string) => void = () => {};
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  try {
    const queued = f.queue.submit({ agentId: "aria", prompt: "cancel before start" });
    assert.equal(f.queue.cancel(queued.id), true);
    const active = f.queue.submit({ agentId: "alex", prompt: "cancel while running" });
    await until(() => f.queue.list().find(t => t.id === active.id)?.status === "running");
    f.queue.cancel(active.id); release("must not save");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(f.queue.list().find(t => t.id === active.id)?.result, "");
    const interrupted = f.queue.submit({ agentId: "astyria", prompt: "crashed worker" });
    const db = new DatabaseSync(f.db);
    db.prepare("UPDATE agent_tasks SET status='running',owner='crashed',lease_until='2000-01-01' WHERE id=?").run(interrupted.id);
    db.close();
    await until(() => f.queue.list().find(t => t.id === interrupted.id)?.status === "interrupted");
    assert.equal(f.queue.latest("alex"), undefined);
  } finally { release("done"); f.close(); }
});

test("failed and empty model responses never report success", async () => {
  const f = fixture(async task => { if (task.prompt === "empty") return ""; throw new Error("inference unavailable"); });
  try {
    f.queue.submit({ agentId: "aria", prompt: "unavailable" });
    f.queue.submit({ agentId: "aurelius", prompt: "empty" });
    assert.throws(() => f.queue.submit({ agentId: "../root", prompt: "invalid" }));
    await until(() => f.queue.list().every(t => t.status === "failed"));
    assert.equal(f.queue.latest("aria"), undefined);
    assert.equal(f.queue.latest("aurelius"), undefined);
  } finally { f.close(); }
});

test("two workers sharing SQLite never execute models concurrently", async () => {
  let concurrent = 0, maximum = 0;
  const inference = async () => {
    maximum = Math.max(maximum, ++concurrent);
    await new Promise(resolve => setTimeout(resolve, 100));
    concurrent--; return "real callback result";
  };
  const f = fixture(inference);
  const second = new TaskQueue(f.db, inference);
  try {
    for (const agentId of ["aria", "alex", "astyria", "aurelius"]) f.queue.submit({ agentId, prompt: agentId });
    await until(() => f.queue.list().every(t => t.status === "succeeded"));
    assert.equal(maximum, 1);
  } finally { second.close(); f.close(); }
});

test("queued work survives replacing the worker process instance", async () => {
  const f = fixture(async () => "first instance must not execute");
  const task = f.queue.submit({ agentId: "aurelius", prompt: "persist across restart" });
  f.queue.close();
  const replacement = new TaskQueue(f.db, async () => "replacement model response");
  try {
    assert.equal(replacement.list()[0].id, task.id);
    await until(() => replacement.list()[0].status === "succeeded");
    assert.equal(replacement.list()[0].result, "replacement model response");
  } finally { replacement.close(); f.close(); }
});
