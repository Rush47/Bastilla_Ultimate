import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

const projectRoot = path.resolve(import.meta.dirname, "..");
const stateDir = mkdtempSync(path.join(tmpdir(), "bastilla-test-"));
const dbPath = path.join(stateDir, "state.db");
const initDb = path.join(projectRoot, "distro/bastilla-overlay/init_db.py");
let server: ChildProcess;
let baseUrl: string;
let ollamaAvailable = true;
const modelRequests: any[] = [];
const ollama = createServer(async (req, res) => {
  if (!ollamaAvailable) {
    req.socket.destroy();
    return;
  }
  if (req.url === "/api/tags") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "test-model" }] }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  modelRequests.push(JSON.parse(raw));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ message: { content: "Test model response" } }));
});

function sql(script: string) {
  return execFileSync("python3", ["-c",
    `import sqlite3, sys\nconn = sqlite3.connect(sys.argv[1])\n${script}\nconn.commit()\nconn.close()`,
    dbPath], { encoding: "utf8" });
}

async function post(route: string, body: object) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() as any };
}

before(async () => {
  // Exercise an upgrade from the schema shipped in the original repository.
  execFileSync("python3", [initDb, dbPath]);
  sql("conn.execute('ALTER TABLE agents DROP COLUMN avatar_url')\nconn.execute('ALTER TABLE agents DROP COLUMN svl_locked')");
  execFileSync("python3", [initDb, dbPath]);
  assert.match(sql("print([r[1] for r in conn.execute('PRAGMA table_info(agents)')])"), /avatar_url/);
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  const address = ollama.address();
  assert.ok(address && typeof address === "object");
  server = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: "0",
      NODE_ENV: "production",
      BASTILLA_DB_PATH: dbPath,
      BASTILLA_PROVISION_HOST: "false",
      BASTILLA_ROOT_SOCKET: "false",
      BASTILLA_CONTINUOUS_MISSION: "false",
      BASTILLA_OLLAMA_BRIDGE: "false",
      GEMINI_API_KEY: "",
      OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 15000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Server running at http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) {
        baseUrl = `http://127.0.0.1:${match[1]}`;
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout!.on("data", onData);
    server.stderr!.on("data", onData);
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited (${code}): ${output}`));
    });
  });
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  await new Promise<void>((resolve) => ollama.close(() => resolve()));
  rmSync(stateDir, { recursive: true, force: true });
});

test("clean startup keeps host missions paused and retains database records on reinitialization", async () => {
  const response = await fetch(`${baseUrl}/api/missions/continuous/status`);
  const data: any = await response.json();
  assert.equal(data.mission.active, false);
  assert.equal(data.mission.cycle, 0);
  const before = sql("print(conn.execute('SELECT COUNT(*) FROM agent_memories').fetchone()[0])");
  execFileSync("python3", [initDb, dbPath]);
  assert.equal(sql("print(conn.execute('SELECT COUNT(*) FROM agent_memories').fetchone()[0])"), before);
});

test("SQLite writes and migrated avatar columns work", async () => {
  const memory = await post("/api/agents/memory", { agentId: "aria", content: "Regression memory" });
  assert.equal(memory.status, 200);
  assert.equal(memory.body.result.saved, true);
  const avatar = await post("/api/agents/avatar", { agentId: "aria", avatarUrl: "/assets/test.jpg" });
  assert.equal(avatar.status, 200);
  assert.equal(avatar.body.result.updated, true);
  assert.match(sql("print(conn.execute('SELECT content FROM agent_memories ORDER BY id DESC LIMIT 1').fetchone()[0])"), /Regression memory/);
});

test("terminal and SVL execute from the checked out project with the configured database", async () => {
  const terminal = await post("/api/terminal/exec", { mode: "LINUX_ROOT", command: "pwd" });
  assert.equal(terminal.body.exitCode, 0);
  assert.equal(terminal.body.stdout.trim(), projectRoot);
  const kernel = await post("/api/svl/execute", { xStart: "-inf", xEnd: "inf" });
  assert.equal(kernel.status, 200, JSON.stringify(kernel.body));
  assert.equal(kernel.body.ok, true);
  assert.deepEqual(kernel.body.report.Custom_Domain_Test.raw_domain, ["-inf", "inf"]);
  assert.equal(kernel.body.report.Custom_Domain_Test.metric_c, 2.5);
  const invalid = await post("/api/svl/execute", { xStart: "invalid", xEnd: "inf" });
  assert.equal(invalid.status, 400);
});

test("chat history remains inside its session", async () => {
  const first = await post("/api/chat/message", { sessionId: "session-a", message: "Only session A", enginePreference: "auto" });
  assert.equal(first.status, 200);
  const second = await post("/api/chat/message", { sessionId: "session-b", message: "Only session B", enginePreference: "auto" });
  assert.equal(second.status, 200);
  assert.equal(modelRequests.at(-1).messages.length, 1);
  await post("/api/chat/message", { sessionId: "session-a", message: "Continue A", enginePreference: "auto" });
  const messages = modelRequests.at(-1).messages;
  assert.equal(messages.length, 3);
  assert.equal(messages[0].content, "Only session A");
  assert.equal(messages.some((m: any) => m.content === "Only session B"), false);
});

test("SSE reports the model actually used and honors an explicit Gemini choice", async () => {
  const response = await fetch(`${baseUrl}/api/chat/stream?message=Hello&enginePreference=auto`);
  const stream = await response.text();
  assert.match(stream, /"type":"done","engineUsed":"ollama\/Qwen3.8-27B-Uncensored"/);
  const calls = modelRequests.length;
  const gemini = await fetch(`${baseUrl}/api/chat/stream?message=Hello&enginePreference=gemini`);
  assert.match(await gemini.text(), /"type":"error"/);
  assert.equal(modelRequests.length, calls);
});

test("Ollama transport failure reaches the Gemini fallback and status reports offline", async () => {
  ollamaAvailable = false;
  try {
    const response = await fetch(`${baseUrl}/api/chat/stream?message=Hello&enginePreference=auto`);
    assert.match(await response.text(), /GEMINI_API_KEY/);
    const overview = await fetch(`${baseUrl}/api/system/overview`);
    const data: any = await overview.json();
    assert.equal(data.ok, true, JSON.stringify(data));
    assert.equal(data.ai_routing.ollama_online, false);
    assert.equal(data.ai_routing.active_engine, "unavailable");
  } finally {
    ollamaAvailable = true;
  }
});

test("failed database writes return an HTTP error", async () => {
  sql("conn.execute('ALTER TABLE agent_memories RENAME TO saved_memories')");
  try {
    const result = await post("/api/agents/memory", { content: "Must not report success" });
    assert.equal(result.status, 500);
    assert.equal(result.body.ok, false);
  } finally {
    sql("conn.execute('ALTER TABLE saved_memories RENAME TO agent_memories')");
  }
});
