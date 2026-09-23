import { validate, toJevRequest, blankQuestion, retype, LIMITS } from "./lib/schema.js";
import { PROVIDERS, byId, listModels } from "./lib/providers.js";
import { runJev, runLlm } from "./lib/run.js";
import { route, DEFAULT_THRESHOLDS } from "./lib/aggregate.js";
import { toCurl, toPython, toJs } from "./lib/export.js";
import { PRESETS } from "./lib/presets.js";

// ---------- storage (every access may throw in a private window) ----------
const store = {
  get(area, k, fallback) {
    try {
      const v = window[area].getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(area, k, v) {
    try { window[area].setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
  del(area, k) {
    try { window[area].removeItem(k); } catch { /* storage unavailable */ }
  },
};

const clone = (x) => JSON.parse(JSON.stringify(x));
const FEATURED = ["jev", "openrouter", "gemini", "groq", "openai", "anthropic"];
const loopback = ["127.0.0.1", "localhost"].includes(location.hostname);

const remember = store.get("localStorage", "sj.remember", false);
const keys = store.get(remember ? "localStorage" : "sessionStorage", "sj.keys", {});
const savedProv = store.get("localStorage", "sj.prov", {});

const S = {
  presetId: store.get("localStorage", "sj.preset", PRESETS[0].id),
  doc: store.get("localStorage", "sj.doc", null) || clone(PRESETS[0].doc),
  prov: Object.fromEntries(PROVIDERS.map((p) => {
    const s = savedProv[p.id] || {};
    return [p.id, {
      on: s.on ?? false,
      model: s.model ?? p.model,
      base: s.base ?? p.base,
      key: keys[p.id] || "",
      open: false,
      models: null,
      error: "",
    }];
  })),
  showAll: false,
  settings: {
    n: 5, temp: 1, conc: 3, ...DEFAULT_THRESHOLDS,
    proxy: loopback ? location.origin : "http://127.0.0.1:8787",
    remember,
    ...store.get("localStorage", "sj.settings", {}),
  },
  fmt: "json",
  run: null,
};
S.settings.remember = remember;

const $ = (sel) => document.querySelector(sel);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.setAttribute("style", v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function toast(msg) {
  const t = h("div", { class: "toast", role: "status", text: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

// ---------- persistence ----------
function saveDoc() {
  store.set("localStorage", "sj.doc", S.doc);
  store.set("localStorage", "sj.preset", S.presetId);
}
function saveProv() {
  const out = {};
  const k = {};
  for (const p of PROVIDERS) {
    const s = S.prov[p.id];
    out[p.id] = { on: s.on, model: s.model, base: s.base };
    if (s.key) k[p.id] = s.key;
  }
  store.set("localStorage", "sj.prov", out);
  if (S.settings.remember) {
    store.set("localStorage", "sj.keys", k);
    store.del("sessionStorage", "sj.keys");
  } else {
    store.set("sessionStorage", "sj.keys", k);
    store.del("localStorage", "sj.keys");
  }
}
function saveSettings() {
  const { remember: _r, ...rest } = S.settings;
  store.set("localStorage", "sj.settings", rest);
  store.set("localStorage", "sj.remember", S.settings.remember);
}

// ---------- the Ask column ----------
function renderPresets() {
  const sel = $("#preset");
  sel.replaceChildren(
    ...PRESETS.map((p) => h("option", { value: p.id, text: p.label, selected: p.id === S.presetId })),
    h("option", { value: "blank", text: "Blank", selected: S.presetId === "blank" }),
  );
  const p = PRESETS.find((x) => x.id === S.presetId);
  $("#pattern").textContent = p ? p.pattern : "";
}

function loadPreset(id) {
  S.presetId = id;
  const p = PRESETS.find((x) => x.id === id);
  S.doc = p ? clone(p.doc) : { state: "", stateIsJson: false, questions: [blankQuestion("noul", 1)] };
  saveDoc();
  renderAll();
}

function renderState() {
  $("#state").value = S.doc.state;
  $("#state-json").checked = Boolean(S.doc.stateIsJson);
}

function field(where, el) {
  el.dataset.where = where;
  return el;
}

function renderQuestions() {
  const box = $("#questions");
  box.replaceChildren(...S.doc.questions.map((q, i) => questionCard(q, i)));
}

function questionCard(q, i) {
  const at = `q${i}`;
  const touch = () => { saveDoc(); refresh(); };
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Question type" },
    ...["noul", "choice", "score"].map((t) => h("button", {
      type: "button", "aria-pressed": String(q.type === t), text: t,
      onclick: () => { S.doc.questions[i] = retype(q, t); saveDoc(); renderQuestions(); refresh(); },
    })));

  const head = h("div", { class: "q-head" },
    field(`${at}.id`, h("input", {
      type: "text", class: "id", value: q.id, "aria-label": "Question id", spellcheck: "false",
      oninput: (e) => { q.id = e.target.value; touch(); },
    })),
    seg,
    h("button", { type: "button", class: "btn icon ghost", title: "Move up", "aria-label": "Move question up", disabled: i === 0,
      onclick: () => { move(S.doc.questions, i, -1); saveDoc(); renderQuestions(); refresh(); }, text: "↑" }),
    h("button", { type: "button", class: "btn icon ghost danger", title: "Remove", "aria-label": `Remove question ${q.id}`,
      onclick: () => { S.doc.questions.splice(i, 1); saveDoc(); renderQuestions(); refresh(); }, text: "✕" }),
  );

  const instr = field(`${at}.instructions`, h("textarea", {
    rows: "2", "aria-label": "Instructions", placeholder: q.type === "noul" ? "A yes/no question, or a statement to judge" : "The question the model answers",
    oninput: (e) => { q.instructions = e.target.value; touch(); },
  }));
  instr.value = q.instructions;

  let body;
  if (q.type === "noul") {
    q.criteria = q.criteria || { true: "", false: "" };
    body = h("div", { class: "rows" },
      h("span", { class: "sub", text: "Optional: what counts as yes and as no." }),
      ...["true", "false"].map((k) => h("div", { class: "row noul" },
        h("span", { class: "tag", text: k }),
        h("input", { type: "text", value: q.criteria[k] || "", "aria-label": `What ${k} means`, placeholder: k === "true" ? "A yes means..." : "A no means...",
          oninput: (e) => { q.criteria[k] = e.target.value; touch(); } }))));
  } else if (q.type === "choice") {
    body = h("div", { class: "rows" },
      h("span", { class: "sub", text: `Options (${q.options.length} of at most ${LIMITS.choiceMax}). A description is optional but sharpens the boundary.` }),
      ...q.options.map((o, j) => h("div", { class: "row" },
        h("input", { type: "text", class: "mono", value: o.name, placeholder: "option_name", "aria-label": `Option ${j + 1} name`, spellcheck: "false",
          oninput: (e) => { o.name = e.target.value; touch(); } }),
        h("input", { type: "text", class: "desc", value: o.description || "", placeholder: "What this option covers", "aria-label": `Option ${j + 1} description`,
          oninput: (e) => { o.description = e.target.value; touch(); } }),
        h("div", { class: "tools" },
          h("button", { type: "button", class: "btn icon ghost danger", "aria-label": `Remove option ${j + 1}`, text: "✕", disabled: q.options.length <= 1,
            onclick: () => { q.options.splice(j, 1); saveDoc(); renderQuestions(); refresh(); } })))),
      q.options.length < LIMITS.choiceMax && h("button", { type: "button", class: "linkish", text: "+ Add option",
        onclick: () => { q.options.push({ name: "", description: "" }); saveDoc(); renderQuestions(); refresh(); } }),
    );
  } else {
    body = h("div", { class: "rows" },
      h("span", { class: "sub", text: `Levels, lowest first (${q.levels.length}; ${LIMITS.scoreMin} to ${LIMITS.scoreMax}). The model sees only these descriptions.` }),
      ...q.levels.map((lv, j) => h("div", { class: "row level" },
        h("span", { class: "n", text: String(j) }),
        h("input", { type: "text", value: lv, placeholder: `What level ${j} looks like`, "aria-label": `Level ${j}`,
          oninput: (e) => { q.levels[j] = e.target.value; touch(); } }),
        h("div", { class: "tools" },
          h("button", { type: "button", class: "btn icon ghost", "aria-label": `Move level ${j} up`, text: "↑", disabled: j === 0,
            onclick: () => { move(q.levels, j, -1); saveDoc(); renderQuestions(); refresh(); } }),
          h("button", { type: "button", class: "btn icon ghost danger", "aria-label": `Remove level ${j}`, text: "✕", disabled: q.levels.length <= LIMITS.scoreMin,
            onclick: () => { q.levels.splice(j, 1); saveDoc(); renderQuestions(); refresh(); } })))),
      q.levels.length < LIMITS.scoreMax && h("button", { type: "button", class: "linkish", text: "+ Add level",
        onclick: () => { q.levels.push(""); saveDoc(); renderQuestions(); refresh(); } }),
    );
  }

  return h("div", { class: "card q", "data-q": String(i) },
    head, h("p", { class: "err", "data-err": `${at}.id` }),
    instr, h("p", { class: "err", "data-err": `${at}.instructions` }),
    body,
    h("p", { class: "err", "data-err": `${at}.options` }),
    h("p", { class: "err", "data-err": `${at}.levels` }),
    h("p", { class: "err", "data-err": `${at}.type` }),
  );
}

function move(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function refreshErrors() {
  const errs = validate(S.doc);
  document.querySelectorAll("[data-err]").forEach((el) => { el.textContent = ""; });
  document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  for (const e of errs) {
    const slot = document.querySelector(`[data-err="${e.where}"]`);
    if (slot) slot.textContent = slot.textContent ? `${slot.textContent} ${e.message}` : e.message;
    const input = e.where === "state" ? $("#state") : document.querySelector(`[data-where="${e.where}"]`);
    if (input && input.tagName !== "SPAN") input.classList.add("invalid");
  }
  return errs;
}

function renderExport() {
  const errs = validate(S.doc);
  const model = S.prov.jev.model || "jev-latest";
  let code;
  if (errs.length) code = "Fix the fields marked in red to see the request.";
  else if (S.fmt === "json") code = JSON.stringify(toJevRequest(S.doc, model), null, 2);
  else if (S.fmt === "curl") code = toCurl(S.doc, model);
  else if (S.fmt === "python") code = toPython(S.doc, model);
  else code = toJs(S.doc, model);
  $("#export-code").textContent = code;
  document.querySelectorAll("#export-tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.fmt === S.fmt)));
}

function refresh() {
  refreshErrors();
  renderExport();
}

// ---------- the Run column ----------
function renderProviders() {
  const visible = PROVIDERS.filter((p) => S.showAll || FEATURED.includes(p.id) || S.prov[p.id].on);
  const hidden = PROVIDERS.length - visible.length;
  const box = $("#providers");
  box.replaceChildren(
    ...visible.map(providerCard),
    h("button", { type: "button", class: "btn ghost small more-toggle",
      text: S.showAll ? "Show fewer providers" : `Show ${hidden} more providers`,
      onclick: () => { S.showAll = !S.showAll; renderProviders(); } }),
  );
  const on = PROVIDERS.filter((p) => S.prov[p.id].on).length;
  $("#enabled-count").textContent = on ? `${on} selected` : "Pick at least one";
}

function providerCard(p) {
  const s = S.prov[p.id];
  const listId = `models-${p.id}`;
  const badges = [
    p.proxy && h("span", { class: "badge", text: "via local proxy" }),
    p.local && h("span", { class: "badge", text: "on your machine" }),
    p.id === "jev" && h("span", { class: "badge accent", text: "real System One" }),
  ];
  const needsKey = !p.local;

  const body = h("div", { class: "prov-body" },
    p.note && h("p", { class: "note", text: p.note }),
    (p.local || p.custom) && h("label", { class: "lbl" }, p.custom ? "Base URL (ending in /v1)" : "Server URL",
      h("input", { type: "url", value: s.base, placeholder: "https://example.com/v1", spellcheck: "false",
        oninput: (e) => { s.base = e.target.value.trim(); saveProv(); } })),
    needsKey && h("label", { class: "lbl" }, p.custom ? "Key (if the server needs one)" : "API key",
      h("input", { type: "password", value: s.key, autocomplete: "off", spellcheck: "false",
        placeholder: p.keyUrl ? "Paste your key" : "",
        oninput: (e) => { s.key = e.target.value.trim(); saveProv(); } })),
    h("div", { class: "prov-row" },
      h("label", { class: "lbl grow" }, "Model",
        h("input", { type: "text", value: s.model, list: listId, spellcheck: "false", placeholder: "model id",
          oninput: (e) => { s.model = e.target.value.trim(); saveProv(); head.querySelector(".prov-model").textContent = s.model; } })),
      p.wire !== "jev" && h("button", { type: "button", class: "btn small", text: "Load models",
        onclick: (e) => loadModels(p, e.target) }),
    ),
    h("datalist", { id: listId }, ...(s.models || p.models).map((m) => h("option", { value: m }))),
    s.error && h("p", { class: "err", text: s.error }),
    p.keyUrl && h("a", { href: p.keyUrl, target: "_blank", rel: "noopener", class: "sub", text: needsKey ? "Get a key ↗" : "Download ↗" }),
  );

  const check = h("input", { type: "checkbox", checked: s.on, "aria-label": `Run on ${p.label}`,
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => { s.on = e.target.checked; if (s.on) s.open = true; saveProv(); renderProviders(); } });
  const head = h("div", { class: "prov-head", role: "button", tabindex: "0", "aria-expanded": String(s.open),
    onclick: () => { s.open = !s.open; renderProviders(); },
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.open = !s.open; renderProviders(); } } },
    check,
    h("span", { class: "prov-name", text: p.label }),
    h("span", { class: "prov-model", text: s.model }),
    ...badges,
    h("span", { class: "chev", "aria-hidden": "true", text: "›" }));

  return h("div", { class: `card prov${s.open ? " open" : ""}${s.on ? " on" : ""}` }, head, body);
}

function cfgFor(p) {
  const s = S.prov[p.id];
  return { key: s.key, model: s.model, base: s.base, proxy: S.settings.proxy };
}

async function loadModels(p, btn) {
  const s = S.prov[p.id];
  if (!p.local && !p.custom && !s.key) {
    s.error = "Paste a key first; model lists need one.";
    return renderProviders();
  }
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const ids = await listModels(p, cfgFor(p));
    s.models = ids.sort();
    s.error = ids.length ? "" : "The provider returned an empty list.";
    toast(`${p.label}: ${ids.length} models loaded`);
  } catch (e) {
    s.error = e.message;
  }
  renderProviders();
}

// ---------- running ----------
async function run() {
  const errs = refreshErrors();
  if (errs.length) {
    $("#run-status").textContent = "Fix the fields marked in red first.";
    document.querySelector(".invalid")?.focus();
    return;
  }
  const chosen = PROVIDERS.filter((p) => S.prov[p.id].on);
  if (!chosen.length) {
    $("#run-status").textContent = "Pick at least one provider to run on.";
    return;
  }

  const doc = clone(S.doc);
  const settings = { ...S.settings };
  S.run = { doc, at: new Date().toISOString(), order: chosen.map((p) => p.id), res: {} };
  for (const p of chosen) S.run.res[p.id] = { status: "running", done: 0, n: p.wire === "jev" ? 1 : settings.n, model: S.prov[p.id].model };

  const btn = $("#run");
  btn.disabled = true;
  $("#run-status").textContent = `Running on ${chosen.length} provider${chosen.length > 1 ? "s" : ""}…`;
  renderResults();

  await Promise.all(chosen.map(async (p) => {
    const r = S.run.res[p.id];
    const cfg = cfgFor(p);
    try {
      if (!p.local && !p.custom && !cfg.key) throw new Error("No key. Open this provider and paste one.");
      if (!cfg.model) throw new Error("No model. Type a model id or use Load models.");
      if ((p.custom || p.local) && !cfg.base) throw new Error("No server URL.");
      const result = p.wire === "jev"
        ? await runJev(p, cfg, doc)
        : await runLlm(p, cfg, doc, {
          n: settings.n, temperature: settings.temp, concurrency: settings.conc,
          onSample: () => { r.done++; renderSummary(); },
        });
      Object.assign(r, { status: "done", result });
    } catch (e) {
      let msg = e.message;
      if (p.proxy && e.status === 0) msg += ` ${p.label} needs the local proxy: run "node proxy.mjs" and check the proxy address in Settings.`;
      else if (p.local && e.status === 0) msg += ` Is ${p.label} running at ${cfg.base}? Its server must allow this page's origin.`;
      Object.assign(r, { status: "error", error: msg });
    }
    renderResults();
  }));

  btn.disabled = false;
  const ok = Object.values(S.run.res).filter((r) => r.status === "done").length;
  $("#run-status").textContent = `Finished: ${ok} of ${chosen.length} answered.`;
}

// ---------- results ----------
const fmtInt = (n) => (n == null ? "?" : n.toLocaleString("en-US"));
const fmtMs = (ms) => (ms == null ? "?" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const fmtP = (p) => (p == null ? "–" : p.toFixed(2));

function renderSummary() {
  const box = document.querySelector(".summary");
  if (!box || !S.run) return;
  box.replaceChildren(...S.run.order.map((id) => summaryRow(byId(id), S.run.res[id])));
}

function summaryRow(p, r) {
  let stats = "";
  if (r.status === "running") stats = p.wire === "jev" ? "calling…" : `${r.done} of ${r.n} samples`;
  else if (r.status === "done") {
    const x = r.result;
    const parts = [`${x.calls} call${x.calls > 1 ? "s" : ""}`, `median ${fmtMs(x.msMedian)}`,
      `${fmtInt(x.tokensIn)} in / ${fmtInt(x.tokensOut)} out tokens`];
    if (x.costUsd != null) parts.push(`$${x.costUsd.toFixed(6)}`);
    if (x.kind === "llm") {
      const v = Object.values(x.meta).reduce((s, m) => s + m.violations.length, 0);
      parts.push(`${v} type violation${v === 1 ? "" : "s"}`);
    }
    stats = parts.join(" · ");
  } else stats = "failed";
  return h("div", { class: `sum-row${r.status === "running" ? " pending" : ""}` },
    h("span", { class: "who" }, p.label, " ", h("span", { class: "mono", text: r.model })),
    h("span", { class: "stats", text: stats }),
    r.status === "error" && h("span", { class: "problem", text: r.error }),
    ...(r.result?.notes || []).map((n) => h("span", { class: "note", text: n })),
  );
}

function renderResults() {
  const box = $("#results");
  if (!S.run) {
    box.replaceChildren(h("p", { class: "empty", text: "Pick a provider, add its key, and press Run. Results for each question appear here side by side." }));
    return;
  }
  const req = toJevRequest(S.run.doc);
  const done = S.run.order.filter((id) => S.run.res[id].status === "done");
  const t = S.settings;
  const blocks = Object.entries(req.questions).map(([qid, q]) => h("div", { class: "card qres" },
    h("h3", {}, h("code", { text: qid }), h("span", { class: "badge", text: q.type })),
    h("p", { class: "instr", text: typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions) }),
    done.length
      ? h("div", { class: "cmp" }, ...done.map((id) => answerCard(byId(id), S.run.res[id], qid, q, t)))
      : h("p", { class: "sub", text: "Waiting for answers…" }),
  ));

  box.replaceChildren(
    h("div", { class: "summary" }),
    ...blocks,
    done.length && h("div", { class: "results-tools" },
      h("button", { type: "button", class: "btn small", text: "Download results (JSON)", onclick: download })),
    ...done.map((id) => rawBlock(byId(id), S.run.res[id])),
  );
  renderSummary();
}

function answerCard(p, r, qid, q, t) {
  const a = r.result.response.answers?.[qid];
  const meta = r.result.meta?.[qid];
  const isJev = r.result.kind === "jev";
  const verdict = route(a || null, t);
  const kids = [
    h("div", { class: "ans-top" },
      h("span", { class: "ans-who", text: `${p.label} · ${r.model}` }),
      h("span", { class: `chip ${verdict.verdict}`, title: verdict.why, text: verdict.verdict })),
  ];
  if (!a) {
    kids.push(h("div", { class: "headline", text: "No valid answer" }));
  } else if (a.type === "choice") {
    const tie = meta?.tie ? ` (tie: ${meta.tie.join(", ")})` : "";
    kids.push(h("div", { class: "headline" }, a.choice, tie && h("small", { text: tie })));
    kids.push(bars(Object.keys(q.criteria), a.probabilities || {}, a.choice));
  } else if (a.type === "score") {
    const max = q.criteria.length - 1;
    const near = Math.max(0, Math.min(max, Math.round(a.score)));
    kids.push(h("div", { class: "headline" }, fmtP(a.score), h("small", { text: ` of ${max}` })));
    kids.push(ruler(q.criteria, a.probabilities || {}, a.score, near));
  } else {
    kids.push(h("div", { class: "headline" }, fmtP(a.noul), h("small", { text: " probability of yes" })));
    kids.push(gauge(a.noul, t));
  }
  if (a && a.type !== "noul") {
    kids.push(h("div", { class: "conf" }, isJev ? "confidence (TypeSafe) " : "agreement (ours) ", h("b", { text: fmtP(a.confidence) })));
  }
  if (!isJev && meta) {
    kids.push(h("div", { class: "why", text: `${meta.valid} valid of ${meta.samples} votes · ${verdict.why}` }));
    if (meta.violations.length) {
      const counts = {};
      for (const v of meta.violations) counts[v] = (counts[v] || 0) + 1;
      kids.push(h("details", { class: "viol" },
        h("summary", { text: `${meta.violations.length} type violation${meta.violations.length > 1 ? "s" : ""}` }),
        h("ul", {}, ...Object.entries(counts).map(([v, c]) => h("li", { text: c > 1 ? `${v} (×${c})` : v })))));
    }
  } else {
    kids.push(h("div", { class: "why", text: verdict.why }));
  }
  return h("div", { class: "ans" }, ...kids);
}

function bars(names, probs, lead) {
  return h("div", { class: "bars" }, ...names.map((n) => {
    const p = probs[n] ?? 0;
    return h("div", { class: `bar${n === lead ? " lead" : ""}` },
      h("span", { class: "k", title: n, text: n }),
      h("span", { class: "track" }, h("span", { class: "fill", style: `display:block;width:${(p * 100).toFixed(1)}%` })),
      h("span", { class: "v", text: fmtP(p) }));
  }));
}

function ruler(levels, probs, score, near) {
  const n = levels.length;
  const cols = `grid-template-columns: repeat(${n}, 1fr)`;
  const max = n - 1;
  const left = ((score + 0.5) / n) * 100;
  return h("div", { class: "ruler", role: "img", "aria-label": `Score ${fmtP(score)} of ${max}` },
    h("div", { class: "cols", style: cols }, ...levels.map((_, i) => {
      const p = probs[String(i)] ?? 0;
      return h("div", { class: `col-bar${p === 0 ? " zero" : ""}`, title: `level ${i}: ${fmtP(p)}`, style: `height:${Math.max(p * 100, 3)}%` });
    })),
    h("div", { class: "axis", style: cols },
      ...levels.map((_, i) => h("span", { class: "tick", text: String(i) })),
      h("span", { class: "marker", style: `left:${left.toFixed(1)}%` })),
    h("div", { class: "lv", text: `Nearest level ${near}: ${levels[near]}` }));
}

function gauge(v, t) {
  return h("div", {},
    h("div", { class: "gauge", role: "img", "aria-label": `Probability of yes ${fmtP(v)}` },
      h("span", { class: "band no", style: `width:${t.no * 100}%` }),
      h("span", { class: "band mid", style: `width:${(t.yes - t.no) * 100}%` }),
      h("span", { class: "band yes", style: `width:${(1 - t.yes) * 100}%` }),
      h("span", { class: "needle", style: `left:${(v * 100).toFixed(1)}%` })),
    h("div", { class: "gauge-scale" }, h("span", { text: "0 no" }), h("span", { text: `${t.no} · ${t.yes}` }), h("span", { text: "yes 1" })));
}

function rawBlock(p, r) {
  const x = r.result;
  const pre = h("pre", { class: "code", tabindex: "0" });
  pre.textContent = JSON.stringify(x.response, null, 2) +
    (x.samples.length ? `\n\n--- ${x.samples.length} raw replies ---\n` + x.samples.map((s, i) => `#${i + 1} (${fmtMs(s.ms)})${s.parsed ? "" : " [not JSON]"}\n${s.text}`).join("\n\n") : "");
  return h("details", { class: "card raw" }, h("summary", { text: `${p.label}: response${x.kind === "llm" ? " in TypeSafe's shape, and every raw reply" : ""}` }), pre);
}

function download() {
  const out = {
    tool: "Snap Judge",
    ran_at: S.run.at,
    request: toJevRequest(S.run.doc),
    thresholds: { floor: S.settings.floor, act: S.settings.act, yes: S.settings.yes, no: S.settings.no },
    results: Object.fromEntries(S.run.order.map((id) => {
      const r = S.run.res[id];
      return [id, r.status === "done"
        ? { model: r.model, kind: r.result.kind, response: r.result.response, meta: r.result.meta, calls: r.result.calls,
          median_ms: r.result.msMedian, notes: r.result.notes, samples: r.result.samples }
        : { model: r.model, error: r.error || r.status }];
    })),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `snap-judge-${S.run.at.slice(0, 19).replace(/[:T]/g, "-")}.json` });
  document.body.append(a);
  a.click();
  // Revoking at once cancels the download in Chromium; give it time to start.
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
}

// ---------- settings ----------
function bindSettings() {
  // Values apply as you type. Leaving the field only tidies an out-of-range
  // value; it never re-draws the results for an unchanged value, because a
  // re-draw between mouse-down and mouse-up would swallow the click that
  // moved focus away.
  const num = (id, key, min, max, { integer = false, rerender = false } = {}) => {
    const el = $(id);
    el.value = S.settings[key];
    const apply = (v) => {
      if (v === S.settings[key]) return;
      S.settings[key] = v;
      saveSettings();
      if (rerender && S.run) renderResults();
    };
    el.addEventListener("input", () => {
      const v = Number(el.value);
      if (el.value !== "" && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v))) apply(v);
    });
    el.addEventListener("change", () => {
      let v = Number(el.value);
      if (el.value === "" || !Number.isFinite(v)) v = S.settings[key];
      v = Math.max(min, Math.min(max, integer ? Math.round(v) : v));
      el.value = v;
      apply(v);
    });
  };
  num("#n", "n", 1, 20, { integer: true });
  num("#temp", "temp", 0, 2);
  num("#conc", "conc", 1, 8, { integer: true });
  num("#t-floor", "floor", 0, 1, { rerender: true });
  num("#t-act", "act", 0, 1, { rerender: true });
  num("#t-yes", "yes", 0, 1, { rerender: true });
  num("#t-no", "no", 0, 1, { rerender: true });

  const proxy = $("#proxy");
  proxy.value = S.settings.proxy;
  proxy.addEventListener("change", () => { S.settings.proxy = proxy.value.trim().replace(/\/+$/, ""); saveSettings(); });
  $("#proxy-check").addEventListener("click", checkProxy);

  const rem = $("#remember");
  rem.checked = S.settings.remember;
  rem.addEventListener("change", () => { S.settings.remember = rem.checked; saveSettings(); saveProv(); toast(rem.checked ? "Keys will be remembered on this device" : "Keys will be forgotten when this tab closes"); });
}

async function checkProxy() {
  const out = $("#proxy-status");
  out.textContent = "Checking…";
  try {
    const res = await fetch(`${S.settings.proxy}/health`, { cache: "no-store" });
    const j = await res.json();
    if (!j.ok || j.app !== "snap-judge-proxy") throw new Error("not the Snap Judge proxy");
    out.textContent = `Proxy is running. It forwards: ${j.forwards.join(", ")}.`;
  } catch {
    out.textContent = `No Snap Judge proxy at ${S.settings.proxy}. From the repo folder run "node proxy.mjs", then open http://127.0.0.1:8787.`;
  }
}

// ---------- theme ----------
function bindTheme() {
  const saved = store.get("localStorage", "sj.theme", null);
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("localStorage", "sj.theme", next);
  });
}

// ---------- wiring ----------
function renderAll() {
  renderPresets();
  renderState();
  renderQuestions();
  refresh();
}

function init() {
  $("#preset").addEventListener("change", (e) => loadPreset(e.target.value));
  $("#state").addEventListener("input", (e) => { S.doc.state = e.target.value; saveDoc(); refresh(); });
  $("#state-json").addEventListener("change", (e) => { S.doc.stateIsJson = e.target.checked; saveDoc(); refresh(); });
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    S.doc.questions.push(blankQuestion(b.dataset.add, S.doc.questions.length + 1));
    saveDoc();
    renderQuestions();
    refresh();
    document.querySelector(`[data-q="${S.doc.questions.length - 1}"] .id`)?.focus();
  }));
  document.querySelectorAll("#export-tabs [role=tab]").forEach((b) => b.addEventListener("click", () => { S.fmt = b.dataset.fmt; renderExport(); }));
  $("#copy-export").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#export-code").textContent);
      toast("Copied");
    } catch {
      toast("Copy failed - select the text and copy it by hand");
    }
  });
  $("#run").addEventListener("click", run);
  bindSettings();
  bindTheme();
  renderAll();
  renderProviders();
  renderResults();
}

init();
