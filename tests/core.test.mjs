import test from "node:test";
import assert from "node:assert/strict";
import { validate, toJevRequest, retype, blankQuestion } from "../lib/schema.js";
import { buildPrompt, extractJson, checkAnswer, parseSample } from "../lib/judge.js";
import { aggregate, agreement, route, DEFAULT_THRESHOLDS } from "../lib/aggregate.js";
import { PROVIDERS, byId, endpoint, complete, callJev, listModels, withRetry, ProviderError } from "../lib/providers.js";
import { runLlm, runJev } from "../lib/run.js";
import { toCurl, toPython, toJs } from "../lib/export.js";
import { PRESETS } from "../lib/presets.js";

const doc = () => ({
  state: "My kettle arrived cracked and I was charged twice.",
  stateIsJson: false,
  questions: [
    { id: "dept", type: "choice", instructions: "Which team?", options: [
      { name: "returns", description: "Damaged items" }, { name: "billing", description: "" }] },
    { id: "angry", type: "score", instructions: "How frustrated?", levels: ["calm", "annoyed", "furious"] },
    { id: "refund", type: "noul", instructions: "Asks for a refund?", criteria: { true: "", false: "" } },
  ],
});

// ---------- schema ----------
test("every preset validates and builds a request", () => {
  for (const p of PRESETS) assert.deepEqual(validate(p.doc), [], p.id);
});

test("request matches the documented TypeSafe shape", () => {
  const r = toJevRequest(doc());
  assert.equal(r.model, "jev-latest");
  assert.equal(r.state, doc().state);
  assert.deepEqual(r.questions.dept, { type: "choice", instructions: "Which team?", criteria: { returns: "Damaged items", billing: null } });
  assert.deepEqual(r.questions.angry, { type: "score", instructions: "How frustrated?", criteria: ["calm", "annoyed", "furious"] });
  assert.deepEqual(r.questions.refund, { type: "noul", instructions: "Asks for a refund?" }, "empty noul criteria are left out");
});

test("noul criteria are sent when written, with the unwritten side null", () => {
  const d = doc();
  d.questions[2].criteria = { true: "Asks for money back", false: "" };
  assert.deepEqual(toJevRequest(d).questions.refund.criteria, { true: "Asks for money back", false: null });
});

test("JSON state is parsed and must be an object or array", () => {
  const d = doc();
  d.stateIsJson = true;
  d.state = '{"ticket": "hi"}';
  assert.deepEqual(toJevRequest(d).state, { ticket: "hi" });
  d.state = "42";
  assert.match(validate(d)[0].message, /object or an array/);
  d.state = "{nope";
  assert.match(validate(d)[0].message, /not valid JSON/);
});

test("limits: ids, duplicates, choice 2..255, score 2..10, empty fields", () => {
  const d = doc();
  d.questions[1].id = "dept";
  d.questions[0].options = [{ name: "only", description: "" }];
  d.questions[2].instructions = " ";
  const where = validate(d).map((e) => e.where);
  assert.ok(where.includes("q1.id"));
  assert.ok(where.includes("q0.options"));
  assert.ok(where.includes("q2.instructions"));

  const big = doc();
  big.questions[0].options = Array.from({ length: 256 }, (_, i) => ({ name: `o${i}`, description: "" }));
  assert.ok(validate(big).some((e) => /at most 255/.test(e.message)));
  big.questions[0].options.pop();
  assert.deepEqual(validate(big), []);

  const lv = doc();
  lv.questions[1].levels = Array.from({ length: 11 }, (_, i) => `l${i}`);
  assert.ok(validate(lv).some((e) => /2 to 10 levels/.test(e.message)));
  lv.questions[1].levels = ["one"];
  assert.ok(validate(lv).some((e) => /2 to 10 levels/.test(e.message)));

  const bad = doc();
  bad.questions[0].id = "1st";
  assert.ok(validate(bad).some((e) => e.where === "q0.id"));
  assert.ok(validate({ state: "x", questions: [] }).some((e) => e.where === "questions"));
});

test("retype keeps id and instructions, and brings back earlier options", () => {
  const q = doc().questions[0];
  const asNoul = retype(q, "noul");
  assert.equal(asNoul.id, "dept");
  assert.equal(asNoul.instructions, "Which team?");
  const back = retype(asNoul, "choice");
  assert.deepEqual(back.options, q.options);
  assert.equal(blankQuestion("score").levels.length, 3);
});

// ---------- prompt and parsing ----------
test("the prompt never contains question ids, only q1..qN", () => {
  const p = buildPrompt(doc());
  assert.ok(!/\bdept\b|\bangry\b|\brefund\b/.test(p.user.replace("Asks for a refund?", "")));
  assert.deepEqual(p.keys.map((k) => k.key), ["q1", "q2", "q3"]);
  assert.match(p.user, /q1 \(pick one\): Which team\?/);
  assert.match(p.user, /- returns: Damaged items/);
  assert.match(p.user, /- billing$/m);
  assert.match(p.user, /q2 \(level\)[\s\S]*0: calm[\s\S]*2: furious/);
  assert.match(p.user, /\{"q1":"returns","q2":0,"q3":true\}/);
});

test("extractJson tolerates fences, think blocks and prose, and nothing else", () => {
  assert.deepEqual(extractJson('```json\n{"q1": "a"}\n```'), { q1: "a" });
  assert.deepEqual(extractJson('<think>{"q1":"wrong"}</think>Sure: {"q1": "b", "s": "}"}'), { q1: "b", s: "}" });
  assert.deepEqual(extractJson('{broken} then {"q1": 1}'), { q1: 1 });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("[1,2]"), null);
  assert.equal(extractJson(null), null);
});

test("checkAnswer accepts only declared values", () => {
  const r = toJevRequest(doc()).questions;
  assert.deepEqual(checkAnswer(r.dept, "returns"), { value: "returns" });
  assert.deepEqual(checkAnswer(r.dept, " Billing "), { value: "billing" });
  assert.ok(checkAnswer(r.dept, "shipping").violation);
  assert.ok(checkAnswer(r.dept, 1).violation);
  assert.deepEqual(checkAnswer(r.angry, 2), { value: 2 });
  assert.deepEqual(checkAnswer(r.angry, "1"), { value: 1 });
  assert.ok(checkAnswer(r.angry, 3).violation);
  assert.ok(checkAnswer(r.angry, 1.5).violation);
  assert.ok(checkAnswer(r.angry, "furious").violation);
  assert.deepEqual(checkAnswer(r.refund, "yes"), { value: true });
  assert.deepEqual(checkAnswer(r.refund, false), { value: false });
  assert.ok(checkAnswer(r.refund, "maybe").violation);
  assert.equal(checkAnswer(r.refund, undefined).violation, "no answer");
});

test("parseSample maps q-keys back to ids and marks unparseable replies", () => {
  const p = buildPrompt(doc());
  const s = parseSample(p, '{"q1": "billing", "q2": 1, "q3": "no"}');
  assert.deepEqual(s.answers, { dept: { value: "billing" }, angry: { value: 1 }, refund: { value: false } });
  const bad = parseSample(p, "I think billing.");
  assert.equal(bad.parsed, false);
  assert.ok(Object.values(bad.answers).every((a) => a.violation));
});

// ---------- aggregation ----------
test("agreement is 1 for a unanimous vote and 0 for a flat one", () => {
  assert.equal(agreement([1, 0, 0]), 1);
  assert.ok(Math.abs(agreement([0.5, 0.5])) < 1e-9);
  assert.ok(Math.abs(agreement([1 / 3, 1 / 3, 1 / 3])) < 1e-9);
  const mid = agreement([0.8, 0.2, 0]);
  assert.ok(mid > 0 && mid < 1);
});

test("aggregate builds TypeSafe-shaped answers and excludes violations", () => {
  const r = toJevRequest(doc()).questions;
  const c = aggregate(r.dept, [{ value: "billing" }, { value: "billing" }, { value: "returns" }, { violation: "x" }]);
  assert.equal(c.answer.choice, "billing");
  assert.deepEqual(c.answer.probabilities, { returns: 0.333, billing: 0.667 });
  assert.equal(c.meta.valid, 3);
  assert.deepEqual(c.meta.violations, ["x"]);

  const s = aggregate(r.angry, [{ value: 1 }, { value: 2 }, { value: 2 }, { value: 1 }]);
  assert.equal(s.answer.score, 1.5, "probability-weighted, between levels");
  assert.deepEqual(s.answer.legend, { 0: "calm", 1: "annoyed", 2: "furious" });
  assert.deepEqual(s.answer.probabilities, { 0: 0, 1: 0.5, 2: 0.5 });

  const n = aggregate(r.refund, [{ value: true }, { value: true }, { value: false }, { value: true }]);
  assert.deepEqual(n.answer, { type: "noul", noul: 0.75 });

  assert.equal(aggregate(r.refund, [{ violation: "x" }]).answer, null);
  const tie = aggregate(r.dept, [{ value: "returns" }, { value: "billing" }]);
  assert.deepEqual(tie.meta.tie, ["returns", "billing"]);
});

test("routing follows the documented confidence-gated pattern", () => {
  const t = DEFAULT_THRESHOLDS;
  assert.equal(route({ type: "choice", confidence: 0.3 }, t).verdict, "human");
  assert.equal(route({ type: "choice", confidence: 0.7 }, t).verdict, "confirm");
  assert.equal(route({ type: "score", confidence: 0.9 }, t).verdict, "act");
  assert.equal(route({ type: "noul", noul: 0.95 }, t).verdict, "act");
  assert.equal(route({ type: "noul", noul: 0.1 }, t).verdict, "act");
  assert.equal(route({ type: "noul", noul: 0.5 }, t).verdict, "human");
  assert.equal(route(null, t).verdict, "human");
});

// ---------- providers ----------
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const { status = 200, json, text, headers = {} } = await handler(url, init, calls.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => (text !== undefined ? text : JSON.stringify(json)),
    };
  };
  fn.calls = calls;
  return fn;
}
const noSleep = { sleep: async () => {} };

test("registry: every provider has what the UI needs; ids are unique", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PROVIDERS) {
    assert.ok(p.label && p.wire, p.id);
    if (!p.custom && !p.local) assert.match(p.base, /^https:\/\//, p.id);
    if (!p.custom && p.id !== "lmstudio") assert.ok(p.model, `${p.id} has a default model`);
    if (p.model) assert.ok(p.models.includes(p.model), `${p.id} default is in its list`);
  }
  assert.deepEqual(PROVIDERS.filter((p) => p.proxy).map((p) => p.id).sort(), ["cerebras", "jev", "nvidia"]);
  assert.ok(PROVIDERS.length >= 18);
});

test("proxy-only providers are rewritten to the local proxy", () => {
  assert.equal(endpoint(byId("jev"), "/systemone", { proxy: "http://127.0.0.1:8787/" }),
    "http://127.0.0.1:8787/proxy/api.typesafe.ai/v1/systemone");
  assert.equal(endpoint(byId("nvidia"), "/chat/completions", { proxy: "" }),
    "/proxy/integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(endpoint(byId("groq"), "/chat/completions", { proxy: "http://x" }),
    "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(endpoint(byId("custom"), "/models", { base: "https://gw.example.com/v1/" }), "https://gw.example.com/v1/models");
});

test("openai wire: body, auth, JSON mode, usage", async () => {
  const f = fakeFetch(() => ({ json: { choices: [{ message: { content: '{"q1":"a"}' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } } }));
  const out = await complete(byId("groq"), { key: "k", model: "m" }, { system: "S", user: "U" }, { json: true, temperature: 1 }, f);
  assert.equal(out.text, '{"q1":"a"}');
  assert.equal(out.tokensIn, 10);
  const c = f.calls[0];
  assert.equal(c.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(c.init.headers.authorization, "Bearer k");
  assert.deepEqual(c.body.response_format, { type: "json_object" });
  assert.equal(c.body.temperature, 1);
  assert.deepEqual(c.body.messages.map((m) => m.role), ["system", "user"]);
});

test("local providers send no Authorization header without a key", async () => {
  const f = fakeFetch(() => ({ json: { choices: [{ message: { content: "{}" } }] } }));
  await complete(byId("ollama"), { model: "llama3.2", base: "http://localhost:11434/v1" }, { system: "S", user: "U" }, {}, f);
  assert.equal(f.calls[0].init.headers.authorization, undefined);
  assert.equal(f.calls[0].url, "http://localhost:11434/v1/chat/completions");
});

test("anthropic wire: headers for browser access, text blocks joined", async () => {
  const f = fakeFetch(() => ({ json: { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: '{"q1":' }, { type: "text", text: '"a"}' }], usage: { input_tokens: 5, output_tokens: 2 } } }));
  const out = await complete(byId("anthropic"), { key: "k", model: "m" }, { system: "S", user: "U" }, { temperature: 1.5 }, f);
  assert.equal(out.text, '{"q1":"a"}');
  const h = f.calls[0].init.headers;
  assert.equal(h["x-api-key"], "k");
  assert.equal(h["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(f.calls[0].body.temperature, 1, "clamped to Anthropic's maximum");
  assert.equal(f.calls[0].body.system, "S");
});

test("gemini wire: key in query, JSON mime type, thought parts skipped", async () => {
  const f = fakeFetch(() => ({ json: { candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text: '{"q1":"a"}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 } } }));
  const out = await complete(byId("gemini"), { key: "k&1", model: "gemini-3.5-flash-lite" }, { system: "S", user: "U" }, { json: true, temperature: 1 }, f);
  assert.equal(out.text, '{"q1":"a"}');
  assert.equal(f.calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=k%261");
  assert.equal(f.calls[0].body.generationConfig.responseMimeType, "application/json");
});

test("cohere wire: v2 chat and its usage shape", async () => {
  const f = fakeFetch(() => ({ json: { message: { content: [{ type: "text", text: "{}" }] }, usage: { tokens: { input_tokens: 9, output_tokens: 1 } } } }));
  const out = await complete(byId("cohere"), { key: "k", model: "command-a-03-2025" }, { system: "S", user: "U" }, { json: true }, f);
  assert.equal(f.calls[0].url, "https://api.cohere.com/v2/chat");
  assert.equal(out.tokensIn, 9);
});

test("errors carry status and the provider's own message", async () => {
  const f = fakeFetch(() => ({ status: 401, json: { error: { message: "Invalid API Key" } } }));
  await assert.rejects(complete(byId("openai"), { key: "bad", model: "m" }, { system: "", user: "" }, {}, f),
    (e) => e instanceof ProviderError && e.status === 401 && /refused: Invalid API Key/.test(e.message));
  const net = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(complete(byId("openai"), { key: "k", model: "m" }, { system: "", user: "" }, {}, net),
    (e) => e.status === 0 && /CORS/.test(e.message));
});

test("withRetry retries 429 and 529, honours retry-after, and stops on other errors", async () => {
  const waits = [];
  let n = 0;
  const v = await withRetry(async () => {
    n++;
    if (n < 3) throw new ProviderError("slow", { status: n === 1 ? 429 : 529, retryAfter: n === 1 ? "2" : null });
    return "ok";
  }, { sleep: async (ms) => waits.push(ms) });
  assert.equal(v, "ok");
  assert.deepEqual(waits, [2000, 1600]);
  let m = 0;
  await assert.rejects(withRetry(async () => { m++; throw new ProviderError("no", { status: 401 }); }, noSleep));
  assert.equal(m, 1);
});

test("listModels reads each provider's own list format", async () => {
  const g = fakeFetch(() => ({ json: { models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] } }));
  assert.deepEqual(await listModels(byId("gemini"), { key: "k" }, g), ["gemini-a"]);
  const o = fakeFetch(() => ({ json: { data: [{ id: "a" }, { id: "b" }] } }));
  assert.deepEqual(await listModels(byId("openrouter"), { key: "k" }, o), ["a", "b"]);
  const c = fakeFetch(() => ({ json: { models: [{ name: "command-a-03-2025" }] } }));
  assert.deepEqual(await listModels(byId("cohere"), { key: "k" }, c), ["command-a-03-2025"]);
});

// ---------- runs ----------
test("runLlm: N samples become a distribution; violations are counted", async () => {
  const replies = ['{"q1":"billing","q2":2,"q3":true}', '{"q1":"billing","q2":1,"q3":true}',
    '```json\n{"q1":"returns","q2":2,"q3":false}\n```', '{"q1":"shipping","q2":2,"q3":true}', "billing, I think"];
  const f = fakeFetch((url, init, i) => ({ json: { choices: [{ message: { content: replies[i - 1] } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } }));
  const r = await runLlm(byId("groq"), { key: "k", model: "m" }, doc(), { n: 5, concurrency: 1, fetchFn: f, ...noSleep });
  assert.equal(f.calls.length, 5);
  assert.equal(r.calls, 5);
  assert.equal(r.tokensIn, 500);
  const a = r.response.answers;
  assert.equal(a.dept.choice, "billing");
  assert.deepEqual(a.dept.probabilities, { returns: 0.333, billing: 0.667 });
  assert.equal(r.meta.dept.valid, 3);
  assert.equal(r.meta.dept.violations.length, 2);
  assert.equal(a.refund.noul, 0.75);
  assert.equal(a.angry.score, 1.75);
});

test("runLlm drops JSON mode and temperature once after a 400, and says so", async () => {
  const f = fakeFetch((url, init) => {
    const b = JSON.parse(init.body);
    if (b.response_format || b.temperature != null) return { status: 400, json: { error: { message: "response_format not supported" } } };
    return { json: { choices: [{ message: { content: '{"q1":"returns","q2":0,"q3":false}' } }] } };
  });
  const r = await runLlm(byId("openai"), { key: "k", model: "m" }, doc(), { n: 3, fetchFn: f, ...noSleep });
  assert.equal(f.calls.length, 4, "one refused call, then three plain ones");
  assert.equal(r.response.answers.dept.choice, "returns");
  assert.equal(r.notes.length, 1);
});

test("runLlm: a bad key fails once, not N times", async () => {
  const f = fakeFetch(() => ({ status: 401, json: { error: { message: "bad key" } } }));
  await assert.rejects(runLlm(byId("groq"), { key: "k", model: "m" }, doc(), { n: 5, fetchFn: f, ...noSleep }), /bad key/);
  assert.equal(f.calls.length, 1);
});

test("runLlm: later failures are reported, not fatal", async () => {
  const f = fakeFetch((u, i, n) => (n === 3 ? { status: 500, json: {} } : { json: { choices: [{ message: { content: '{"q1":"returns","q2":0,"q3":true}' } }] } }));
  const r = await runLlm(byId("groq"), { key: "k", model: "m" }, doc(), { n: 4, concurrency: 1, fetchFn: f, ...noSleep });
  assert.equal(r.samples.length, 3);
  assert.match(r.notes[0], /1 of 4 samples failed/);
});

test("runJev sends the exact request through the proxy and prices input tokens", async () => {
  const response = { model: "jev-1.13.0", answers: { dept: { type: "choice", choice: "billing", confidence: 0.4, probabilities: { returns: 0.35, billing: 0.65 } } }, usage: { input_tokens: 1_000_000, output_tokens: 20 } };
  const f = fakeFetch(() => ({ json: response }));
  const r = await runJev(byId("jev"), { key: "tk", model: "jev-latest", proxy: "http://127.0.0.1:8787" }, doc(), { fetchFn: f });
  assert.equal(f.calls[0].url, "http://127.0.0.1:8787/proxy/api.typesafe.ai/v1/systemone");
  assert.deepEqual(f.calls[0].body, toJevRequest(doc()));
  assert.equal(f.calls[0].init.headers.authorization, "Bearer tk");
  assert.equal(r.costUsd, 0.042);
  assert.deepEqual(r.response, response);
});

test("callJev refuses a reply without answers", async () => {
  const f = fakeFetch(() => ({ json: { detail: "x" } }));
  await assert.rejects(callJev(byId("jev"), { key: "k", proxy: "" }, {}, f), /without an answers object/);
});

// ---------- exports ----------
test("exports are complete and use the SDKs' documented names", () => {
  const d = doc();
  d.questions[2].criteria = { true: "Wants money back", false: "" };
  const curl = toCurl(d, "jev-latest");
  assert.match(curl, /^curl -X POST https:\/\/api\.typesafe\.ai\/v1\/systemone/);
  const body = curl.split("<<'EOF'\n")[1].split("\nEOF")[0];
  assert.deepEqual(JSON.parse(body), toJevRequest(d));

  const py = toPython(d, "jev-latest");
  assert.match(py, /^from typesafe_sdk import Choice, Noul, NoulCriteria, Score, TypeSafeClient$/m);
  assert.match(py, /"billing": None,/);
  assert.match(py, /criteria=NoulCriteria\(true="Wants money back", false=None\)/);
  assert.match(py, /client\.system_one\(/);

  const js = toJs(d, "jev-latest");
  assert.match(js, /^import \{ choice, noul, score, TypeSafeClient \} from "@typesafe-ai\/sdk";/);
  assert.match(js, /client\.systemOne\(\{/);
  assert.match(js, /"dept": choice\("Which team\?"/);
});
