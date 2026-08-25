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

## 3. Current State

### Deployed

| Component | URL / ID |
|---|---|
| Frontend (production) | https://personal-assistant-8ve.pages.dev |
| Frontend (preview, this session) | https://8007c40f.personal-assistant-8ve.pages.dev |
| Worker API | https://personal-assistant-api.alsheikharama.workers.dev |
| Worker version | `4820af5c-18ae-4b76-981d-720d55984ebb` |
| Client bundle | `index-Cehqpf6E.js` |

### Verified

- `GET /api/health` → 200
- `POST /api/chat` mode `rag` → 200, summarizes the ingested Arabic training-period document
- `POST /api/chat` mode `api` → 200
- `POST /api/chat` mode `mcp` → 200
- CORS preflight from the production origin returns `access-control-allow-origin`; preview origin does not

### Changed files

```
client/src/errors.js      new
client/src/api.js         ApiError, network-failure catch
client/src/App.jsx        isError message flag, uploadStatus object
client/src/App.css        error / warning styles appended
worker/src/agent.js       trimToBudget + tightened constants
worker/src/tools.js       RAG topK 10 -> 4
worker/src/memory.js      MAX_TURNS 20 -> 8
```

Nothing has been committed. `worker/` and `client/src/api.js` are still untracked in git.

### Configuration

- `client/.env.production` → `VITE_API_URL=https://personal-assistant-api.alsheikharama.workers.dev` (verified correct in the built bundle)
- `client/.env.development` → `VITE_API_URL=http://localhost:8787`
- `worker/wrangler.toml` → `CLIENT_ORIGIN = "https://personal-assistant-8ve.pages.dev"`
- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, 24000-token context window

---

## 4. Next Steps

1. **Commit the work.** `worker/` and the new client files are untracked. Two logical commits: the client error handling, and the worker context fix.

2. **Decide on preview-origin CORS.** `worker/src/index.js:20` uses exact matching (`allowed.includes(origin)`). Switching to a suffix match on `.personal-assistant-8ve.pages.dev` would make preview deployments usable for testing. Trade-off: any Pages project under that subdomain could then call the API.

3. **Handle 8007 gracefully as defense in depth.** `trimToBudget` should prevent it, but a catch that retries once with a smaller budget would make the failure mode a slower answer rather than a 500.

4. **Verify RAG answer quality at `topK=4`.** Retrieval was cut from 10 to 4 chunks. If answers become thin as the corpus grows, raise `topK` and lower `MAX_TOOL_RESULT_CHARS` to compensate, rather than reverting the cap.

5. **Consider a larger-context model.** The 24000-token window is the binding constraint. A model with a larger window would relax every limit tightened here.

6. **Add a client-side test for `toFriendlyMessage`.** The fallback chain is pure logic with no dependencies and is worth pinning down before it accumulates more cases.

7. **Surface the raw error in the console.** `ApiError.detail` is preserved but never logged. A `console.error` in the catch would help diagnose issues from the browser without a `wrangler tail` session.
