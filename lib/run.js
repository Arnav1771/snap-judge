// Run one document against one provider and return a result in TypeSafe's
// response shape, plus what it cost to get there.

import { buildPrompt, parseSample } from "./judge.js";
import { aggregate } from "./aggregate.js";
import { toJevRequest } from "./schema.js";
import { complete, callJev, withRetry, ProviderError, JEV_PRICE_PER_MTOK_IN } from "./providers.js";

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function pool(n, limit, task) {
  const results = new Array(n);
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      results[i] = await task(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
  return results;
}

export async function runJev(p, cfg, doc, { fetchFn = fetch, sleep } = {}) {
  const request = toJevRequest(doc, cfg.model || "jev-latest");
  const { response, ms } = await withRetry(() => callJev(p, cfg, request, fetchFn), { sleep });
  const tokensIn = response.usage?.input_tokens ?? null;
  return {
    kind: "jev",
    response,
    meta: Object.fromEntries(Object.keys(request.questions).map((id) => [id, { samples: 1, valid: response.answers[id] ? 1 : 0, violations: [] }])),
    calls: 1,
    msMedian: ms,
    msTotal: ms,
    tokensIn,
    tokensOut: response.usage?.output_tokens ?? null,
    costUsd: tokensIn == null ? null : (tokensIn / 1e6) * JEV_PRICE_PER_MTOK_IN,
    samples: [],
    notes: [],
  };
}

// N independent samples, each asking every question at once (the same
// fan-out TypeSafe recommends), then one aggregate per question.
export async function runLlm(p, cfg, doc, { n = 5, temperature = 1, concurrency = 3, fetchFn = fetch, sleep, onSample } = {}) {
  const prompt = buildPrompt(doc);
  const opts = { json: Boolean(p.json), temperature };
  const notes = [];

  const one = async () => {
    try {
      return await withRetry(() => complete(p, cfg, prompt, opts, fetchFn), { sleep });
    } catch (e) {
      // Not every model takes JSON mode or a temperature. Drop both once,
      // remember it for the rest of the run, and say so in the result.
      if (e instanceof ProviderError && e.status === 400 && (opts.json || opts.temperature != null)) {
        notes.push("The provider refused JSON mode or the temperature setting, so both were dropped for this run.");
        opts.json = false;
        opts.temperature = null;
        return await withRetry(() => complete(p, cfg, prompt, opts, fetchFn), { sleep });
      }
      throw e;
    }
  };

  // The first call runs alone so a 400 fallback, a bad key or a wrong model
  // is found once instead of N times in parallel.
  const first = await one();
  onSample?.(1, n);
  const rest = await pool(n - 1, concurrency, async () => {
    try {
      const r = await one();
      return r;
    } catch (e) {
      return { error: e };
    } finally {
      onSample?.(null, n);
    }
  });
  const replies = [first, ...rest];

  const failed = replies.filter((r) => r.error);
  const ok = replies.filter((r) => !r.error);
  if (failed.length) notes.push(`${failed.length} of ${n} samples failed: ${failed[0].error.message}`);

  const parsed = ok.map((r) => ({ ...parseSample(prompt, r.text), text: r.text, ms: r.ms }));
  const answers = {};
  const meta = {};
  for (const { id } of prompt.keys) {
    const q = prompt.request.questions[id];
    const agg = aggregate(q, parsed.map((s) => s.answers[id]));
    if (agg.answer) answers[id] = agg.answer;
    meta[id] = agg.meta;
  }
  const sum = (k) => (ok.every((r) => r[k] != null) ? ok.reduce((s, r) => s + r[k], 0) : null);
  return {
    kind: "llm",
    response: { model: cfg.model, answers, usage: { input_tokens: sum("tokensIn"), output_tokens: sum("tokensOut") } },
    meta,
    calls: replies.length,
    msMedian: median(ok.map((r) => r.ms)),
    msTotal: ok.reduce((s, r) => s + r.ms, 0),
    tokensIn: sum("tokensIn"),
    tokensOut: sum("tokensOut"),
    costUsd: null,
    samples: parsed.map((s) => ({ text: s.text, parsed: s.parsed, ms: s.ms })),
    notes: [...new Set(notes)],
  };
}
