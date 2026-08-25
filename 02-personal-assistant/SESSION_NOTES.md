# Session Notes

Date: 2026-08-25
Scope: `02-personal-assistant` (Cloudflare Workers API + Pages frontend)

---

## 1. What We Built

### Client error handling (new)

The frontend previously surfaced raw backend errors directly in the chat transcript, styled identically to a normal assistant reply and carrying the mode badge (`RAG` / `API` / `MCP`). Errors are now a distinct, user-friendly message type.

**`client/src/errors.js`** (new file)

- `ApiError` class carrying `status`, `code`, and the raw `detail` from the backend.
- `extractErrorCode(text)` pulls a 4-digit provider code out of an error string (e.g. `4006`, `8007`).
- `toFriendlyMessage(error)` resolves a human-readable message through a four-stage fallback chain:
  1. Known provider code (`4006`, `3040`, `3036` → usage-limit message)
  2. Regex patterns (quota, rate limit, timeout, network failure, capacity, PDF type, file size)
  3. HTTP status map (`400`, `401`, `403`, `404`, `413`, `429`, `500`, `502`, `503`, `504`)
  4. Generic fallback: "Something went wrong. Please try again."

**`client/src/api.js`**

- `request()` now wraps `fetch` in try/catch so network-level failures (including CORS blocks, which surface as a thrown `TypeError`) become an `ApiError` with `status: 0`.
- Non-OK responses throw `ApiError` with status, extracted code, and raw detail preserved for debugging.

**`client/src/App.jsx`**

- Failed chat requests push `{ role: "ai", text: toFriendlyMessage(err), isError: true }`.
- Error bubbles render with a ⚠️ icon, suppress the mode badge, and skip markdown rendering.
- `uploadStatus` changed from a bare string to `{ text, isError }` so upload failures get the same treatment.

**`client/src/App.css`**

- `.messageBubble.isError` — `1px solid #ef4444` border, `rgba(239, 68, 68, 0.08)` background, `#fecaca` text.
- `.errorContent`, `.warningIcon`, `.uploadStatus.isError` for icon layout and upload-panel errors.

### Worker context-budget fix

RAG mode was returning HTTP 500 on every request. Investigation via `wrangler tail` produced:

```
chat failed AiError: 8007: {"error":{"message":"This model's maximum context length is 24000 tokens.
However, you requested 2048 output tokens and your prompt contains at least 21953 input tokens,
for a total of at least 24001 tokens." ... "code":400}}
```

Over the limit by exactly one token. This was **not** a quota error — `api` and `mcp` modes were answering normally throughout.

Root cause: the tool loop appended assistant messages and tool results to `messages` without ever trimming. Pinecone returned `topK=10` chunks of ~1000 characters, the model re-searched on each round, and occasionally emitted multiple tool calls per round. The input token count was identical (21953) across different user prompts because the small corpus returns the same chunks every time.

**`worker/src/agent.js`**

- New `trimToBudget(messages, budget)`: estimates tokens at `JSON.stringify(msg).length / 3.5`, drops oldest messages until under `MODEL_CONTEXT_TOKENS - MAX_TOKENS - CONTEXT_MARGIN_TOKENS`. Orphaned `tool` messages are dropped along with their parent `assistant` message so the sequence stays valid for the API. The system prompt is always preserved.
- Applied before every `AI.run` call — both inside the tool loop and on the synthesis fallback.
- Constants: `MAX_TOOL_ROUNDS` 4 → 3, `MAX_TOKENS` 2048 → 1024, `MAX_TOOL_RESULT_CHARS` 6000 → 2500, new `MAX_CALLS_PER_ROUND = 2`.

**`worker/src/tools.js`** — RAG `query(env, vector, 10)` → `query(env, vector, 4)`.

**`worker/src/memory.js`** — `MAX_TURNS` 20 → 8.

---

## 2. Key Decisions

**Error mapping lives on the client, not the worker.** The worker keeps returning raw provider errors so they stay visible in `wrangler tail`; the client translates them for display. Debuggability is preserved without leaking provider internals to users.

**Fallback chain ordered code → pattern → status → generic.** Provider codes are the most specific signal available, but they are not stable across providers, so regex patterns catch quota/rate-limit/timeout wording generically. HTTP status is the last structured signal before the generic message.

**Network failures treated as errors with `status: 0`.** A CORS block and a dropped connection are indistinguishable from the browser, and both warrant the same "Cannot reach the server" message.

**Context budget enforced by trimming, not by shrinking retrieval alone.** Lowering `topK` alone would fail again as soon as chunk sizes or tool-call counts changed. `trimToBudget` is a hard ceiling that holds regardless of corpus size or model behavior.

**Token estimate uses `length / 3.5`, deliberately conservative.** Combined with the 1500-token margin, this leaves headroom rather than attempting exact token counting inside the Worker.

**Preview Pages URLs remain CORS-blocked, by design.** `CLIENT_ORIGIN` is pinned to the production origin. Preview deployments get a fresh hash subdomain each time, so allowing them requires either a suffix match or a wildcard — this was left unchanged pending a decision.

---

---

# Session 2 — 2026-08-25

## 1. What We Built

### Small talk no longer triggers tools

`Hello` was answered with document chunks. The system prompt said "always use them to answer questions. Never answer from memory alone when a tool is available", so the model dutifully searched Pinecone for a greeting and the corpus returned whatever it had (AlgoArabTech, Folowise training-period material).

Fixed in two layers.

**`worker/src/intent.js`** (new) — `isSmallTalk(message)` normalizes the text (lowercase, strip Arabic diacritics, fold `أإآ→ا`, `ى→ي`, `ة→ه`, drop punctuation) and full-matches it against anchored patterns for greetings, thanks, farewells, acknowledgements, and capability questions, in English and Arabic. Capped at 80 characters, so anything longer than a bare greeting falls through to the normal agent path.

**`worker/src/agent.js`** — when `isSmallTalk` matches, `runAgent` short-circuits before tools are loaded (skipping the MCP fetch entirely) and answers with `SMALL_TALK_PROMPT`, using only the last 4 history messages and 160 max tokens. History is still saved so follow-ups keep context. Mode validation moved ahead of the short-circuit so an unknown mode still throws.

**System prompt rewritten** in both `worker/src/agent.js` and `server/agent.js` — tool use is now scoped to information the model does not have, greetings and capability questions are answered directly in the user's language, and an empty tool result must be reported as such rather than padded with unrelated content.

### Context-length retry (defense in depth)

**`worker/src/agent.js`** — `runModel(env, model, {messages, tools, maxTokens})` wraps every `AI.run` call. It trims to budget, and on a context-length failure (`8007` or `maximum context length`) retries up to 3 times with the budget multiplied by 0.6 each round. A prompt that still overflows after trimming now costs a slower answer instead of a 500.

### Preview-origin CORS

**`worker/src/cors.js`** (new) — `isAllowedOrigin(origin, env)` keeps exact matching on `CLIENT_ORIGIN` and adds an opt-in suffix match on the new `CLIENT_ORIGIN_SUFFIXES` var. A suffix is normalized to a leading dot and the origin must be `https:`, so `evil-personal-assistant-8ve.pages.dev` is rejected while `<hash>.personal-assistant-8ve.pages.dev` is allowed. `worker/src/index.js` now delegates to it.

### Tests

Vitest added to both packages (`npm test` → `vitest run`).

- `client/src/errors.test.js` — 15 tests over `extractErrorCode` and the full `toFriendlyMessage` fallback chain, including code-beats-status precedence and the `status: 0` network case.
- `worker/src/intent.test.js` — 7 tests, including Arabic greetings and the negative cases (`ما هي مدة فترة التدريب؟`, `hello, what does the document say about pricing?`).
- `worker/src/cors.test.js` — 8 tests, including the lookalike-domain and non-https rejections.

### Error detail logging

**`client/src/api.js`** — both throw paths now go through `logFailure(path, error)`, which `console.error`s status, code, and raw detail. Diagnosing a browser failure no longer requires a `wrangler tail` session.

## 2. Key Decisions

**Small talk is caught by code, not only by the prompt.** A prompt change alone leaves the behavior at the model's discretion; a deterministic pre-check guarantees no tool call, no Pinecone query, and no MCP fetch for a greeting. The prompt change is the fallback for phrasings the patterns miss.

**Patterns are anchored and length-capped.** `^...$` matching on the normalized string means `hello, what does the document say about pricing?` is not small talk. The 80-character cap is a second guard against a greeting-prefixed real question slipping through.

**CORS suffix matching is opt-in and requires a leading dot.** `endsWith(".personal-assistant-8ve.pages.dev")` cannot be satisfied by a project merely ending in those words, and Pages project names are unique per account, so the widened surface is exactly this project's own preview deployments.

**Retry, not a lower ceiling.** Lowering `MAX_INPUT_TOKENS` outright would waste context on every normal request. Retrying with a smaller budget only pays the cost when an overflow actually happens.

## 3. Current State

### Deployed

| Component | URL / ID |
|---|---|
| Frontend (production) | https://personal-assistant-8ve.pages.dev |
| Frontend (preview, this session) | https://70552469.personal-assistant-8ve.pages.dev |
| Worker API | https://personal-assistant-api.alsheikharama.workers.dev |
| MCP server | https://mcp-search-server.alsheikharama.workers.dev/mcp |
| Worker version | `bc507c24-3776-41c3-ac16-b26a27d37e13` |
| Client bundle | `index-bymREW6j.js` |

### Verified

- `GET /api/health` → 200
- `POST /api/chat` `rag` + `Hello` → `"Hello, it's nice to meet you. How can I help you today?"` — no document content
- `POST /api/chat` `rag` + `مرحبا` → `"مرحبا، كيف يمكنني مساعدتك اليوم؟"`
- `POST /api/chat` `rag` + real document question → 200, answers from the corpus
- `POST /api/chat` `api` → 200 · `mcp` → 200
- CORS preflight: production origin allowed, preview origin allowed, `evil-personal-assistant-8ve.pages.dev` and `attacker.example.com` both rejected
- `npm test` → 15 client tests, 15 worker tests, all passing
- Production Pages serves the new bundle with the correct `VITE_API_URL`

### Commits

```
bbc5289 feat(assistant): allow Pages preview origins through CORS
61027d3 fix(assistant): stop calling tools for greetings and small talk
6bbc1a5 feat(assistant): show friendly errors instead of raw provider output
4722694 feat(assistant): add Cloudflare Workers API and deploy setup
```

Everything under `02-personal-assistant/` is committed. Still untracked at the repo root: `01-mcp-search-server/worker/` (the deployed MCP server), `.playwright-mcp/`, `04-trip-planner-a2a/package-lock.json`, `app-dashboard.yml`.

## 4. Next Steps

1. **Commit `01-mcp-search-server/worker/`.** It is deployed and bound to the assistant Worker via a service binding, but its source is untracked.
2. **Gitignore `.playwright-mcp/`.** Tool output, not source.
3. **Verify RAG answer quality at `topK=4`.** Still open from session 1. If answers thin out as the corpus grows, raise `topK` and lower `MAX_TOOL_RESULT_CHARS` rather than removing the cap.
4. **Consider a larger-context model.** The 24000-token window is still the binding constraint on every limit in `agent.js`.
5. **Add an agent-level test.** `runAgent` is only covered indirectly; a fake `env.AI` would let the small-talk short-circuit and the retry path be asserted without a deploy.
