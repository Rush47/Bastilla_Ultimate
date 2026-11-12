import { timingSafeEqual } from "node:crypto";
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { CodexDeviceLogin, CodexStatus } from "../src/types/codex";

export class CodexError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function parseDevicePrompt(output: string) {
  const text = stripVTControlCharacters(output);
  const verification_url = text.match(/https:\/\/(?:auth\.openai\.com|auth\.chatgpt\.com)\/codex\/device\b/)?.[0];
  const user_code = text.match(/one-time code[^\r\n]*\r?\n[ \t]*([A-Z0-9-]{6,32})[ \t]*\r?\n/i)?.[1];
  return verification_url && user_code ? { verification_url, user_code } : null;
}

export class CodexAuthManager {
  private binary: string;
  private env: NodeJS.ProcessEnv;
  private projectRoot: string;
  private child: ChildProcess | null = null;
  private apiKeyLogin = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private login: CodexDeviceLogin | null = null;

  constructor(options: { projectRoot: string; env?: NodeJS.ProcessEnv }) {
    this.projectRoot = options.projectRoot;
    this.env = { ...(options.env || process.env) };
    const localBinary = path.join(this.projectRoot, "node_modules/.bin", process.platform === "win32" ? "codex.cmd" : "codex");
    this.binary = this.env.BASTILLA_CODEX_BIN || (existsSync(localBinary) ? localBinary : "codex");
  }

  private run(args: string[], input?: string, timeout = 5000) {
    return new Promise<{ code: string | number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(this.binary, args, {
        cwd: this.projectRoot, env: this.env, timeout, maxBuffer: 64 * 1024,
      }, (error, stdout, stderr) => {
        resolve({ code: error ? error.code || 1 : 0, stdout, stderr });
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    });
  }

  async status(): Promise<CodexStatus> {
    const version = await this.run(["--version"]);
    const versionText = stripVTControlCharacters(version.stdout).match(/codex-cli[^\r\n]*/)?.[0] || "";
    const installed = version.code === 0 && Boolean(versionText);
    const result = installed ? await this.run(["login", "status"]) : null;
    const output = stripVTControlCharacters(`${result?.stdout || ""}\n${result?.stderr || ""}`);
    const authPath = path.join(this.env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json");
    let legacyCredentials = false;
    try {
      const auth = JSON.parse(readFileSync(authPath, "utf8"));
      // Earlier Bastilla releases wrote these fabricated tokens or this wrong key.
      // The CLI's local status can accept such files without validating the token.
      legacyCredentials = Boolean(auth && (
        /^codex_tk_/.test(String(auth.access_token || "")) ||
        /^codex_rf_/.test(String(auth.refresh_token || "")) ||
        (typeof auth.api_key === "string" && !auth.OPENAI_API_KEY && !auth.tokens)
      ));
    } catch {}
    // Neither a credential file nor a configured environment key proves login.
    const recognized = /Logged in using (?:an API key|ChatGPT|(?:personal )?access token|workload identity)|API key configured/i.test(output);
    const authenticated = result?.code === 0 && recognized && !legacyCredentials;
    const tokenType = !authenticated ? "NONE" : /API key/i.test(output) ? "API_KEY" : /access token/i.test(output) ? "ACCESS_TOKEN" : /workload identity/i.test(output) ? "WORKLOAD_IDENTITY" : "CHATGPT";
    const loginStatus = !installed ? "unavailable" : legacyCredentials ? "invalid_credentials" : authenticated ? "logged_in" : /not logged in/i.test(output) ? "not_logged_in" : "error";
    const messages = {
      unavailable: "Codex CLI jest niedostępny. Zainstaluj zależności projektu i sprawdź uprawnienia pliku wykonywalnego.",
      logged_in: `Codex CLI potwierdził logowanie (${tokenType === "API_KEY" ? "klucz API" : tokenType === "ACCESS_TOKEN" ? "token dostępu" : tokenType === "WORKLOAD_IDENTITY" ? "tożsamość środowiska" : "ChatGPT"}).`,
      not_logged_in: "Codex CLI wymaga logowania przez ChatGPT lub użycia klucza API z serwera.",
      invalid_credentials: "Wykryto nieprawidłowe poświadczenia zapisane przez dawny panel. Zaloguj się ponownie przez ChatGPT lub użyj klucza z serwera.",
      error: "Codex CLI nie potwierdził logowania. Sprawdź konfigurację poleceniem codex login status w terminalu.",
    };
    return {
      installed,
      version: versionText,
      binary_path: this.binary,
      auth_ready: authenticated,
      token_type: tokenType,
      login_status: loginStatus,
      has_auth_json: existsSync(authPath),
      api_key_configured: Boolean(this.env.OPENAI_API_KEY?.trim()),
      message: messages[loginStatus],
      login: this.login ? { ...this.login } : null,
    };
  }

  startDeviceLogin() {
    if (this.apiKeyLogin) throw new CodexError(409, "Trwa logowanie kluczem API.");
    if (this.child) return;
    const session: CodexDeviceLogin = { state: "starting", expires_at: Date.now() + 15 * 60 * 1000 };
    this.login = session;
    let output = "";
    const child = spawn(this.binary, ["login", "--device-auth"], {
      cwd: this.projectRoot, env: this.env, stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    const clearPrompt = () => { delete session.user_code; delete session.verification_url; };
    const finish = (state: CodexDeviceLogin["state"]) => {
      if (this.child !== child) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.child = null;
      session.state = state;
      clearPrompt();
    };
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16384);
      const prompt = parseDevicePrompt(output);
      if (prompt && this.child === child) Object.assign(session, prompt, { state: "pending" });
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", () => finish("failed"));
    child.on("close", (code) => finish(code === 0 ? "complete" : "failed"));
    this.timer = setTimeout(() => { finish("expired"); child.kill("SIGTERM"); }, 15 * 60 * 1000);
    this.timer.unref();
  }

  cancelDeviceLogin() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    if (this.login && child) {
      this.login.state = "cancelled";
      delete this.login.user_code;
      delete this.login.verification_url;
    }
    child?.kill("SIGTERM");
  }

  async useEnvironmentApiKey() {
    if (this.child || this.apiKeyLogin) throw new CodexError(409, "Trwa już logowanie Codex CLI.");
    const key = this.env.OPENAI_API_KEY?.trim();
    if (!key) throw new CodexError(400, "Skonfiguruj OPENAI_API_KEY w sekretach serwera, a następnie ponów logowanie.");
    this.apiKeyLogin = true;
    try {
      // The CLI owns its credential schema and storage; the key is never an argument.
      const result = await this.run(["login", "--with-api-key"], `${key}\n`, 30000);
      if (result.code !== 0) throw new CodexError(502, "Codex CLI nie zapisał logowania kluczem API. Sprawdź konfigurację CLI i dostęp do jego magazynu poświadczeń.");
      return await this.status();
    } finally {
      this.apiKeyLogin = false;
    }
  }

  dispose() { this.cancelDeviceLogin(); }
}

export interface CodexTaskRecord {
  id: number;
  agent_id: string;
  session_id: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "error" | "cancelled";
  output: string;
  error: string;
  created_at: string;
  updated_at: string;
}

export class CodexTaskManager extends EventEmitter {
  private activeProcesses = new Map<number, ChildProcess>();
  private runningBySession = new Map<string, number>();

  constructor(private projectRoot: string, private dbPath: string, private env: NodeJS.ProcessEnv) {
    super();
    this.ensureSchema();
  }

  private ensureSchema() {
    try {
      mkdirSync(path.dirname(this.dbPath), { recursive: true });
      this.runSqlRun(`
        CREATE TABLE IF NOT EXISTS codex_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL,
          output TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    } catch (e: any) {
      console.error("CodexTaskManager ensureSchema error:", e?.message || e);
    }
  }

  private sanitizeSecrets(text: string): string {
    if (!text) return "";
    let cleaned = stripVTControlCharacters(text);
    const secretsToRedact: string[] = [];
    if (this.env.OPENAI_API_KEY && this.env.OPENAI_API_KEY.trim().length > 4) {
      secretsToRedact.push(this.env.OPENAI_API_KEY.trim());
    }
    if (this.env.GEMINI_API_KEY && this.env.GEMINI_API_KEY.trim().length > 4) {
      secretsToRedact.push(this.env.GEMINI_API_KEY.trim());
    }
    try {
      const authPath = path.join(this.env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json");
      if (existsSync(authPath)) {
        const auth = JSON.parse(readFileSync(authPath, "utf8"));
        if (typeof auth?.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 4) {
          secretsToRedact.push(auth.OPENAI_API_KEY);
        }
        if (typeof auth?.tokens?.access_token === "string" && auth.tokens.access_token.length > 4) {
          secretsToRedact.push(auth.tokens.access_token);
        }
        if (typeof auth?.tokens?.refresh_token === "string" && auth.tokens.refresh_token.length > 4) {
          secretsToRedact.push(auth.tokens.refresh_token);
        }
      }
    } catch {}
    for (const secret of secretsToRedact) {
      cleaned = cleaned.split(secret).join("[REDACTED_SECRET]");
    }
    return cleaned;
  }

  verifyOperatorPermission(operatorToken?: string): boolean {
    const expected = this.env.BASTILLA_API_TOKEN;
    if (!expected || !operatorToken) return false;
    const a = Buffer.from(expected);
    const b = Buffer.from(operatorToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  static normalizeSessionId(agentId: string, sessionId?: string): string {
    const cleanAgent = ["aria", "alex", "astyria", "aurelius"].includes(agentId.toLowerCase())
      ? agentId.toLowerCase()
      : "aria";
    if (!sessionId || sessionId === "bastilla-main" || sessionId === "auto") {
      return `codex-${cleanAgent}`;
    }
    return sessionId;
  }

  private runSql(sql: string, params: any[] = []): CodexTaskRecord[] {
    try {
      const pyScript = `
import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
res = conn.execute(sys.argv[2], json.loads(sys.argv[3])).fetchall()
conn.commit()
conn.close()
print(json.dumps([dict(r) for r in res]))
`;
      const out = execFileSync("python3", ["-c", pyScript, this.dbPath, sql, JSON.stringify(params)], { encoding: "utf8" });
      return JSON.parse(out.trim() || "[]");
    } catch (e: any) {
      console.error("CodexTaskManager SQLite error:", e?.message || e);
      return [];
    }
  }

  private runSqlRun(sql: string, params: any[] = []) {
    try {
      const pyScript = `
import sqlite3, sys, json
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
cur.execute(sys.argv[2], json.loads(sys.argv[3]))
last_id = cur.lastrowid
conn.commit()
conn.close()
print(json.dumps({"last_id": last_id}))
`;
      const out = execFileSync("python3", ["-c", pyScript, this.dbPath, sql, JSON.stringify(params)], { encoding: "utf8" });
      return JSON.parse(out.trim() || '{"last_id":0}');
    } catch (e: any) {
      console.error("CodexTaskManager SQLite run error:", e?.message || e);
      return { last_id: 0 };
    }
  }

  createTask(
    agentId: string,
    sessionId: string,
    prompt: string,
    options?: { autoStart?: boolean; stdin?: string; operatorToken?: string; localAuthorized?: boolean }
  ): number {
    const tokenConfigured = Boolean(this.env.BASTILLA_API_TOKEN?.trim());
    const authorized = tokenConfigured
      ? this.verifyOperatorPermission(options?.operatorToken)
      : Boolean(options?.localAuthorized);
    if (!authorized) {
      throw new CodexError(403, "Brak uprawnień operatora do wykonywania zadań Codex CLI.");
    }
    const cleanAgent = ["aria", "alex", "astyria", "aurelius"].includes(agentId.toLowerCase())
      ? agentId.toLowerCase()
      : "aria";
    const resolvedSession = CodexTaskManager.normalizeSessionId(cleanAgent, sessionId);
    const now = new Date().toISOString();
    const res = this.runSqlRun(
      "INSERT INTO codex_tasks (agent_id, session_id, prompt, status, output, error, created_at, updated_at) VALUES (?, ?, ?, 'pending', '', '', ?, ?)",
      [cleanAgent, resolvedSession, prompt, now, now]
    );
    const taskId = res.last_id;
    this.emit("update", { taskId, agentId: cleanAgent, sessionId: resolvedSession, status: "pending", output: "", error: "" });
    if (options?.autoStart !== false) {
      this.processQueue(resolvedSession, options?.stdin);
    }
    return taskId;
  }

  processQueue(sessionId: string, stdinInput?: string) {
    if (this.runningBySession.has(sessionId)) {
      return;
    }
    const pendingRows = this.runSql(
      "SELECT * FROM codex_tasks WHERE session_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1",
      [sessionId]
    );
    if (!pendingRows.length) return;
    const nextTask = pendingRows[0];
    this.runTask(nextTask.id, stdinInput);
  }

  startTask(taskId: number, stdinInput?: string) {
    const rows = this.runSql("SELECT * FROM codex_tasks WHERE id = ?", [taskId]);
    if (!rows.length) return;
    const task = rows[0];
    if (task.status === "running") return;
    const now = new Date().toISOString();
    this.runSqlRun("UPDATE codex_tasks SET status = 'pending', updated_at = ? WHERE id = ?", [now, taskId]);
    this.emit("update", { taskId, status: "pending", output: task.output, error: task.error });
    this.processQueue(task.session_id, stdinInput);
  }

  async runTask(taskId: number, stdinInput?: string) {
    const rows = this.runSql("SELECT * FROM codex_tasks WHERE id = ?", [taskId]);
    if (!rows.length) return;
    const task = rows[0];
    if (this.runningBySession.has(task.session_id) && this.runningBySession.get(task.session_id) !== taskId) {
      return;
    }
    this.runningBySession.set(task.session_id, taskId);

    const prompt = task.prompt;
    const localBinary = path.join(this.projectRoot, "node_modules/.bin", process.platform === "win32" ? "codex.cmd" : "codex");
    const binary = this.env.BASTILLA_CODEX_BIN || (existsSync(localBinary) ? localBinary : "codex");

    const now = new Date().toISOString();
    this.runSqlRun("UPDATE codex_tasks SET status = 'running', updated_at = ? WHERE id = ?", [now, taskId]);
    this.emit("update", { taskId, sessionId: task.session_id, status: "running", output: "" });

    let output = "";
    let errorOutput = "";

    const child = spawn(binary, ["exec", prompt], {
      cwd: this.projectRoot,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin?.on("error", () => {});
    if (stdinInput) {
      child.stdin?.write(stdinInput);
    }
    child.stdin?.end();

    this.activeProcesses.set(taskId, child);

    child.stdout?.on("data", (chunk) => {
      const text = this.sanitizeSecrets(chunk.toString());
      output += text;
      this.emit("data", { taskId, sessionId: task.session_id, output, error: errorOutput });
      this.runSqlRun("UPDATE codex_tasks SET output = ?, updated_at = ? WHERE id = ?", [output, new Date().toISOString(), taskId]);
    });

    child.stderr?.on("data", (chunk) => {
      const text = this.sanitizeSecrets(chunk.toString());
      errorOutput += text;
      this.emit("data", { taskId, sessionId: task.session_id, output, error: errorOutput });
      this.runSqlRun("UPDATE codex_tasks SET error = ?, updated_at = ? WHERE id = ?", [errorOutput, new Date().toISOString(), taskId]);
    });

    child.on("error", (err) => {
      this.activeProcesses.delete(taskId);
      if (this.runningBySession.get(task.session_id) === taskId) {
        this.runningBySession.delete(task.session_id);
      }
      const errText = this.sanitizeSecrets(err.message);
      const completedAt = new Date().toISOString();
      this.runSqlRun("UPDATE codex_tasks SET status = 'error', error = ?, updated_at = ? WHERE id = ?", [errText, completedAt, taskId]);
      this.emit("complete", { taskId, sessionId: task.session_id, status: "error", output, error: errText });
      this.processQueue(task.session_id);
    });

    child.on("close", (code, signal) => {
      this.activeProcesses.delete(taskId);
      if (this.runningBySession.get(task.session_id) === taskId) {
        this.runningBySession.delete(task.session_id);
      }
      const currentRows = this.runSql("SELECT status FROM codex_tasks WHERE id = ?", [taskId]);
      if (currentRows[0]?.status === "cancelled" || signal === "SIGTERM") {
        this.processQueue(task.session_id);
        return;
      }
      const status = code === 0 ? "completed" : "error";
      const completedAt = new Date().toISOString();
      this.runSqlRun("UPDATE codex_tasks SET status = ?, updated_at = ? WHERE id = ?", [status, completedAt, taskId]);
      this.emit("complete", { taskId, sessionId: task.session_id, status, output, error: errorOutput });
      this.processQueue(task.session_id);
    });
  }

  cancelTask(taskId: number) {
    const rows = this.runSql("SELECT * FROM codex_tasks WHERE id = ?", [taskId]);
    const sessionId = rows[0]?.session_id;
    const now = new Date().toISOString();
    this.runSqlRun("UPDATE codex_tasks SET status = 'cancelled', updated_at = ? WHERE id = ?", [now, taskId]);

    const child = this.activeProcesses.get(taskId);
    if (child) {
      this.activeProcesses.delete(taskId);
      if (sessionId && this.runningBySession.get(sessionId) === taskId) {
        this.runningBySession.delete(sessionId);
      }
      child.kill("SIGTERM");
    }
    this.emit("complete", { taskId, sessionId, status: "cancelled", output: rows[0]?.output || "", error: rows[0]?.error || "" });
    if (sessionId) {
      this.processQueue(sessionId);
    }
  }

  retryTask(taskId: number) {
    const rows = this.runSql("SELECT * FROM codex_tasks WHERE id = ?", [taskId]);
    if (!rows.length) return;
    const task = rows[0];
    if (this.activeProcesses.has(taskId)) {
      this.cancelTask(taskId);
    }
    const now = new Date().toISOString();
    this.runSqlRun("UPDATE codex_tasks SET status = 'pending', output = '', error = '', updated_at = ? WHERE id = ?", [now, taskId]);
    this.emit("update", { taskId, sessionId: task.session_id, status: "pending", output: "", error: "" });
    this.processQueue(task.session_id);
  }

  getTaskById(taskId: number): CodexTaskRecord | null {
    const rows = this.runSql("SELECT * FROM codex_tasks WHERE id = ?", [taskId]);
    return rows[0] || null;
  }

  getTasks(sessionId?: string, limit = 50, agentId?: string): CodexTaskRecord[] {
    if (sessionId && agentId) {
      return this.runSql(
        "SELECT * FROM codex_tasks WHERE session_id = ? AND agent_id = ? ORDER BY id DESC LIMIT ?",
        [sessionId, agentId, limit]
      );
    }
    if (sessionId) {
      return this.runSql("SELECT * FROM codex_tasks WHERE session_id = ? ORDER BY id DESC LIMIT ?", [sessionId, limit]);
    }
    if (agentId) {
      return this.runSql("SELECT * FROM codex_tasks WHERE agent_id = ? ORDER BY id DESC LIMIT ?", [agentId, limit]);
    }
    return this.runSql("SELECT * FROM codex_tasks ORDER BY id DESC LIMIT ?", [limit]);
  }

  getGitSummary() {
    const runGit = (args: string[]) => {
      try {
        return execFileSync("git", args, {
          cwd: this.projectRoot,
          encoding: "utf8",
          timeout: 4000,
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      } catch {
        return "";
      }
    };
    const remoteUrl = runGit(["remote", "get-url", "origin"]) || "https://github.com/Rush47/Bastilla_Ultimate";
    const branch = runGit(["branch", "--show-current"]) || "main";
    const statusShort = runGit(["status", "--short"]);
    const diffStat = runGit(["diff", "--stat"]);
    const logRaw = runGit(["log", "-n", "8", "--pretty=format:%h|%an|%ar|%s"]);

    const files = statusShort
      ? statusShort.split("\n").filter(Boolean).map((line) => {
          const code = line.slice(0, 2).trim() || "M";
          const filePath = line.slice(3).trim();
          return { status: code, path: filePath };
        })
      : [];

    const commits = logRaw
      ? logRaw.split("\n").filter(Boolean).map((line) => {
          const [hash = "", author = "", date = "", ...msgParts] = line.split("|");
          return { hash, author, date, message: msgParts.join("|") };
        })
      : [];

    return {
      repository: remoteUrl,
      branch,
      files,
      diffStat: diffStat || "Brak niezatwierdzonych różnic względem HEAD.",
      commits,
    };
  }
}


