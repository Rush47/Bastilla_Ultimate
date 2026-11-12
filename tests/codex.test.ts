import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexAuthManager, CodexError, parseDevicePrompt } from "../server/codex";

const projectRoot = path.resolve(import.meta.dirname, "..");
function setup(extra: NodeJS.ProcessEnv = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "bastilla-codex-"));
  const binary = path.join(home, "codex test.mjs");
  copyFileSync(path.join(import.meta.dirname, "fixtures/codex.mjs"), binary);
  chmodSync(binary, 0o755);
  const manager = new CodexAuthManager({ projectRoot, env: {
    ...process.env, OPENAI_API_KEY: "", CODEX_HOME: home,
    BASTILLA_CODEX_BIN: binary, ...extra,
  } });
  return { home, manager, cleanup: () => { manager.dispose(); rmSync(home, { recursive: true, force: true }); } };
}

async function until(predicate: () => Promise<boolean>) {
  for (let i = 0; i < 60; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("CLI state did not change");
}

test("device prompt parser accepts the official ANSI prompt and waits for complete output", () => {
  assert.equal(parseDevicePrompt("https://auth.openai.com/codex/device\nEnter this one-time code\nABCD-"), null);
  assert.equal(parseDevicePrompt("https://auth.openai.com/codex/device\nEnter this one-time code\nABCD-EFG"), null);
  assert.deepEqual(parseDevicePrompt("https://auth.openai.com/codex/device\nEnter this one-time code (expires in 15 minutes)\n\u001b[34mABCD-EFGHI\u001b[0m\n"), {
    verification_url: "https://auth.openai.com/codex/device", user_code: "ABCD-EFGHI",
  });
  assert.equal(parseDevicePrompt("https://example.com/codex/device\nEnter this one-time code\nABCD-EFGHI\n"), null);
});

test("missing CLI reports unavailable without creating a credential directory", async () => {
  const f = setup();
  try {
    const missingHome = path.join(f.home, "missing");
    const manager = new CodexAuthManager({ projectRoot, env: { CODEX_HOME: missingHome, BASTILLA_CODEX_BIN: path.join(f.home, "not-installed") } });
    const status = await manager.status();
    assert.equal(status.installed, false);
    assert.equal(status.auth_ready, false);
    assert.equal(status.login_status, "unavailable");
    assert.equal(existsSync(missingHome), false);
  } finally { f.cleanup(); }
});

test("a legacy fabricated token does not prove login and status leaves it and locks intact", async () => {
  const f = setup({ TEST_CODEX_ACCEPT_LEGACY: "true" });
  try {
    const credential = '{"access_token":"codex_tk_invalid","refresh_token":"codex_rf_invalid"}';
    writeFileSync(path.join(f.home, "auth.json"), credential);
    writeFileSync(path.join(f.home, "session.lock"), "active-session");
    const status = await f.manager.status();
    assert.equal(status.auth_ready, false);
    assert.equal(status.login_status, "invalid_credentials");
    assert.equal(status.has_auth_json, true);
    assert.equal(status.token_type, "NONE");
    assert.equal(readFileSync(path.join(f.home, "auth.json"), "utf8"), credential);
    assert.equal(readFileSync(path.join(f.home, "session.lock"), "utf8"), "active-session");
  } finally { f.cleanup(); }
});

test("a failed CLI exit cannot claim authentication even if its output says Logged in", async () => {
  const f = setup({ TEST_CODEX_STATUS_ERROR: "true" });
  try {
    const status = await f.manager.status();
    assert.equal(status.auth_ready, false);
    assert.equal(JSON.stringify(status).includes("do-not-return-this-secret"), false);
  } finally { f.cleanup(); }
});

test("environment API key travels through stdin and CLI output never exposes it", async () => {
  const key = "synthetic-private-key-for-regression";
  const f = setup({ OPENAI_API_KEY: key, TEST_CODEX_API_STATUS_CONFIGURED: "true" });
  try {
    assert.equal((await f.manager.status()).auth_ready, false);
    const status = await f.manager.useEnvironmentApiKey();
    assert.equal(status.auth_ready, true);
    assert.equal(status.token_type, "API_KEY");
    assert.equal(JSON.stringify(status).includes(key), false);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.home, "auth.json"), "utf8")), { OPENAI_API_KEY: key });
    const calls = readFileSync(path.join(f.home, "calls.jsonl"), "utf8");
    assert.equal(calls.includes(key), false);
    assert.match(calls, /--with-api-key/);
  } finally { f.cleanup(); }
});

test("API key failures and a missing server secret produce useful errors without leaking the key", async () => {
  const f = setup();
  const rejected = setup({ OPENAI_API_KEY: "synthetic-rejected-key", TEST_CODEX_API_KEY_ERROR: "true" });
  try {
    await assert.rejects(f.manager.useEnvironmentApiKey(), (e: CodexError) => e.status === 400);
    await assert.rejects(rejected.manager.useEnvironmentApiKey(), (e: CodexError) => e.status === 502 && !e.message.includes("synthetic-rejected-key"));
    assert.equal(existsSync(path.join(f.home, "auth.json")), false);
  } finally { f.cleanup(); rejected.cleanup(); }
});

test("device login is reused while pending and cancellation preserves existing credentials", async () => {
  const f = setup({ OPENAI_API_KEY: "synthetic-key" });
  try {
    writeFileSync(path.join(f.home, "auth.json"), "{}");
    f.manager.startDeviceLogin();
    f.manager.startDeviceLogin();
    await until(async () => (await f.manager.status()).login?.state === "pending");
    const status = await f.manager.status();
    assert.equal(status.login?.user_code, "ABCD-EFGHI");
    assert.equal(status.auth_ready, false);
    await assert.rejects(f.manager.useEnvironmentApiKey(), (e: CodexError) => e.status === 409);
    const calls = readFileSync(path.join(f.home, "calls.jsonl"), "utf8").split("\n").filter((line) => line.includes("--device-auth"));
    assert.equal(calls.length, 1);
    f.manager.cancelDeviceLogin();
    const cancelled = await f.manager.status();
    assert.equal(cancelled.login?.state, "cancelled");
    assert.equal(cancelled.login?.user_code, undefined);
    assert.equal(readFileSync(path.join(f.home, "auth.json"), "utf8"), "{}");
  } finally { f.cleanup(); }
});

test("completed device login is confirmed by a separate CLI status call", async () => {
  const f = setup({ TEST_CODEX_DEVICE_COMPLETE: "true" });
  try {
    f.manager.startDeviceLogin();
    await until(async () => (await f.manager.status()).login?.state === "complete");
    const status = await f.manager.status();
    assert.equal(status.auth_ready, true);
    assert.equal(status.token_type, "CHATGPT");
    assert.equal(status.login?.user_code, undefined);
    assert.equal(JSON.stringify(status).includes("synthetic-oauth-token"), false);
  } finally { f.cleanup(); }
});
