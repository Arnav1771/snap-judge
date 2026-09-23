// Every provider Snap Judge can call, and how.
//
// Model ids were read on 2026-09-23 from each vendor's own docs or live model
// list (see README "Where the model lists come from"). They are defaults and
// suggestions only: "Load models" asks the provider for its live list with
// your key, and the model field accepts any id.
//
// `proxy: true` marks the three APIs that refuse browser (CORS) requests -
// TypeSafe, NVIDIA and Cerebras. Checked from a real Chromium page; they need
// the bundled local proxy (`node proxy.mjs`).

export const PROVIDERS = [
  {
    id: "jev", label: "TypeSafe Jev", wire: "jev", proxy: true,
    base: "https://api.typesafe.ai/v1", keyUrl: "https://console.typesafe.ai/keys",
    note: "The real System One model. Early access; returns calibrated probabilities in one call.",
    model: "jev-latest", models: ["jev-latest", "jev-1.13.0", "jev-preview"],
  },
  {
    id: "openrouter", label: "OpenRouter", wire: "openai", json: false,
    base: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys",
    note: "One key for hundreds of models. The :free models cost nothing (rate-limited).",
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    models: ["nvidia/nemotron-3-super-120b-a12b:free", "qwen/qwen3.8-27b:free", "nvidia/nemotron-3-super-120b-a12b",
      "openai/gpt-6-sol", "anthropic/claude-sonnet-5", "google/gemini-3.8-flash", "x-ai/grok-4.7",
      "deepseek/deepseek-v4.1-flash", "moonshotai/kimi-k3", "z-ai/glm-5.3"],
  },
  {
    id: "openai", label: "OpenAI", wire: "openai", json: true,
    base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys",
    model: "gpt-6-luna", models: ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"],
  },
  {
    id: "anthropic", label: "Anthropic", wire: "anthropic",
    base: "https://api.anthropic.com/v1", keyUrl: "https://console.anthropic.com/settings/keys",
    model: "claude-haiku-4-5-20251001",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1"],
  },
  {
    id: "gemini", label: "Google Gemini", wire: "gemini", json: true,
    base: "https://generativelanguage.googleapis.com/v1beta", keyUrl: "https://aistudio.google.com/apikey",
    note: "Has a free tier.",
    model: "gemini-3.5-flash-lite",
    models: ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
  },
  {
    id: "groq", label: "Groq", wire: "openai", json: true,
    base: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys",
    note: "Has a free tier.",
    model: "openai/gpt-oss-20b", models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"],
  },
  {
    id: "mistral", label: "Mistral", wire: "openai", json: true,
    base: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys",
    model: "mistral-small-2603", models: ["mistral-small-2603", "mistral-large-2512", "ministral-8b-2512"],
  },
  {
    id: "deepseek", label: "DeepSeek", wire: "openai", json: true,
    base: "https://api.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys",
    model: "deepseek-flash", models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  {
    id: "xai", label: "xAI", wire: "openai", json: true,
    base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai",
    model: "grok-4.7", models: ["grok-4.7", "grok-4.6", "grok-4.20-0309-non-reasoning"],
  },
  {
    id: "together", label: "Together AI", wire: "openai", json: false,
    base: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "moonshotai/Kimi-K3", "deepseek-ai/DeepSeek-V4-Flash-0731", "Qwen/Qwen3.5-9B"],
  },
  {
    id: "fireworks", label: "Fireworks AI", wire: "openai", json: false,
    base: "https://api.fireworks.ai/inference/v1", keyUrl: "https://app.fireworks.ai/settings/users/api-keys",
    model: "accounts/fireworks/models/deepseek-v4p1-flash",
    models: ["accounts/fireworks/models/deepseek-v4p1-flash", "accounts/fireworks/models/glm-5p3-flash",
      "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b"],
  },
  {
    id: "cohere", label: "Cohere", wire: "cohere", json: true,
    base: "https://api.cohere.com", keyUrl: "https://dashboard.cohere.com/api-keys",
    note: "Trial keys are free.",
    model: "command-a-03-2025", models: ["command-a-03-2025", "command-a-plus-05-2026", "command-r7b-12-2024"],
  },
  {
    id: "huggingface", label: "Hugging Face", wire: "openai", json: false,
    base: "https://router.huggingface.co/v1", keyUrl: "https://huggingface.co/settings/tokens",
    note: "Inference Providers router. Free monthly credits.",
    model: "Qwen/Qwen3.8-27B", models: ["Qwen/Qwen3.8-27B", "deepseek-ai/DeepSeek-V4.1-Flash", "zai-org/GLM-5.3"],
  },
  {
    id: "nvidia", label: "NVIDIA NIM", wire: "openai", json: false, proxy: true,
    base: "https://integrate.api.nvidia.com/v1", keyUrl: "https://build.nvidia.com",
    note: "Free developer keys.",
    model: "nvidia/nemotron-3-super-120b-a12b",
    models: ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3.5-lightning-30b-a3b",
      "moonshotai/kimi-k3", "deepseek-ai/deepseek-v4.1-flash", "poolside/laguna-xs-2.1"],
  },
  {
    id: "cerebras", label: "Cerebras", wire: "openai", json: true, proxy: true,
    base: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai",
    note: "Has a free tier.",
    model: "gpt-oss-120b", models: ["gpt-oss-120b", "qwen-3.8-27b"],
  },
  {
    id: "ollama", label: "Ollama (local)", wire: "openai", json: true, local: true,
    base: "http://localhost:11434/v1", keyUrl: "https://ollama.com/download",
    note: "No key. Runs on your machine; pull a model first (ollama pull llama3.2).",
    model: "llama3.2", models: ["llama3.2", "qwen3", "gemma3"],
  },
  {
    id: "lmstudio", label: "LM Studio (local)", wire: "openai", json: false, local: true,
    base: "http://localhost:1234/v1", keyUrl: "https://lmstudio.ai",
    note: "No key. Start the local server in LM Studio and enable CORS.",
    model: "", models: [],
  },
  {
    id: "custom", label: "Any OpenAI-compatible API", wire: "openai", json: false, custom: true,
    base: "", keyUrl: "",
    note: "vLLM, llama.cpp server, LiteLLM, a company gateway - anything that speaks /chat/completions.",
    model: "", models: [],
  },
];

export const byId = (id) => PROVIDERS.find((p) => p.id === id);

// Where a request actually goes. Proxy-only APIs are rewritten to
// <proxy>/proxy/<host>/<path>; everything else is called directly.
export function endpoint(p, path, cfg = {}) {
  const base = (p.custom || p.local ? cfg.base || p.base : p.base).replace(/\/+$/, "");
  const url = base + path;
  if (!p.proxy) return url;
  const u = new URL(url);
  const proxyBase = (cfg.proxy || "").replace(/\/+$/, "");
  return `${proxyBase}/proxy/${u.host}${u.pathname}${u.search}`;
}

export class ProviderError extends Error {
  constructor(message, { status = 0, retryAfter = null, body = "" } = {}) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

async function send(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    throw new ProviderError(
      "The request never reached the provider. This is usually CORS, a local server that is not running, " +
      "or no network.", { status: 0, body: String(e?.message || e) });
  }
  const body = await res.text();
  if (!res.ok) {
    throw new ProviderError(describe(res.status, body), {
      status: res.status, retryAfter: res.headers.get("retry-after"), body,
    });
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ProviderError("The provider answered with something that is not JSON.", { status: res.status, body });
  }
}

function describe(status, body) {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = j?.error?.message || j?.message || j?.detail?.[0]?.msg || (typeof j?.detail === "string" ? j.detail : "") || "";
  } catch { detail = body.slice(0, 200); }
  const what = {
    400: "The provider rejected the request", 401: "The key was refused", 403: "The key is not allowed to do this",
    404: "Not found - check the model id", 422: "The request did not validate", 429: "Rate limited",
    500: "The provider had an internal error", 502: "Bad gateway", 503: "The provider is unavailable",
    529: "The provider is overloaded",
  }[status] || `HTTP ${status}`;
  return detail ? `${what}: ${detail}` : what;
}

// One LLM call. `opts.json` / `opts.temperature` are dropped by the caller on
// a retry after a 400, since not every model accepts them.
export async function complete(p, cfg, prompt, opts, fetchFn = fetch) {
  const key = cfg.key || "";
  const t0 = performanceNow();
  let out;
  if (p.wire === "openai") {
    const body = {
      model: cfg.model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.json) body.response_format = { type: "json_object" };
    const headers = { "content-type": "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const j = await send(fetchFn, endpoint(p, "/chat/completions", cfg), { method: "POST", headers, body: JSON.stringify(body) });
    const msg = j?.choices?.[0]?.message;
    out = { text: msg?.content ?? "", tokensIn: j?.usage?.prompt_tokens ?? null, tokensOut: j?.usage?.completion_tokens ?? null };
  } else if (p.wire === "anthropic") {
    const body = {
      model: cfg.model, max_tokens: 1024, system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    };
    if (opts.temperature != null) body.temperature = Math.min(1, opts.temperature);
    const j = await send(fetchFn, endpoint(p, "/messages", cfg), {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    const text = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    out = { text, tokensIn: j?.usage?.input_tokens ?? null, tokensOut: j?.usage?.output_tokens ?? null };
  } else if (p.wire === "gemini") {
    const gen = {};
    if (opts.temperature != null) gen.temperature = opts.temperature;
    if (opts.json) gen.responseMimeType = "application/json";
    const body = {
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: gen,
    };
    const url = endpoint(p, `/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(key)}`, cfg);
    const j = await send(fetchFn, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((x) => !x.thought && typeof x.text === "string").map((x) => x.text).join("");
    out = { text, tokensIn: j?.usageMetadata?.promptTokenCount ?? null, tokensOut: j?.usageMetadata?.candidatesTokenCount ?? null };
  } else if (p.wire === "cohere") {
    const body = {
      model: cfg.model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.json) body.response_format = { type: "json_object" };
    const j = await send(fetchFn, endpoint(p, "/v2/chat", cfg), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const text = (j?.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const u = j?.usage?.tokens || j?.usage?.billed_units || {};
    out = { text, tokensIn: u.input_tokens ?? null, tokensOut: u.output_tokens ?? null };
  } else {
    throw new ProviderError(`${p.label} is not a chat model.`);
  }
  return { ...out, ms: performanceNow() - t0 };
}

// The real thing: one TypeSafe call returns every answer with probabilities.
export async function callJev(p, cfg, request, fetchFn = fetch) {
  const t0 = performanceNow();
  const j = await send(fetchFn, endpoint(p, "/systemone", cfg), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key || ""}` },
    body: JSON.stringify(request),
  });
  if (!j || typeof j.answers !== "object") throw new ProviderError("TypeSafe answered without an answers object.");
  return { response: j, ms: performanceNow() - t0 };
}

// The provider's own live model list, with the user's key.
export async function listModels(p, cfg, fetchFn = fetch) {
  const key = cfg.key || "";
  if (p.wire === "gemini") {
    const j = await send(fetchFn, endpoint(p, `/models?pageSize=1000&key=${encodeURIComponent(key)}`, cfg), {});
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  }
  if (p.wire === "anthropic") {
    const j = await send(fetchFn, endpoint(p, "/models?limit=1000", cfg), {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    });
    return (j.data || []).map((m) => m.id);
  }
  if (p.wire === "cohere") {
    const j = await send(fetchFn, endpoint(p, "/v1/models?endpoint=chat&page_size=1000", cfg), {
      headers: { authorization: `Bearer ${key}` },
    });
    return (j.models || []).map((m) => m.name);
  }
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  const j = await send(fetchFn, endpoint(p, "/models", cfg), { headers });
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
}

// Retry 429 / 529 / 503 with exponential backoff, honouring retry-after, as
// the TypeSafe docs ask. Anything else fails at once.
export async function withRetry(fn, { tries = 3, base = 800, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      const retryable = e instanceof ProviderError && [429, 503, 529].includes(e.status);
      if (!retryable || attempt >= tries - 1) throw e;
      const ra = Number(e.retryAfter);
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 20000) : base * 2 ** attempt);
    }
  }
}

function performanceNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// TypeSafe's published price: $0.042 per million input tokens, output free.
export const JEV_PRICE_PER_MTOK_IN = 0.042;
