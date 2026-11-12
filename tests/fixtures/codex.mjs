#!/usr/bin/env node
// Isolated CLI double. Its credentials and responses are synthetic test data.
import fs from "node:fs";
import path from "node:path";

const home = process.env.CODEX_HOME;
if (!home) process.exit(2);
fs.mkdirSync(home, { recursive: true });
const args = process.argv.slice(2);
fs.appendFileSync(path.join(home, "calls.jsonl"), JSON.stringify(args) + "\n");
const authPath = path.join(home, "auth.json");
if (args[0] === "--version") {
  console.log("codex-cli 0.167.2-test");
} else if (args.join(" ") === "login status") {
  if (process.env.TEST_CODEX_STATUS_ERROR === "true") {
    console.error("Logged in using an API key - do-not-return-this-secret");
    process.exit(1);
  }
  let auth = {};
  try { auth = JSON.parse(fs.readFileSync(authPath, "utf8")); } catch {}
  if (auth.OPENAI_API_KEY) {
    console.error(`${process.env.TEST_CODEX_API_STATUS_CONFIGURED === "true" ? "API key configured" : "Logged in using an API key"} - ${auth.OPENAI_API_KEY}`);
  } else if (auth.access_token && process.env.TEST_CODEX_ACCEPT_LEGACY === "true") {
    console.error("Logged in using ChatGPT");
  } else if (auth.tokens?.access_token === "synthetic-oauth-token") {
    console.error("Logged in using ChatGPT");
  } else {
    console.error("Not logged in");
    process.exit(1);
  }
} else if (args.join(" ") === "login --with-api-key") {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (process.env.TEST_CODEX_API_KEY_ERROR === "true") {
    console.error(`Rejected private key ${input.trim()}`);
    process.exit(1);
  }
  fs.writeFileSync(authPath, JSON.stringify({ OPENAI_API_KEY: input.trim() }), { mode: 0o600 });
  console.log(`Success: ${input.trim()}`);
} else if (args.join(" ") === "login --device-auth") {
  console.log("Welcome to Codex\nhttps://auth.openai.com/codex/device");
  process.stdout.write("Enter this one-time code (expires in 15 minutes)\n\u001b[34mABCD-");
  setTimeout(() => process.stdout.write("EFGHI\u001b[0m\n"), 10);
  const interval = setInterval(() => {}, 1000);
  if (process.env.TEST_CODEX_DEVICE_COMPLETE === "true") {
    setTimeout(() => {
      fs.writeFileSync(authPath, JSON.stringify({ tokens: { access_token: "synthetic-oauth-token" } }));
      clearInterval(interval);
    }, 200);
  }
} else if (args[0] === "exec") {
  const promptArgs = args.slice(1).join(" ").trim();
  let stdinText = "";
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      stdinText += chunk;
    }
  }
  const taskPrompt = promptArgs || stdinText.trim();
  if (!taskPrompt) {
    console.error("Error: missing prompt for codex exec");
    process.exit(1);
  }
  const sleepMs = Number(process.env.TEST_CODEX_EXEC_SLEEP_MS || 30);
  process.stdout.write(`[codex exec] Rozpoczynanie zadania: ${taskPrompt}\n`);
  await new Promise((r) => setTimeout(r, sleepMs));
  if (/FAIL_TASK/i.test(taskPrompt)) {
    process.stderr.write(`[codex exec] Błąd wykonania zadania: ${taskPrompt}\n`);
    process.exit(1);
  }
  process.stdout.write(`[codex exec] Zakończono pomyślnie: ${taskPrompt}\n`);
  process.exit(0);
} else {
  process.exitCode = 2;
}

