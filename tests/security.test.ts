import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { once } from "node:events";
import { installApiSecurity, redact } from "../server/security";

test("API requires authorization, supports an HttpOnly browser cookie, and rejects foreign origins", async () => {
  const previous = process.env.BASTILLA_API_TOKEN;
  process.env.BASTILLA_API_TOKEN = "synthetic-control-panel-access-token";
  const app = express();
  app.use(express.json()); installApiSecurity(app);
  app.get("/api/test", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(url + "/api/test")).status, 401);
    assert.equal((await fetch(url + "/api/test", { headers: { Authorization: `Bearer ${process.env.BASTILLA_API_TOKEN}` } })).status, 200);
    assert.equal((await fetch(url + "/api/test", { headers: { Origin: "https://foreign.example" } })).status, 403);
    assert.equal((await fetch(url + "/api/access/login", { method: "POST", body: "test" })).status, 415);
    const login = await fetch(url + "/api/access/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: process.env.BASTILLA_API_TOKEN }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    assert.equal((await fetch(url + "/api/test", { headers: { Cookie: cookie.split(";")[0] } })).status, 200);
    assert.equal(JSON.stringify(await login.json()).includes(process.env.BASTILLA_API_TOKEN), false);
    assert.equal(redact(`ghp_0123456789abcdef Bearer abc.def ${process.env.BASTILLA_API_TOKEN}`).includes("0123456789abcdef"), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.BASTILLA_API_TOKEN; else process.env.BASTILLA_API_TOKEN = previous;
  }
});
