import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

const projectRoot = path.resolve(import.meta.dirname, "..");
const stateDir = mkdtempSync(path.join(tmpdir(), "bastilla-test-"));
const dbPath = path.join(stateDir, "state.db");
const initDb = path.join(projectRoot, "distro/bastilla-overlay/init_db.py");
const codexHome = path.join(stateDir, "codex");
const codexBinary = path.join(stateDir, "codex.mjs");
let server: ChildProcess;
let baseUrl: string;
let bridgeUrl: string;
let ollamaAvailable = true;
const modelRequests: any[] = [];
const ollama = createServer(async (req, res) => {
  if (!ollamaAvailable) {
    req.socket.destroy();
    return;
  }
  if (req.url === "/api/version") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ version: "0.6.0-test" }));
    return;
  }
  if (req.url === "/api/tags") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ models: [{ name: "test-model" }] }));
    return;
  }
  if (req.url === "/api/ps") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ models: [] }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  modelRequests.push(raw ? JSON.parse(raw) : {});
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
  copyFileSync(path.join(projectRoot, "tests/fixtures/codex.mjs"), codexBinary);
  chmodSync(codexBinary, 0o755);
  mkdirSync(codexHome);
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
      BASTILLA_HOST: "127.0.0.1",
      BASTILLA_API_TOKEN: "",
      NODE_ENV: "production",
      BASTILLA_DB_PATH: dbPath,
      BASTILLA_PROVISION_HOST: "false",
      BASTILLA_ROOT_SOCKET: "false",
      BASTILLA_CONTINUOUS_MISSION: "false",
      BASTILLA_OLLAMA_BRIDGE: "true",
      BASTILLA_BRIDGE_PORT: "0",
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "synthetic-runtime-api-key",
      CODEX_HOME: codexHome,
      BASTILLA_CODEX_BIN: codexBinary,
      OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 15000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Server running at http:\/\/(?:0\.0\.0\.0|127\.0\.0\.1):(\d+)/);
      const adapter = output.match(/Gemini adapter running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (adapter) bridgeUrl = `http://127.0.0.1:${adapter[1]}`;
      if (match && bridgeUrl) {
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

test("Gemini adapter advertises no local weights and never fabricates an answer on inference failure", async () => {
  const catalog: any = await (await fetch(`${bridgeUrl}/api/tags`)).json();
  assert.deepEqual(catalog.models, []);
  assert.equal(catalog.provider, "gemini-bridge");
  const response = await fetch(`${bridgeUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "Show system telemetry" }] }) });
  assert.equal(response.status, 503);
  const body: any = await response.json();
  assert.equal(body.message, undefined);
  assert.match(body.error, /GEMINI_API_KEY/);
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
  assert.equal(sql("print(conn.execute('SELECT COUNT(*) FROM task_history').fetchone()[0])").trim(), "0");
  assert.equal(sql("print(conn.execute('SELECT COUNT(*) FROM agent_ipc_messages').fetchone()[0])").trim(), "0");
  const before = sql("print(conn.execute('SELECT COUNT(*) FROM agent_memories').fetchone()[0])");
  execFileSync("python3", [initDb, dbPath]);
  assert.equal(sql("print(conn.execute('SELECT COUNT(*) FROM agent_memories').fetchone()[0])"), before);
});

test("git sync cannot change refs or push main and maintenance preserves failed execution evidence", async () => {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  const blocked = await post("/api/git/sync", { remoteUrl: "https://example.invalid/$(touch injected)", commitMessage: "$(touch injected)" });
  assert.equal(blocked.status, 409);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }), head);
  sql("conn.execute(\"INSERT INTO chat_messages (session_id,sender_role,agent_id,engine_used,content,created_at) VALUES ('audit','assistant','aria','terminal','zenity exit=1','now')\")");
  const cycle = await post("/api/missions/continuous/trigger", {});
  assert.equal(cycle.status, 200);
  assert.equal(cycle.body.mission.stats.dbIntegrityChecks, 1);
  assert.equal(cycle.body.mission.stats.memoryFreedMb, 0);
  assert.equal(sql("print(conn.execute(\"SELECT content FROM chat_messages WHERE session_id='audit'\").fetchone()[0])").trim(), "zenity exit=1");
  assert.equal(sql("print(conn.execute(\"SELECT COUNT(*) FROM agents WHERE status LIKE '%ONLINE%'\").fetchone()[0])").trim(), "0");
});

test("invalid terminal modes, IPC paths and GET command execution are rejected", async () => {
  assert.equal((await post("/api/terminal/exec", { mode: "invalid", command: "id" })).status, 400);
  assert.equal((await post("/api/agents/ipc", { recipient: "../../tmp", payload: "test" })).status, 400);
  const response = await fetch(`${baseUrl}/api/chat/stream?message=${encodeURIComponent('/exec printf MUST_NOT_EXECUTE')}`);
  const body = await response.text();
  assert.match(body, /Polecenia wymagają POST/);
  assert.equal(body.includes("MUST_NOT_EXECUTE"), false);
});

test("queued tasks reach the model endpoint and expose evidence scoped to the server", async () => {
  const result = await post("/api/agent-tasks", { agentId: "astyria", prompt: "Queue inference diagnostic", idempotencyKey: "queue-api-once" });
  assert.equal(result.status, 202);
  let task: any;
  for (let i = 0; i < 60; i++) {
    const data: any = await (await fetch(`${baseUrl}/api/agent-tasks`)).json();
    task = data.tasks.find((t: any) => t.id === result.body.task.id);
    if (task.status === "succeeded") break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(task.status, "succeeded");
  assert.equal(task.result, "Test model response");
  assert.equal(modelRequests.at(-1).messages[0].content, "Queue inference diagnostic");
  const access: any = await (await fetch(`${baseUrl}/api/agents/capabilities`)).json();
  const agent = access.agents.find((a: any) => a.id === "astyria");
  assert.equal(agent.model.scope, "server-process");
  assert.equal(agent.model.task_id, task.id);
  assert.equal(agent.autonomous_tools, false);
  assert.equal(agent.model_repository_access, false);
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
  assert.match(stream, /"type":"done","engineUsed":"ollama\/llama3.2-vision:11b"/);
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

test("Codex endpoints reject fabricated tokens and report only CLI-confirmed authentication", async () => {
  const original = '{"api_key":"legacy-invalid-key"}';
  writeFileSync(path.join(codexHome, "auth.json"), original);
  writeFileSync(path.join(codexHome, "session.lock"), "keep");
  const status = await fetch(`${baseUrl}/api/codex/status`);
  const data: any = await status.json();
  assert.equal(data.auth_ready, false);
  for (const action of ["set_token", "clean_locks", "unknown"]) {
    assert.equal((await post("/api/codex/auth", { action })).status, 400);
  }
  assert.equal((await post("/api/codex/auth", { action: "set_api_key", apiKey: "do-not-accept-raw-keys" })).status, 400);
  assert.equal(readFileSync(path.join(codexHome, "auth.json"), "utf8"), original);
  assert.equal(readFileSync(path.join(codexHome, "session.lock"), "utf8"), "keep");
  const login = await post("/api/codex/auth", { action: "use_api_key" });
  assert.equal(login.status, 200);
  assert.equal(login.body.auth_ready, true);
  assert.equal(JSON.stringify(login.body).includes("synthetic-runtime-api-key"), false);
  const overview: any = await (await fetch(`${baseUrl}/api/system/overview`)).json();
  assert.equal(overview.host.tools.codex.auth_ready, true);
});
