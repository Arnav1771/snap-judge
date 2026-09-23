// How an ordinary LLM is asked a TypeSafe-style question, and how its reply is
// checked. A general model returns text, not a distribution, so one sample is
// one vote: the prompt forces a typed answer, and parseSample() refuses
// anything outside the declared options. Counting refusals is the point -
// they are the "type violations" Jev is built never to have.
//
// Like Jev, the model never sees your question ids: questions go out as q1,
// q2, ... and are mapped back afterwards.

import { toJevRequest } from "./schema.js";

const SYSTEM = [
  "You make fast, focused judgments about a piece of content called the STATE.",
  "You answer every question, and you answer only with one JSON object.",
  "Each key is a question key (q1, q2, ...). Each value must be exactly one of:",
  '- for a "yes/no" question: true or false',
  '- for a "pick one" question: one option name, spelled exactly as given',
  '- for a "level" question: the integer number of one level',
  "Never add explanations, extra keys or text outside the JSON object.",
].join("\n");

const fmt = (v) => (typeof v === "string" ? v : JSON.stringify(v));

export function buildPrompt(doc) {
  const req = toJevRequest(doc);
  const keys = [];
  const lines = ["STATE:", fmt(req.state), "", "QUESTIONS:"];
  Object.entries(req.questions).forEach(([id, q], i) => {
    const key = `q${i + 1}`;
    keys.push({ key, id });
    lines.push("");
    if (q.type === "noul") {
      lines.push(`${key} (yes/no): ${fmt(q.instructions)}`);
      if (q.criteria?.true) lines.push(`  true means: ${fmt(q.criteria.true)}`);
      if (q.criteria?.false) lines.push(`  false means: ${fmt(q.criteria.false)}`);
    } else if (q.type === "choice") {
      lines.push(`${key} (pick one): ${fmt(q.instructions)}`);
      for (const [name, desc] of Object.entries(q.criteria)) {
        lines.push(desc ? `  - ${name}: ${fmt(desc)}` : `  - ${name}`);
      }
    } else {
      lines.push(`${key} (level): ${fmt(q.instructions)}`);
      q.criteria.forEach((d, n) => lines.push(`  ${n}: ${fmt(d)}`));
    }
  });
  const example = Object.fromEntries(keys.map(({ key }, i) => {
    const q = req.questions[keys[i].id];
    return [key, q.type === "noul" ? true : q.type === "score" ? 0 : Object.keys(q.criteria)[0]];
  }));
  lines.push("", `Reply with JSON only, shaped like: ${JSON.stringify(example)}`);
  return { system: SYSTEM, user: lines.join("\n"), keys, request: req };
}

// Pull the first complete JSON object out of a reply. Models wrap JSON in
// code fences or put reasoning before it; both are tolerated, nothing else is.
export function extractJson(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  for (let start = cleaned.indexOf("{"); start !== -1; start = cleaned.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          const v = JSON.parse(cleaned.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v;
        } catch { /* try the next opening brace */ }
        break;
      }
    }
  }
  return null;
}

const YES = new Set(["true", "yes", "y", "1"]);
const NO = new Set(["false", "no", "n", "0"]);

// One answer, checked against its question. Returns { value } or
// { violation } describing what the model sent instead.
export function checkAnswer(q, raw) {
  if (raw === undefined) return { violation: "no answer" };
  if (q.type === "noul") {
    if (typeof raw === "boolean") return { value: raw };
    const s = String(raw).trim().toLowerCase();
    if (YES.has(s)) return { value: true };
    if (NO.has(s)) return { value: false };
    return { violation: `not yes/no: ${JSON.stringify(raw)}` };
  }
  if (q.type === "choice") {
    const names = Object.keys(q.criteria);
    if (typeof raw !== "string") return { violation: `not an option: ${JSON.stringify(raw)}` };
    const exact = names.find((n) => n === raw.trim());
    if (exact) return { value: exact };
    const loose = names.find((n) => n.toLowerCase() === raw.trim().toLowerCase());
    if (loose) return { value: loose };
    return { violation: `not an option: ${JSON.stringify(raw)}` };
  }
  const n = typeof raw === "number" ? raw : /^\s*-?\d+\s*$/.test(String(raw)) ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 0 && n < q.criteria.length) return { value: n };
  return { violation: `not a level 0-${q.criteria.length - 1}: ${JSON.stringify(raw)}` };
}

// One whole reply -> { answers: { id: {value}|{violation} }, parsed: bool }.
export function parseSample(prompt, text) {
  const obj = extractJson(text);
  const answers = {};
  for (const { key, id } of prompt.keys) {
    const q = prompt.request.questions[id];
    answers[id] = obj ? checkAnswer(q, obj[key]) : { violation: "reply was not a JSON object" };
  }
  return { answers, parsed: Boolean(obj) };
}
