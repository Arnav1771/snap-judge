// The question document the editor works on, and the exact TypeSafe request
// built from it. Limits come from the TypeSafe API reference
// (docs.typesafe.ai/api): a Choice takes at most 255 options, a Score 2 to 10
// levels. Two limits are ours, not the API's, and are labelled as such: a
// Choice needs at least two options, and ids must look like identifiers so the
// exported Python and JavaScript stay valid.

export const TYPES = ["noul", "choice", "score"];
export const LIMITS = { choiceMax: 255, choiceMin: 2, scoreMin: 2, scoreMax: 10 };
export const ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const JEV_MODELS = ["jev-latest", "jev-1.13.0", "jev-preview"];

const text = (v) => (typeof v === "string" ? v.trim() : "");

// The state is sent as a string unless the author marked it JSON, in which
// case it must parse to an object or array (TypeSafe accepts either).
export function parseState(doc) {
  const raw = typeof doc.state === "string" ? doc.state : "";
  if (!doc.stateIsJson) return { ok: raw.trim() !== "", value: raw, error: raw.trim() ? null : "The state is empty." };
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== "object") {
      return { ok: false, value: null, error: "JSON state must be an object or an array." };
    }
    return { ok: true, value, error: null };
  } catch (e) {
    return { ok: false, value: null, error: `The state is not valid JSON: ${e.message}` };
  }
}

// Every problem in the document, each tied to where it is, so the editor can
// show it next to the field. An empty list means the request can be sent.
export function validate(doc) {
  const errors = [];
  const add = (where, message) => errors.push({ where, message });

  const state = parseState(doc);
  if (!state.ok) add("state", state.error);

  const qs = Array.isArray(doc.questions) ? doc.questions : [];
  if (qs.length === 0) add("questions", "Add at least one question.");

  const seen = new Set();
  qs.forEach((q, i) => {
    const at = `q${i}`;
    const id = text(q.id);
    if (!ID_RE.test(id)) {
      add(`${at}.id`, "Use letters, digits and underscores, starting with a letter (our rule, so the exported code stays valid).");
    } else if (seen.has(id)) {
      add(`${at}.id`, `The id "${id}" is used twice; answers are returned by id, so each must be unique.`);
    }
    seen.add(id);

    if (!TYPES.includes(q.type)) add(`${at}.type`, "Pick noul, choice or score.");
    if (!text(q.instructions)) add(`${at}.instructions`, "Write the question the model should answer.");

    if (q.type === "choice") {
      const opts = (q.options || []).map((o) => text(o.name));
      const named = opts.filter(Boolean);
      if (named.length < LIMITS.choiceMin) add(`${at}.options`, "A choice needs at least two options.");
      if (named.length > LIMITS.choiceMax) add(`${at}.options`, `The API accepts at most ${LIMITS.choiceMax} options.`);
      if (opts.some((o) => !o)) add(`${at}.options`, "Every option needs a name.");
      const dup = named.find((o, j) => named.indexOf(o) !== j);
      if (dup) add(`${at}.options`, `The option "${dup}" appears twice.`);
    }
    if (q.type === "score") {
      const levels = (q.levels || []).map(text);
      if (levels.length < LIMITS.scoreMin || levels.length > LIMITS.scoreMax) {
        add(`${at}.levels`, `A score takes ${LIMITS.scoreMin} to ${LIMITS.scoreMax} levels.`);
      }
      if (levels.some((l) => !l)) add(`${at}.levels`, "Describe every level; the model sees only the descriptions.");
    }
  });
  return errors;
}

// The request body exactly as POST /v1/systemone expects it. Empty option
// descriptions become null, which the API documents as "needs no extra
// detail". Noul criteria are sent only when the author wrote one.
export function toJevRequest(doc, model = "jev-latest") {
  const questions = {};
  for (const q of doc.questions) {
    const out = { type: q.type, instructions: text(q.instructions) };
    if (q.type === "noul") {
      const t = text(q.criteria?.true);
      const f = text(q.criteria?.false);
      if (t || f) out.criteria = { true: t || null, false: f || null };
    } else if (q.type === "choice") {
      out.criteria = {};
      for (const o of q.options) out.criteria[text(o.name)] = text(o.description) || null;
    } else if (q.type === "score") {
      out.criteria = q.levels.map(text);
    }
    questions[text(q.id)] = out;
  }
  return { state: parseState(doc).value, model, questions };
}

export function blankQuestion(type = "noul", n = 1) {
  const base = { id: `question_${n}`, type, instructions: "" };
  if (type === "choice") return { ...base, options: [{ name: "", description: "" }, { name: "", description: "" }] };
  if (type === "score") return { ...base, levels: ["", "", ""] };
  return { ...base, criteria: { true: "", false: "" } };
}

// Changing a question's type keeps what can carry over and starts the rest
// fresh, so switching back and forth never throws work away silently.
export function retype(q, type) {
  const next = { ...blankQuestion(type), id: q.id, instructions: q.instructions };
  if (type === "choice" && q.options) next.options = q.options;
  if (type === "score" && q.levels) next.levels = q.levels;
  if (type === "noul" && q.criteria) next.criteria = q.criteria;
  return { ...q, ...next, type };
}
