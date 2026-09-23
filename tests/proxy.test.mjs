import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProxy } from "../proxy.mjs";

// A proxy on a random port with a fake upstream, so nothing leaves the machine.
async function start(upstream) {
  const logs = [];
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, init });
    return upstream ? upstream(url, init) : new Response('{"answers":{}}', { status: 200, headers: { "content-type": "application/json" } });
  };
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const server = createProxy({ port, fetchFn, log: (l) => logs.push(l) });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const req = (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
  return { port, req, logs, seen, close: () => new Promise((r) => server.close(r)) };
}

test("forwards allowlisted hosts with only the needed headers", async () => {
  const p = await start();
  const res = await p.req("/proxy/api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: "Bearer secret-key", "content-type": "application/json", cookie: "a=b", origin: "https://arnav1771.github.io" },
    body: '{"state":"x"}',
  });
  assert.equal(res.status, 200);
  assert.equal(p.seen[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.deepEqual(Object.keys(p.seen[0].init.headers).sort(), ["authorization", "content-type"]);
  assert.equal(p.seen[0].init.body.toString(), '{"state":"x"}');
  assert.equal(res.headers["access-control-allow-origin"], "https://arnav1771.github.io");
  await p.close();
});

test("never logs keys or bodies", async () => {
  const p = await start();
  await p.req("/proxy/api.cerebras.ai/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer secret-key" }, body: "private text" });
  const all = p.logs.join("\n");
  assert.ok(!all.includes("secret-key"));
  assert.ok(!all.includes("private text"));
  assert.match(all, /POST api\.cerebras\.ai\/v1\/chat\/completions -> 200/);
  await p.close();
});

test("refuses hosts outside the allowlist", async () => {
  const p = await start();
  for (const host of ["api.openai.com", "evil.example", "api.typesafe.ai.evil.example", "127.0.0.1"]) {
    const res = await p.req(`/proxy/${host}/x`, { method: "POST" });
    assert.equal(res.status, 403, host);
  }
  assert.equal(p.seen.length, 0);
  await p.close();
});

test("refuses foreign origins and foreign Host headers (DNS rebinding)", async () => {
  const p = await start();
  const o = await p.req("/proxy/api.typesafe.ai/v1/systemone", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(o.status, 403);
  const h = await p.req("/health", { headers: { host: "evil.example:80" } });
  assert.equal(h.status, 421);
  assert.equal(p.seen.length, 0);
  await p.close();
});

test("answers CORS preflight, including private-network access", async () => {
  const p = await start();
  const res = await p.req("/proxy/integrate.api.nvidia.com/v1/chat/completions", { method: "OPTIONS", headers: { origin: "https://arnav1771.github.io" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-private-network"], "true");
  assert.match(res.headers["access-control-allow-headers"], /authorization/);
  await p.close();
});

test("passes upstream errors and retry-after through", async () => {
  const p = await start(async () => new Response('{"detail":"slow down"}', { status: 429, headers: { "retry-after": "3", "content-type": "application/json", "set-cookie": "x=y" } }));
  const res = await p.req("/proxy/api.typesafe.ai/v1/systemone", { method: "POST", body: "{}" });
  assert.equal(res.status, 429);
  assert.equal(res.headers["retry-after"], "3");
  assert.equal(res.headers["set-cookie"], undefined);
  await p.close();
});

test("an unreachable upstream is a 502 with a readable message", async () => {
  const p = await start(async () => { throw new TypeError("fetch failed"); });
  const res = await p.req("/proxy/api.typesafe.ai/v1/systemone", { method: "POST", body: "{}" });
  assert.equal(res.status, 502);
  assert.match(JSON.parse(res.body).error.message, /Could not reach api\.typesafe\.ai/);
  await p.close();
});

test("rejects bodies over 2 MB", async () => {
  const p = await start();
  const res = await p.req("/proxy/api.typesafe.ai/v1/systemone", { method: "POST", body: "x".repeat(2 * 1024 * 1024 + 1) });
  assert.equal(res.status, 413);
  assert.equal(p.seen.length, 0);
  await p.close();
});

test("serves the app but not tests, dotfiles or anything outside the folder", async () => {
  const p = await start();
  const ok = await p.req("/");
  assert.equal(ok.status, 200);
  assert.match(ok.headers["content-type"], /text\/html/);
  assert.match(ok.body, /<title>Snap Judge<\/title>/);
  assert.equal((await p.req("/lib/schema.js")).status, 200);
  for (const path of ["/tests/proxy.test.mjs", "/.git/config", "/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/package-lock.json.bak", "/nope.html"]) {
    assert.equal((await p.req(path)).status, 404, path);
  }
  const health = JSON.parse((await p.req("/health")).body);
  assert.deepEqual(health.forwards.sort(), ["api.cerebras.ai", "api.typesafe.ai", "integrate.api.nvidia.com"]);
  await p.close();
});
