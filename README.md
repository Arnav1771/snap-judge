# Snap Judge

**Probabilities, not prose.** Write questions in [TypeSafe Jev's](https://docs.typesafe.ai/primitives)
three types - `noul` (yes/no), `choice` (pick one), `score` (pick a level) - and run them on Jev or on
any of 17 LLM providers, side by side.

**Try it:** https://arnav1771.github.io/snap-judge/ - or run it locally (below) so every provider works.

> Independent project, not affiliated with TypeSafe AI.

## What it shows you

Jev is a "System One" model: you declare the possible answers up front and it returns a probability
for every one of them, in one call. A general LLM returns one answer as text. Snap Judge puts the two
next to each other:

- **Jev** - one request to `POST /v1/systemone`, shown exactly as TypeSafe returns it, with
  TypeSafe's own `confidence`.
- **Any LLM** - asked the same questions *N* times (default 5). Every reply must be JSON using only
  your options; anything else is counted as a **type violation** and left out. The share of valid
  votes per option becomes the distribution, in TypeSafe's response shape.
- **Routing** - every answer gets an *act / confirm / human* verdict from TypeSafe's
  [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing) pattern. Change
  the thresholds and the verdicts update without re-running.
- **Cost and speed** - calls, median latency and tokens per provider; for Jev, the dollar cost at
  its published $0.042 per million input tokens.
- **Code** - the current questions as a TypeSafe request in JSON, curl, Python (`typesafe_sdk`) and
  JavaScript (`@typesafe-ai/sdk`).

Sampling an LLM several times and reading agreement as a signal is the technique in TypeSafe's own
self-consistency cookbooks.

### Read the numbers honestly

- For LLMs, **"agreement" is ours**: 1 minus the normalised Shannon entropy of the votes. TypeSafe
  doesn't publish how its `confidence` is computed, so the two are different numbers. Compare the
  shapes of the distributions, not the digits.
- With *N* samples every probability is a multiple of 1/*N*. Five votes cannot say 0.85.
- Like Jev, the LLM never sees your question ids; questions go out as `q1`, `q2`, … and are mapped back.

## Providers

| Provider | Works from | Notes |
|---|---|---|
| TypeSafe Jev | local proxy | Early access - [get a key](https://console.typesafe.ai/keys) |
| OpenRouter | browser | `:free` models cost nothing (rate-limited) |
| OpenAI | browser | |
| Anthropic | browser | |
| Google Gemini | browser | free tier |
| Groq | browser | free tier |
| Mistral | browser | |
| DeepSeek | browser | |
| xAI | browser | |
| Together AI | browser | |
| Fireworks AI | browser | |
| Cohere | browser | free trial keys |
| Hugging Face | browser | Inference Providers router, free monthly credits |
| NVIDIA NIM | local proxy | free developer keys |
| Cerebras | local proxy | free tier |
| Ollama | your machine | no key |
| LM Studio | your machine | no key; enable CORS in its server settings |
| Any OpenAI-compatible API | depends | vLLM, llama.cpp, LiteLLM, a company gateway |

"Browser" means the provider accepts requests straight from a web page. Each one was checked from a
real Chromium page on 2026-09-23. TypeSafe, NVIDIA and Cerebras refuse them, so they go through the
local proxy.

**Perplexity is left out on purpose.** Its Sonar Chat Completions API is being replaced by the Agent
API, and support ends on 27 September 2026.

**Where the model lists come from** (read 2026-09-23): each vendor's own model docs (OpenAI, xAI,
DeepSeek, Cohere, Mistral, Together, Fireworks), the public live lists of Hugging Face, Cerebras,
NVIDIA and OpenRouter, and the provider docs checked for [Grimoire](https://github.com/Arnav1771/turmux_builder).
They are only defaults: **Load models** fetches the provider's live list with your key, and the model
field takes any id.

## Run it locally

Needs Node 18 or newer. There is nothing to install.

```bash
git clone https://github.com/Arnav1771/snap-judge
cd snap-judge
node proxy.mjs          # then open http://127.0.0.1:8787
```

The proxy also serves the app, so the local copy is complete and every provider works in it.
To use it from the hosted page instead, keep `node proxy.mjs` running; your browser may ask
whether the site can reach devices on your local network.

**Ollama** accepts the local copy's origin as it is. For the hosted page, start it with
`OLLAMA_ORIGINS=https://arnav1771.github.io ollama serve`.

### What the proxy will and won't do

`proxy.mjs` has no dependencies and is about 200 lines - read it before you run it.

- listens on `127.0.0.1` only
- forwards to exactly three hosts: `api.typesafe.ai`, `integrate.api.nvidia.com`, `api.cerebras.ai`
- refuses any `Host` header but its own, which blocks DNS-rebinding pages
- sends CORS headers only to this site and to itself (add origins with `SNAPJUDGE_ORIGINS`)
- forwards only `authorization`, `content-type` and `accept`, and returns no cookies
- logs the method, host, path, status and time - never a key, a header, a body or a query string

## Your keys

Keys are sent from your browser straight to the provider you pick (or, for the three proxied
providers, to the proxy on your own machine). By default they are kept only until you close the tab;
**Remember keys on this device** stores them in this browser's local storage for the site instead.

## Tests

```bash
npm test                # 39 unit tests: schema limits, parsing, aggregation, every wire format, the proxy
```

The browser flow (editing, validation, running, violations, routing, download, themes, phone widths)
was checked with Playwright against the local proxy. Provider replies were mocked in that check. The
one real network call was a fake key sent to TypeSafe through the proxy, which answered 401. No live
LLM completion has been run; that needs your keys.

## Files

```
index.html, styles.css, app.js   the page
lib/schema.js     the question document, API limits, the exact TypeSafe request
lib/judge.js      prompt for an LLM, JSON extraction, type checking of each answer
lib/aggregate.js  votes -> TypeSafe-shaped answers; agreement; routing
lib/providers.js  every provider and its wire format (OpenAI-compatible, Anthropic, Gemini, Cohere, Jev)
lib/run.js        sampling, retries (429/503/529 with backoff), the JSON-mode fallback
lib/export.js     curl, Python and JavaScript for the real API
proxy.mjs         the local proxy and static server
```

MIT licence. By Stealth Keqing.
