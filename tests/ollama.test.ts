import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import path from "node:path";

const run = promisify(execFile);
const client = path.resolve(import.meta.dirname, "../distro/bastilla-overlay/ollama_cli.py");
test("Ollama client performs a real pull request and propagates service failure", async () => {
  let fail = false;
  const requests: object[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ route: req.url, body: JSON.parse(body || "{}") });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(fail ? { error: "model not found" } : { status: "success" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const env = { ...process.env, OLLAMA_BASE_URL: `http://127.0.0.1:${address.port}` };
    await run("python3", [client, "pull", "test-model"], { env });
    assert.deepEqual(requests, [{ route: "/api/pull", body: { name: "test-model", stream: false } }]);
    fail = true;
    await assert.rejects(run("python3", [client, "pull", "missing"], { env }), error => {
      assert.equal((error as any).code, 1);
      assert.equal((error as any).stdout.includes("success"), false);
      return true;
    });
    await assert.rejects(run("python3", [client, "--version"], { env: { ...process.env, OLLAMA_BASE_URL: "http://127.0.0.1:1" } }));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
