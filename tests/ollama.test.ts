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

test("pickPreferredOllamaModel selects multimodal and Qwen chat models accurately", async () => {
  const { pickPreferredOllamaModel } = await import("../server/ollama.js");
  const models = [
    { name: "llama3.1:8b", sizeBytes: 4e9, sizeGb: "4.0 GB", parameterSize: "8B", family: "llama", modifiedAt: "", multimodal: false, uncensored: false },
    { name: "qwen2.5:14b", sizeBytes: 9e9, sizeGb: "9.0 GB", parameterSize: "14B", family: "qwen", modifiedAt: "", multimodal: false, uncensored: false },
    { name: "llava:13b", sizeBytes: 8e9, sizeGb: "8.0 GB", parameterSize: "13B", family: "llava", modifiedAt: "", multimodal: true, uncensored: false },
  ];
  assert.equal(pickPreferredOllamaModel(models, { multimodal: false }), "qwen2.5:14b");
  assert.equal(pickPreferredOllamaModel(models, { multimodal: true }), "llava:13b");
  assert.equal(pickPreferredOllamaModel([]), null);
});

test("probeOllamaStatus reports READY with real models and pullOllamaModelSafe rejects offline daemon", async () => {
  const { probeOllamaStatus, pullOllamaModelSafe } = await import("../server/ollama.js");
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/version") return res.end(JSON.stringify({ version: "0.6.5" }));
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b", size: 4700000000, details: { parameter_size: "7B", family: "qwen2" } }] }));
    if (req.url === "/api/ps") return res.end(JSON.stringify({ models: [{ name: "qwen2.5:7b", size: 4700000000 }] }));
    res.statusCode = 404;
    res.end("{}");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const status = await probeOllamaStatus(`http://127.0.0.1:${address.port}`);
    assert.equal(status.reachable, true);
    assert.equal(status.state, "READY");
    assert.deepEqual(status.modelNames, ["qwen2.5:7b"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const offlinePull = await pullOllamaModelSafe("http://127.0.0.1:1", "qwen2.5:7b");
  assert.equal(offlinePull.ok, false);
  assert.equal(offlinePull.status.state, "OFFLINE");
});

test("streamOllamaChat retries without tools when a local model does not support tool calling", async () => {
  const { streamOllamaChat } = await import("../server/ollama.js");
  const payloads: any[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body || "{}");
    payloads.push(parsed);
    if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "registry.ollama.ai/library/qwen2.5:0.5b does not support tools" }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: "qwen2.5:0.5b", message: { role: "assistant", content: "Odpowiedź bez tools." }, done: true }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    let streamed = "";
    const result = await streamOllamaChat({
      ollamaBaseUrl: `http://127.0.0.1:${address.port}`,
      model: "qwen2.5:0.5b",
      messages: [{ role: "user", content: "Cześć" }],
      signal: AbortSignal.timeout(5000),
      tools: [{ type: "function", function: { name: "sys_info", parameters: { type: "object", properties: {} } } }],
      onChunk: (d) => { streamed += d; },
    });
    assert.equal(result.text, "Odpowiedź bez tools.");
    assert.equal(result.model, "ollama/qwen2.5:0.5b");
    assert.equal(streamed, "Odpowiedź bez tools.");
    assert.equal(payloads.length, 2);
    assert.ok(Array.isArray(payloads[0].tools));
    assert.equal(payloads[1].tools, undefined);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
