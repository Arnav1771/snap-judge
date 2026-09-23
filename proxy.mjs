#!/usr/bin/env node
// Snap Judge local proxy. Zero dependencies; Node 18+.
//
//   node proxy.mjs            -> http://127.0.0.1:8787
//   PORT=9000 node proxy.mjs
//
// Why it exists: TypeSafe, NVIDIA and Cerebras refuse requests from a browser
// page (no CORS headers), so a static site cannot call them. This forwards
// exactly those three hosts and nothing else.
//
// What it will not do:
//   - listen on anything but 127.0.0.1
//   - forward to any host outside ALLOW
//   - answer a Host header other than its own (blocks DNS-rebinding pages)
//   - send CORS headers to an origin outside ORIGINS
//   - log a key, a header or a body (only method, host, path, status, time)
//
// It also serves the app from this folder, so http://127.0.0.1:8787 is a
// complete local copy where every provider works.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOW = new Set(["api.typesafe.ai", "integrate.api.nvidia.com", "api.cerebras.ai"]);
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MAX_BODY = 2 * 1024 * 1024; // TypeSafe's 64k-token context fits well inside this
const TIMEOUT_MS = 90_000;
const FORWARD_REQ = ["authorization", "content-type", "accept"];
const FORWARD_RES = ["content-type", "retry-after", "x-request-id"];
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

export function createProxy({ port, extraOrigins = [], fetchFn = fetch, log = console.log } = {}) {
  const selfHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([
    "https://arnav1771.github.io",
    `http://127.0.0.1:${port}`, `http://localhost:${port}`,
    ...extraOrigins,
  ]);

  const cors = (req) => {
    const o = req.headers.origin;
    if (!o || !origins.has(o)) return {};
    return {
      "access-control-allow-origin": o,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, accept",
      "access-control-allow-private-network": "true",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  };

  const reply = (res, status, headers, body) => {
    res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
    res.end(body);
  };

  return http.createServer(async (req, res) => {
    const started = Date.now();
    // The query string is never logged: some APIs take a key there.
    const done = (status, host = "", path = (req.url || "").split("?")[0]) =>
      log(`${req.method} ${host}${path} -> ${status} ${Date.now() - started}ms`);

    if (!selfHosts.has(req.headers.host || "")) {
      reply(res, 421, { "content-type": "text/plain" }, "Unknown host.");
      return done(421);
    }
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      reply(res, 403, { "content-type": "text/plain" }, "This origin may not use the proxy.");
      return done(403);
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      if (req.method === "OPTIONS") {
        reply(res, 204, cors(req), "");
        return done(204);
      }
      reply(res, 200, { ...cors(req), "content-type": "application/json" },
        JSON.stringify({ ok: true, app: "snap-judge-proxy", forwards: [...ALLOW] }));
      return done(200);
    }

    if (url.pathname.startsWith("/proxy/")) {
      const rest = url.pathname.slice("/proxy/".length);
      const slash = rest.indexOf("/");
      const host = slash === -1 ? rest : rest.slice(0, slash);
      const path = slash === -1 ? "/" : rest.slice(slash);
      if (!ALLOW.has(host)) {
        reply(res, 403, { ...cors(req), "content-type": "text/plain" }, `Only ${[...ALLOW].join(", ")} are forwarded.`);
        return done(403, host, path);
      }
      if (req.method === "OPTIONS") {
        reply(res, 204, cors(req), "");
        return done(204, host, path);
      }
      if (req.method !== "GET" && req.method !== "POST") {
        reply(res, 405, { ...cors(req), "content-type": "text/plain" }, "GET and POST only.");
        return done(405, host, path);
      }

      const chunks = [];
      let size = 0;
      try {
        for await (const c of req) {
          size += c.length;
          if (size > MAX_BODY) throw new Error("too large");
          chunks.push(c);
        }
      } catch {
        reply(res, 413, { ...cors(req), "content-type": "text/plain" }, "Request body over 2 MB.");
        return done(413, host, path);
      }

      const headers = {};
      for (const h of FORWARD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
      try {
        const upstream = await fetchFn(`https://${host}${path}${url.search}`, {
          method: req.method,
          headers,
          body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const out = { ...cors(req) };
        for (const h of FORWARD_RES) {
          const v = upstream.headers.get(h);
          if (v) out[h] = v;
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        reply(res, upstream.status, out, body);
        return done(upstream.status, host, path);
      } catch (e) {
        const timedOut = e?.name === "TimeoutError";
        reply(res, timedOut ? 504 : 502, { ...cors(req), "content-type": "application/json" },
          JSON.stringify({ error: { message: timedOut ? `${host} did not answer within ${TIMEOUT_MS / 1000}s.` : `Could not reach ${host}.` } }));
        return done(timedOut ? 504 : 502, host, path);
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      reply(res, 405, { "content-type": "text/plain" }, "GET only.");
      return done(405);
    }
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      reply(res, 400, { "content-type": "text/plain" }, "Bad path.");
      return done(400);
    }
    if (rel.endsWith("/")) rel += "index.html";
    const file = normalize(join(ROOT, rel));
    const hidden = rel.split("/").some((part) => part.startsWith("."));
    if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep) || hidden || !TYPES[extname(file)] ||
        /(^|\/)(node_modules|tests)(\/|$)/.test(rel)) {
      reply(res, 404, { "content-type": "text/plain" }, "Not found.");
      return done(404);
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error("not a file");
      const body = await readFile(file);
      reply(res, 200, { "content-type": TYPES[extname(file)] }, req.method === "HEAD" ? "" : body);
      return done(200);
    } catch {
      reply(res, 404, { "content-type": "text/plain" }, "Not found.");
      return done(404);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 8787);
  const extra = (process.env.SNAPJUDGE_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  createProxy({ port, extraOrigins: extra }).listen(port, "127.0.0.1", () => {
    console.log(`Snap Judge on http://127.0.0.1:${port}  (forwarding only ${[...ALLOW].join(", ")})`);
  });
}
