// Turn N votes into an answer in TypeSafe's response shape.
//
// noul   -> share of valid votes that said yes
// choice -> share of votes per option; `choice` is the most-voted option
// score  -> share of votes per level; `score` is the probability-weighted
//           level, which is how TypeSafe defines it ("can land between levels")
//
// `confidence` here is OURS: 1 minus the normalised Shannon entropy of the
// vote distribution. TypeSafe does not publish its formula, so the two are
// not the same number and the UI never presents them as if they were.
// With N votes every probability is a multiple of 1/N - five votes cannot
// say 0.85.

export function agreement(probs) {
  const k = probs.length;
  if (k < 2) return 1;
  let h = 0;
  for (const p of probs) if (p > 0) h -= p * Math.log(p);
  return clamp(1 - h / Math.log(k));
}

const clamp = (x) => Math.max(0, Math.min(1, x));
const r = (x) => Math.round(x * 1000) / 1000;

export function aggregate(q, votes) {
  const valid = votes.filter((v) => "value" in v).map((v) => v.value);
  const violations = votes.filter((v) => "violation" in v).map((v) => v.violation);
  const meta = { samples: votes.length, valid: valid.length, violations };
  if (valid.length === 0) return { answer: null, meta };

  if (q.type === "noul") {
    return { answer: { type: "noul", noul: r(valid.filter(Boolean).length / valid.length) }, meta };
  }

  if (q.type === "choice") {
    const names = Object.keys(q.criteria);
    const probabilities = {};
    for (const n of names) probabilities[n] = r(valid.filter((v) => v === n).length / valid.length);
    const top = Math.max(...Object.values(probabilities));
    const leaders = names.filter((n) => probabilities[n] === top);
    return {
      answer: {
        type: "choice",
        choice: leaders[0],
        confidence: r(agreement(names.map((n) => probabilities[n]))),
        probabilities,
      },
      meta: { ...meta, tie: leaders.length > 1 ? leaders : null },
    };
  }

  const probabilities = {};
  const legend = {};
  q.criteria.forEach((d, i) => {
    legend[String(i)] = d;
    probabilities[String(i)] = r(valid.filter((v) => v === i).length / valid.length);
  });
  const score = valid.reduce((s, v) => s + v, 0) / valid.length;
  return {
    answer: {
      type: "score",
      score: r(score),
      confidence: r(agreement(Object.values(probabilities))),
      legend,
      probabilities,
    },
    meta,
  };
}

// Confidence-gated routing, from TypeSafe's own pattern: below the floor a
// person decides; above `act` the code acts; between, it asks to confirm.
// A noul has no confidence, so its value is gated on the yes/no thresholds
// and the middle band goes to a person (the docs' YES = 0.8 / NO = 0.2).
export function route(answer, t) {
  if (!answer) return { verdict: "human", why: "no valid answer" };
  if (answer.type === "noul") {
    if (answer.noul >= t.yes) return { verdict: "act", why: `yes (${answer.noul} ≥ ${t.yes})` };
    if (answer.noul <= t.no) return { verdict: "act", why: `no (${answer.noul} ≤ ${t.no})` };
    return { verdict: "human", why: `unsure (${t.no} < ${answer.noul} < ${t.yes})` };
  }
  const c = answer.confidence;
  if (c < t.floor) return { verdict: "human", why: `confidence ${c} < ${t.floor}` };
  if (c >= t.act) return { verdict: "act", why: `confidence ${c} ≥ ${t.act}` };
  return { verdict: "confirm", why: `confidence ${c} between ${t.floor} and ${t.act}` };
}

export const DEFAULT_THRESHOLDS = { floor: 0.5, act: 0.85, yes: 0.8, no: 0.2 };
