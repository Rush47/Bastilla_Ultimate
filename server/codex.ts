import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
