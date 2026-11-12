import { createHash, timingSafeEqual } from "node:crypto";
import type { Express } from "express";

// Apply to stored results and responses, including errors produced by subprocesses.
export function redact(text: string): string {
  let result = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)$/i.test(name) && value && value.length >= 8) {
      result = result.split(value).join("[REDACTED]");
    }
  }
  return result
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[REDACTED]")
    .replace(/\b(?:sk-[\w-]{10,}|gh[pousr]_[\w]{10,}|github_pat_[\w]{10,})/g, "[REDACTED]")
    .replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(/("(?:access_token|refresh_token|api_key|OPENAI_API_KEY)"\s*:\s*")[^"]*/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

export function installApiSecurity(app: Express) {
  const token = process.env.BASTILLA_API_TOKEN || "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const valid = (value: string) => Boolean(token) && timingSafeEqual(digest(value), digest(token));
  app.use("/api", (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (value) => value === undefined ? json(value) : json(JSON.parse(redact(JSON.stringify(value))));
    // JSON-only writes and same-origin cookies prevent cross-site command execution.
    const origin = req.headers.origin;
    const forwardedHost = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    const appUrlOrigin = process.env.APP_URL?.replace(/\/$/, "") || "";
    const allowedOrigins = (process.env.BASTILLA_ALLOWED_ORIGINS || "")
      .split(",")
      .map(s => s.trim().replace(/\/$/, ""))
      .filter(Boolean);

    if (origin) {
      let originHost = "";
      try { originHost = new URL(origin).host; } catch {}
      const sameHost = Boolean(originHost && forwardedHost && originHost === forwardedHost);
      const explicitlyAllowed =
        (Boolean(appUrlOrigin) && origin === appUrlOrigin) ||
        allowedOrigins.includes(origin);

      if (!sameHost && !explicitlyAllowed) {
        return res.status(403).json({ ok: false, error: "Niedozwolone źródło żądania." });
      }
      if (explicitlyAllowed || sameHost) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
        res.setHeader("Vary", "Origin");
      }
    }
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json")) {
      return res.status(415).json({ ok: false, error: "Wymagany Content-Type: application/json." });
    }
    if (req.path === "/access/login" && req.method === "POST") {
      if (!valid(String(req.body?.token || ""))) return res.status(401).json({ ok: false, error: "Nieautoryzowane." });
      res.cookie("bastilla_access", token, {
        httpOnly: true, sameSite: "strict", secure: req.secure || process.env.APP_URL?.startsWith("https://"),
        maxAge: 12 * 60 * 60 * 1000, path: "/api",
      });
      return res.json({ ok: true });
    }
    const appUrlHostname = (() => {
      try { return appUrlOrigin ? new URL(appUrlOrigin).hostname : ""; } catch { return ""; }
    })();
    const isLocalOrPreviewHost =
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(req.hostname) ||
      (Boolean(appUrlHostname) && req.hostname === appUrlHostname) ||
      /\.run\.app$/i.test(req.hostname);

    if (token) {
      const bearer = req.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
      const cookie = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("bastilla_access="))?.slice(16) || "";
      let decoded = "";
      try { decoded = decodeURIComponent(cookie); } catch {}
      if (!valid(bearer) && !valid(decoded)) return res.status(401).json({ ok: false, error: "Nieautoryzowane." });
    } else if (!isLocalOrPreviewHost) {
      return res.status(403).json({ ok: false, error: "Dostęp zdalny wymaga BASTILLA_API_TOKEN." });
    }
    next();
  });
}
