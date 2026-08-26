# Session Notes

Single source of truth for `02-personal-assistant`. Newest session last; the live state of the system is **session 4 §7** (with session 5 §2 on the rotated MCP token), and the open work is **session 4 §8**. Earlier sections are kept as the record of how each decision was reached — where a later session overturned one, the earlier entry is struck through and points forward.

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

Scope: `02-personal-assistant`, plus repo-wide git hygiene and `01-mcp-search-server/worker`.

## 1. What We Built

### Small talk no longer triggers tools

`Hello` was answered with document chunks. The session-1 system prompt said "always use them to answer questions. Never answer from memory alone when a tool is available", so the model searched Pinecone for a greeting and the corpus returned whatever it had (AlgoArabTech, Folowise training-period material).

Fixed in two layers.

**`worker/src/intent.js`** (new) — `isSmallTalk(message)` normalizes the text (lowercase, strip Arabic diacritics, fold `أإآ→ا`, `ى→ي`, `ة→ه`, drop punctuation, collapse whitespace) and full-matches it against anchored patterns for greetings, thanks, farewells, acknowledgements, and capability questions, in English and Arabic. Capped at 80 characters.

**`worker/src/agent.js`** — when `isSmallTalk` matches, `runAgent` short-circuits *before* tools are loaded, so a greeting costs no Pinecone query and no MCP fetch. It answers with `SMALL_TALK_PROMPT`, using only the last 4 history messages and 160 max tokens, and still saves history so follow-ups keep context. Mode validation moved ahead of the short-circuit (`mode !== "mcp" && !TOOLS_BY_MODE[mode]`) so an unknown mode still throws.

**System prompt rewritten** in both `worker/src/agent.js` and `server/agent.js` — tool use is scoped to information the model does not have; greetings, thanks, farewells, and capability questions are answered directly in the user's language; an empty tool result must be reported as empty rather than padded with unrelated content. The markdown-image passthrough rule is unchanged.

### Context-length retry (defense in depth)

**`worker/src/agent.js`** — `runModel(env, model, {messages, tools, maxTokens})` now wraps every `AI.run` call. It trims to budget, and on a context-length failure (`8007` or `maximum context length`) retries up to 3 times with the budget multiplied by 0.6 each round. A prompt that still overflows after `trimToBudget` costs a slower answer instead of a 500. Both the tool loop and the synthesis fallback go through it.

### Preview-origin CORS

**`worker/src/cors.js`** (new) — `isAllowedOrigin(origin, env)` keeps exact matching on `CLIENT_ORIGIN` and adds an opt-in suffix match on the new `CLIENT_ORIGIN_SUFFIXES` var. A configured suffix is normalized to a leading dot and the origin must be `https:`. `worker/src/index.js` delegates to it; the inline `allowedOrigins` helper is gone.

### Error detail logging

**`client/src/api.js`** — both throw paths route through `logFailure(path, error)`, which `console.error`s status, code, and raw detail. Diagnosing a browser-side failure no longer needs a `wrangler tail` session.

### Tests

Vitest added to both packages (`npm test` → `vitest run`, `npm run test:watch` → `vitest`).

- `client/src/errors.test.js` — 15 tests over `extractErrorCode` and the whole `toFriendlyMessage` fallback chain, including code-beats-status precedence and the `status: 0` network case.
- `worker/src/intent.test.js` — 7 tests, including Arabic greetings and the negatives (`ما هي مدة فترة التدريب؟`, `hello, what does the document say about pricing?`).
- `worker/src/cors.test.js` — 8 tests, including the lookalike-domain and non-https rejections.

### Repo hygiene

- `01-mcp-search-server/worker/` committed. It was deployed and service-bound to the assistant Worker while its source sat untracked.
- `04-trip-planner-a2a/package-lock.json` committed — `04/package.json` was tracked without its lockfile, the only workspace missing one.
- `.playwright-mcp/` and `app-dashboard.yml` added to the root `.gitignore`. `app-dashboard.yml` is a Playwright accessibility snapshot of an unrelated Qrindo dashboard; it was gitignored rather than deleted.

## 2. Key Decisions

**Small talk is caught by code, not only by the prompt.** A prompt change alone leaves the behavior at the model's discretion. A deterministic pre-check guarantees no tool call, no Pinecone query, and no MCP fetch for a greeting. The prompt change is the fallback for phrasings the patterns miss.

**Patterns are anchored and length-capped.** `^...$` matching on the normalized string keeps `hello, what does the document say about pricing?` out of the small-talk path. The 80-character cap is a second guard against a greeting-prefixed real question.

**The short-circuit runs before tool loading, not after.** Placing it earlier is what saves the MCP round trip. Mode validation had to move ahead of it so error behavior for an unknown mode did not change.

**CORS suffix matching is opt-in and requires a leading dot.** `endsWith(".personal-assistant-8ve.pages.dev")` cannot be satisfied by a project merely ending in those words, and Pages project names are unique per account, so the widened surface is exactly this project's own preview deployments. Verified against `evil-personal-assistant-8ve.pages.dev`.

**Retry, not a lower ceiling.** Lowering `MAX_INPUT_TOKENS` outright would waste context on every normal request. Retrying with a smaller budget only pays the cost when an overflow actually happens.

**Origin matching and intent detection were extracted into modules so they could be tested.** Neither was worth a module on size alone; both were worth it to get them under test without booting a Worker.

**04 stays local.** See "Open question resolved" below.

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

### Verified against production

- `GET /api/health` → 200
- `rag` + `Hello` → `"Hello, it's nice to meet you. How can I help you today?"` — no document content
- `rag` + `مرحبا` → `"مرحبا، كيف يمكنني مساعدتك اليوم؟"`
- `rag` + a real document question → 200, answers from the corpus
- `api` → 200 · `mcp` → 200
- CORS preflight: production origin allowed, preview origin allowed, `evil-personal-assistant-8ve.pages.dev` rejected, `attacker.example.com` rejected
- MCP server without an `Authorization` header → `401 Unauthorized`, confirming `MCP_AUTH_TOKEN` is set in production. Worth re-checking after any secret rotation: `01-mcp-search-server/worker/src/index.js:122` returns `true` when the token is unset, so a missing secret opens the endpoint silently.
- Production Pages serves `index-bymREW6j.js` with the correct `VITE_API_URL`
- `npm test` → 15 client tests, 15 worker tests, all passing

### File states

```
worker/src/intent.js          new    isSmallTalk
worker/src/intent.test.js     new    7 tests
worker/src/cors.js            new    isAllowedOrigin
worker/src/cors.test.js       new    8 tests
worker/src/agent.js           mod    runModel retry, small-talk short-circuit, prompts
worker/src/index.js           mod    delegates CORS to cors.js
worker/wrangler.toml          mod    CLIENT_ORIGIN_SUFFIXES
worker/package.json           mod    vitest, test scripts
server/agent.js               mod    system prompt synced
client/src/api.js             mod    logFailure
client/src/errors.test.js     new    15 tests
client/package.json           mod    vitest, test scripts
.gitignore                    mod    .playwright-mcp/, app-dashboard.yml
01-mcp-search-server/worker/  new    committed, was deployed but untracked
```

### Commits

```
025eb2c feat(mcp): add Cloudflare Worker for the MCP search server
ff278eb chore: ignore Playwright MCP snapshot output
7925e21 docs(assistant): record session 2 changes and verification
bbc5289 feat(assistant): allow Pages preview origins through CORS
61027d3 fix(assistant): stop calling tools for greetings and small talk
6bbc1a5 feat(assistant): show friendly errors instead of raw provider output
4722694 feat(assistant): add Cloudflare Workers API and deploy setup
```

Working tree is clean. Nothing untracked.

## 4. Open Question Resolved — deploy 04, or keep it local?

**Keep `04-trip-planner-a2a` local.**

1. The architecture is the lesson. 04 teaches A2A: four independent processes, agent cards at `/.well-known/agent.json`, JSON-RPC `tasks/send`, discovery. Collapsing it into Workers plus service bindings hides the thing it demonstrates.
2. It is a rewrite, not a deploy. `@langchain/*` and `ChatOllama` do not port to Workers. Project 02 needed the LangChain agent loop hand-rolled against Workers AI; 04 would repeat that across three agents and the orchestrator, with the SSE stream on top.
3. The cost shape is poor. One request fans out to three agent calls. Local Ollama at `qwen3.5:2b` is free; on Workers AI each plan bills neurons three times, on the same account already serving 02.

If it has to go public later, the cheap version is a single Worker with the agents on separate routes behind service bindings and Workers AI replacing Ollama — protocol preserved, one deploy target.

## 5. Next Steps

1. ~~**Add an agent-level test.**~~ Done in session 4 — `worker/src/agent.test.js`, 30 tests.
2. **Verify RAG answer quality at `topK=4`.** Open since session 1. If answers thin out as the corpus grows, raise `topK` and lower `MAX_TOOL_RESULT_CHARS` to compensate rather than removing the cap.
3. **Consider a larger-context model.** The 24000-token window of `llama-3.3-70b-instruct-fp8-fast` is still the binding constraint behind every limit in `agent.js`.
4. **Widen small-talk coverage as real traffic arrives.** The pattern list is a fixed set; check logs for greetings that still reach the tool loop.
5. **Make MCP auth non-optional.** `env.MCP_AUTH_TOKEN` is currently set, but the fail-open branch means a lost secret silently unauthenticates the endpoint.

---

# Session 3 — 2026-08-25

Scope: `02-personal-assistant` — PDF ingestion correctness.

## 1. The Bug

RAG answers over Arabic documents were nonsense. The stored chunks looked like this:

```
ي  العملd
ب
ي
در
ت
```

Investigation found two unrelated failures, not one, and neither was the RTL/ligature issue first assumed.

**Failure A — text runs joined in content-stream order.** `PDFLoader` from `@langchain/community` joins pdf.js text items with `parsedItemSeparator: ""` and inserts a newline whenever the y-coordinate changes. For an RTL line, pdf.js emits runs in visual right-to-left order, so concatenating them left-to-right reverses the words, and the empty separator glues the remains together. Affects `تقييم التدريب للشركة مسكر ومغلف ومختوم (2).pdf`.

**Failure B — no `ToUnicode` CMap.** `تقرير_التدريب_العملي_راما_الشيخة.pdf` embeds subsetted Identity-H fonts (`LFURXI+NotoNaskh`, `KPLIFR+Amiri-Bold`, `TLMVBT+NotoNaskh-Bold`) with zero `/ToUnicode` entries. The subsets keep a `cmap` table covering only 41–133 Latin codepoints; the ~1,500 Arabic glyphs are unnamed (`glyph00002`…) and `GSUB` is stripped, so there is no path from glyph ID back to a character. pdf.js, pypdf, and PyMuPDF all fail on it — the text simply is not in the file. Only rendering and OCR recovers it.

**Failure C — the chunker never advanced at the tail.** Independent of Arabic, and the failure behind the original Atlas complaint. `splitText` in `worker/src/ingest.js` advanced by `Math.max(slice.length - CHUNK_OVERLAP, 1)`. Once the remaining text fell below `CHUNK_OVERLAP` (200), that expression went negative and clamped to `1`, so `start` crept one character at a time to EOF, emitting a one-character-shorter suffix on every iteration.

`Atlas_Business_Overview_NoInvestor.pdf` was stored as 209 vectors of which **8** held real content. The other 201 were the same closing sentence, shifted by one character each:

```
"reating a smarter connection between\ncompanies and financing opportunities."
"d creating a smarter connection between\ncompanies and financing opportunities."
"and creating a smarter connection between\ncompanies and financing opportunities."
```

Extraction was never at fault here — pdf-parse and pdfjs-dist both returned byte-identical, clean text for this document (6607 chars, zero control characters). Retrieval was drowning in near-duplicates at `topK`. Fixed by breaking out of the loop once the slice reaches EOF (`if (atEnd) break;`).

Two further defects compounded the damage:

- `source` metadata held the multer temp path (`/var/folders/…/1787577518924-29baee639c3558.pdf`), making citations and dedup useless.
- Nothing deduplicated, so the same document was ingested five times.

## 2. What We Built

### `server/lib/arabic.js` (new)

`normalizeText()` — NFKC to fold Arabic Presentation Forms (`U+FB50–FEFF`) back to base letters, then strips tatweel (`U+0640`), harakat, and bidi controls, and maps Arabic-Indic digits and punctuation to ASCII. This alone converts `ﺍﻟﺟﺎﻣﻌﺔ ﺍﻟﻬﺎﺷﻣﻳﺔ` to `الجامعة الهاشمية`. Duplicated verbatim at `worker/src/arabic.js` — the two packages cannot share a module.

### `server/lib/pdf-text.js` (new)

Replaces `PDFLoader`. Groups text items into lines by y-coordinate (2.5pt tolerance), decides each line's direction from the weighted `dir` of its items, then orders runs by descending x for RTL and ascending x for LTR. Spaces are inserted from the measured inter-run gap rather than assumed.

`assessText()` / `assessDocument()` score the share of unmapped-glyph characters. A page above 1% is unusable; a document is unusable when under 60% of pages pass. This is the gate that catches failure B instead of silently indexing garbage.

### `server/lib/ocr.js` (new)

Pages failing the gate are rendered at 2× via `unpdf` + `@napi-rs/canvas` and transcribed by a local Ollama vision model (`gemma4:26b` by default). One retry, 15-minute per-page timeout, `keep_alive` set so the model is not reloaded between pages. Configurable through `OCR_FALLBACK`, `OCR_MODEL`, `OLLAMA_BASE_URL`, `OCR_SCALE`, `OCR_TIMEOUT_MS`. With `OCR_FALLBACK=off` the upload is rejected with an explanation instead.

### `server/ingest.js` (rewritten)

- Chunk IDs are `sha256(file bytes)#page#chunk`. Re-uploading identical bytes under any filename is detected with a single `listPaginated({ prefix })` call and skipped; `force: true` overrides.
- Metadata per vector: `text`, `source` (real filename), `contentHash`, `pageNumber`, `chunkIndex`, `extraction` (`text` or `ocr`).
- Embeds through `pc.inference.embed` and upserts directly, so IDs and metadata are under our control. `PineconeStore.addDocuments` was generating UUIDs, which is why nothing could ever be deduplicated or replaced.
- Mixed documents are handled per page: clean pages keep their text layer, damaged pages are OCR'd.

### `server/scripts/reindex.js`, `server/scripts/query.js` (new)

`reindex.js` reports per-source metadata health and supports `purge-legacy`, `purge-temp-sources`, `purge-source`, and `ingest`. `query.js` runs a direct Pinecone query with no agent in the loop — the fastest way to separate retrieval problems from generation problems.

### Query-side normalization

`server/tools.js` and `worker/src/tools.js` normalize the search query through the same `normalizeText` before embedding, so a query typed with diacritics matches chunks stored without them. Both now prefix each passage with `[source, p.N]` so the model can cite.

### Worker parity

`worker/src/ingest.js` gained the same line-grouping and RTL ordering, uses `normalizeText`, and switched dedup from `sha256(filename)` to `sha256(file bytes)` (`sha_` id prefix). Name-based `deleteByPrefix` is retained, intended to let a renamed edit of a document replace its old chunks — **this does not actually work, see §5.** `listByPrefix` was factored out of `deleteByPrefix` in `worker/src/pinecone.js`.

### Client

`describeIngest()` in `App.jsx` distinguishes ingested from skipped-as-duplicate and reports how many pages needed OCR. Previously a skip rendered as "Uploaded and ingested successfully."

### The agent was not searching at all

Once retrieval was fixed, an end-to-end test showed the RAG answers were still wrong — and the server log carried no `🔍 Agent is searching Pinecone` line for either question. `What is Atlas and who is it for?` returned a confident description of "a large-scale open-source AI model developed by Meta". The agent had answered from training data without ever calling the tool.

The cause was the session-2 system prompt: *"Call a tool when the user asks for information you do not already have."* That makes retrieval conditional on the model's own estimate of what it knows, and `qwen3.5:9b` was certain it knew what Atlas is.

`server/agent.js` and `worker/src/agent.js` now build the system prompt per mode. The RAG prompt makes the search unconditional — call `search_knowledge_base` first, every time, for anything that is not small talk — and states explicitly that a familiar-sounding name refers to the user's own documents, not to anything in training. The small-talk exception and the markdown-image passthrough rule are unchanged.

### Dependencies

`@langchain/community` and `pdf-parse` removed from `server/package.json` — nothing imports them now. `unpdf` and `@napi-rs/canvas` added.

## 3. Verification

39 worker tests pass (10 new in `arabic.test.js`, 5 new in `ingest.test.js` covering LTR/RTL ordering, line separation, and content-hash stability).

Extraction, measured:

| Document | Before | After |
|---|---|---|
| `تقييم التدريب…pdf` | scrambled | 0% unmapped glyphs, correct Arabic, 3 chunks |
| `تقرير_التدريب_العملي…pdf` | 14.9% unmapped glyphs | flagged unusable → 5/5 pages OCR'd → 7 chunks |
| `Atlas_Business_Overview…pdf` | text clean, but 209 chunks — 201 of them one-character-shifted duplicates of the closing sentence | 12 chunks, all distinct |

Direct Pinecone query for `ما هي الجامعة ومتى مدة التدريب؟` now returns the correct Arabic passages at 0.41 similarity, against 0.18 for the garbage chunks. `scripts/query.js` runs this without the agent in the loop.

End to end through `/api/chat` in RAG mode, after the prompt fix: both substantive questions call the tool, the Atlas answer is grounded in `Atlas_Business_Overview_NoInvestor.pdf` with no hallucination, and `Hello there!` still answers directly without a Pinecone query.

## 4. Index Surgery

All 68 vectors in the default namespace lacked a `contentHash` and were deleted, then the three documents were re-ingested through the new pipeline.

**Resolved — the 268 → 68 drop was this session.** Earlier in the same session, before the `server/` rewrite landed, the Atlas document was repaired against the Worker pipeline directly: its 209 UUID-id vectors were deleted and 9 replacement chunks upserted under `doc_`-prefixed ids. 268 − 209 + 9 = 68, which accounts for the count exactly. Nothing else writes to this index; no further audit is needed.

Those 9 `doc_` vectors were themselves superseded by the final purge and re-ingest, which is why the index now holds only `<contentHash>#<page>#<chunk>` ids.

**Current index contents** (22 vectors, default namespace, verified by direct fetch):

| Source | Chunks | Extraction |
|---|---|---|
| `Atlas_Business_Overview_NoInvestor.pdf` | 12 | text |
| `تقرير_التدريب_العملي_راما_الشيخة.pdf` | 7 | ocr |
| `تقييم التدريب للشركة مسكر ومغلف ومختوم (2).pdf` | 3 | text |

All 22 carry `contentHash`, `source`, `pageNumber`, `chunkIndex`, and `extraction`.

## 5. Two Defects Found While Writing These Notes

Both are in `worker/src/ingest.js`, both verified by reading the committed code against the live index. **Both were fixed in session 4 — see session 4 §2.**

**The Worker's name-based replace deletes nothing.** Vectors are written with `id: \`${contentPrefix(hash)}#${i}\`` → `sha_<hash32>#N`, but the replace call is `deleteByPrefix(env, \`${await documentPrefix(source)}#\`)` → `doc_<sha256(filename)16>#`. Nothing is ever written under a `doc_` prefix, so that prefix matches zero vectors on every upload. The claim in §2 that "name-based `deleteByPrefix` is retained so re-uploading a renamed edit of a document still replaces its old chunks" does not hold as implemented — an edited document re-uploaded under the same name is added alongside its old chunks, not in place of them. The content-hash skip still works, so identical bytes are still deduplicated; only the *edited* case leaks. Fix is to delete by the prefix that is actually written, or to store the source-name prefix as a second id namespace.

**The Worker and the server use incompatible id schemes, so neither sees the other's documents.**

```
server/ingest.js   id = `${contentHash}#${pageNumber}#${chunkIndex}`   e.g. 3c407fc0…52b#5#0
worker/src/ingest.js   id = `sha_${hash.slice(0,32)}#${i}`             e.g. sha_3c407fc0…#5
```

The server dedupes on `listPaginated({ prefix: \`${contentHash}#\` })` and the Worker on `listByPrefix(env, \`sha_${hash32}#\`)`. Neither prefix can match the other's ids. The client uploads through the Worker, so a document already ingested by `server/scripts/reindex.js` — which is how all 22 current vectors got there — will be ingested a second time by the first upload through the UI, with no skip and no replace. Worth settling on one scheme before the next upload.

## 6. Next Steps

1. **OCR is slow.** `gemma4:26b` runs half on CPU (9GB of 18GB in VRAM, 4096-token context) at roughly 4–5 minutes per page. A smaller vision model, or moving OCR to a background job with a progress endpoint, would make a 20-page upload tolerable.
2. **The Worker has no OCR path.** It rejects PDFs without a usable text layer. Recovering them in production needs a vision model reachable from Workers AI.
3. **`reindex.js` samples at `topK=1000`.** Fine at this corpus size; a real purge needs `listPaginated` over all IDs.
4. ~~**`arabic.js` is duplicated**~~ Fixed in session 4 — one copy at `shared/arabic.js`.
5. ~~**No agent-level test still.**~~ Done in session 4.
6. ~~**Reconcile the two ingestion pipelines.**~~ Done in session 4 — the Worker writes the server's id scheme.
7. ~~**The Worker changes are committed but not verified against production.**~~ Deployed and smoke-tested in session 4.

## 7. Current State

Working tree clean. Session 3 landed as:

```
4b81916 docs(assistant): record session 3 ingestion and retrieval fixes
47a8255 fix(assistant): make knowledge base search unconditional in RAG mode
3fa36fc feat(assistant): normalize search queries and cite passage sources
4b4591a fix(assistant): extract Arabic PDFs correctly and deduplicate ingestion
```

### File states

```
server/lib/arabic.js          new    normalizeText — NFKC fold, strip tatweel/harakat/bidi
server/lib/pdf-text.js        new    line grouping, RTL ordering, assessText/assessDocument
server/lib/ocr.js             new    unpdf render + Ollama vision transcription
server/ingest.js              rw     content-hash ids, per-page extraction, direct upsert
server/scripts/reindex.js     new    health report, purge-*, ingest
server/scripts/query.js       new    agentless Pinecone query
server/tools.js               mod    query normalization, [source, p.N] citation prefix
server/agent.js               mod    per-mode system prompt, unconditional RAG search
server/index.js               mod    latin1 filename re-decode, ingest result passthrough
server/package.json           mod    -@langchain/community -pdf-parse +unpdf +@napi-rs/canvas
worker/src/arabic.js          new    verbatim copy of server/lib/arabic.js
worker/src/arabic.test.js     new    10 tests
worker/src/ingest.js          mod    splitText EOF break, line grouping, RTL, content-hash
worker/src/ingest.test.js     new    14 tests
worker/src/pinecone.js        mod    listByPrefix factored out of deleteByPrefix
worker/src/tools.js           mod    query normalization, citation prefix
worker/src/agent.js           mod    per-mode system prompt
client/src/App.jsx            mod    describeIngest — ingested vs skipped, OCR page count
```

`npm test` in `worker/`: **39 passing** across 4 files (`arabic` 10, `ingest` 14, `intent` 7, `cors` 8).

---


# Session 4 — 2026-08-25

Scope: `02-personal-assistant` — land session 3, close the agent-test gap, reconcile the two ingestion pipelines, fix answer language, deploy Worker and frontend.

## 1. Session 3 Landed

Session 3's work was still uncommitted when this session started — it was item 6 on that session's list. It went in as four commits, split by concern rather than by file:

```
4b4591a fix(assistant): extract Arabic PDFs correctly and deduplicate ingestion
3fa36fc feat(assistant): normalize search queries and cite passage sources
47a8255 fix(assistant): make knowledge base search unconditional in RAG mode
4b81916 docs(assistant): record session 3 ingestion and retrieval fixes
```

## 2. What We Built

### Agent-level tests — `worker/src/agent.test.js` (new)

Open since session 2, and the reason session 3's "the agent was not searching at all" regression had to be found by reading server logs. 30 tests now drive `runAgent` against a stubbed `env.AI` and a `Map`-backed `CHAT_HISTORY`, with `./tools.js` and `./mcp.js` mocked so no Pinecone query or MCP fetch is made.

Covered: the small-talk short-circuit (no tool handler call, no `tools` in the request, `loadMcpTools` never reached), the RAG tool-call path, `MAX_CALLS_PER_ROUND`, `MAX_TOOL_ROUNDS` plus the synthesis fallback, `MAX_TOOL_RESULT_CHARS` truncation, a throwing tool handler surfacing as tool content rather than a 500, per-mode system prompts, history round-tripping, the 8007 retry including that the system prompt survives every trim, and the answer-language directive described in §4.

### `shared/arabic.js` — one copy instead of two

`server/lib/arabic.js` and `worker/src/arabic.js` were byte-identical, so a fix to the query side could silently diverge from the ingest side. Both now import `02-personal-assistant/shared/arabic.js`. `shared/package.json` carries `"type": "module"` so Node does not reparse it for the server. Verified the Worker still bundles it through `wrangler deploy --dry-run`.

### One vector-id scheme across both pipelines

Both defects recorded in session 3 §5 were confirmed against the code and fixed.

`worker/src/ingest.js` wrote ids `sha_<hash32>#<n>` but deleted the prefix `doc_<sha256(name)16>#` — a prefix nothing is ever written under, so the replace-on-reupload path matched zero vectors on every ingest. Separately, `server/ingest.js` writes `<contentHash>#<page>#<chunk>` and dedupes on `<contentHash>#`, so neither pipeline could see the other's documents: the first UI upload would have re-indexed everything `reindex.js` had already ingested.

The Worker now chunks per page and writes the server's id scheme. `extractPdfText` became `extractPdfPages`, returning `[{pageNumber, text}]`. A new `buildChunks` numbers chunks per page and adds `pageNumber` and `extraction` to metadata, which the `[source, p.N]` citation prefix in `tools.js` already reads but the Worker had never supplied. `documentPrefix`, `contentPrefix`, and the dead `deleteByPrefix` call are gone.

### Answer language

See §4 — the fix, and the regression it caused on the way.

### Browser tab title

`client/index.html` still carried Vite's scaffold title, `client`. Now `Agentic Personal Assistant`.

## 3. Key Decisions

**Vector ids key on content hash alone.** Ids stay `sha256(bytes)#page#chunk`, so identical bytes are skipped under any filename and the 22 live vectors need no migration. The cost is that an *edited* document re-uploaded under the same name is added alongside its old chunks rather than replacing them; `scripts/reindex.js purge-source` is the cleanup path. Keying on the source name as well would have made replace-on-edit work, at the price of re-ingesting the whole index and double-indexing the same bytes under two names.

**The agent tests mock `./tools.js`, not `fetch`.** Asserting on a tool *handler* spy is what makes "did the agent actually search?" a direct assertion. Stubbing at the network layer would have tested the Pinecone client as much as the agent loop.

**`shared/` is a plain directory, not a workspace package.** Both consumers reach it by relative path — esbuild bundles it for the Worker, Node resolves it for the server. A published package would add a build step to a teaching repo for one 47-line module.

**The language directive is added at call time, not pushed onto `messages`.** It has to sit last, after the tool results, on every call — but it is scaffolding, not conversation. Building it into the array passed to `runModel` keeps it out of `messages` and out of saved history.

**Language is detected in code, not inferred by the model.** `hasArabic(message)` decides which directive text is sent, so the Arabic branch names the target language outright instead of leaving the model to work it out from context that is itself half Arabic.

## 4. Answer Language — Fixed, After a Regression

`ما هي مدة فترة التدريب؟` retrieved the right Arabic passage and answered correctly, in English. The rule "Answer in the language the user wrote in" sat mid-prompt, ahead of the tool results, and `llama-3.3-70b-instruct-fp8-fast` dropped it once a long passage block followed. The small-talk path was unaffected because its prompt is short and carries no tool output.

Two changes in `worker/src/agent.js`, with the system-prompt half mirrored in `server/agent.js`:

- `LANGUAGE_RULE` now closes the system prompt, after the mode rules and the shared rules.
- `languageDirective(message)` is appended as a final user message on every model call that follows a tool round, and to the synthesis fallback, via `withLanguageDirective`.

**The first attempt regressed English.** The directive read "write your entire answer in the same language as the question above". With Arabic passages sitting between the question and the directive, the model read the nearest Arabic text as "the question above" and answered *English* prompts in Arabic — reproduced on fresh session ids, so not history contamination. The directive now quotes the question verbatim (`The user asked: "…"`) and tells the model not to switch to the tool results' language.

Worth keeping in mind for any future prompt work here: **a positional reference like "above" is not safe in a multilingual tool loop.** Name the thing.

## 5. Index State — No Purge Was Needed

A request to purge 45 corrupted vectors and re-ingest was checked before anything was deleted. That state no longer exists; session 3's index surgery had already cleared it. `node scripts/reindex.js stats`:

```
total vectors: 22
    12  hashed=12  extraction=text  Atlas_Business_Overview_NoInvestor.pdf
     7  hashed=7   extraction=ocr   تقرير_التدريب_العملي_راما_الشيخة.pdf
     3  hashed=3   extraction=text  تقييم التدريب للشركة مسكر ومغلف ومختوم (2).pdf
```

All 22 carry `contentHash`, the broken-font document is present as OCR output, and no vector holds a temp-path source. Nothing was purged and nothing was re-ingested — the three documents already in the index are the output of the new pipeline, and every live answer below is drawn from them. Deleting and re-ingesting would have destroyed good data, including 7 OCR'd pages the Worker cannot regenerate: it has no OCR path and rejects that PDF outright.

## 6. Verification

`npm test` — worker **70 passing** (`agent` 30, `ingest` 15, `arabic` 10, `intent` 7, `cors` 8), client **15 passing**.

RAG answers against production, each on a fresh session id, two passes:

| Question | Language | Grounding |
|---|---|---|
| `tell me about business overview for Atlas` | EN, EN | `Atlas_Business_Overview_NoInvestor.pdf` p.1/p.4/p.9/p.10 |
| `tell me about folowise training` | EN, EN | `تقرير_التدريب_العملي_راما_الشيخة.pdf` p.1/p.2/p.4 |
| `what is the ESG scoring process?` | EN, EN | `Atlas_Business_Overview_NoInvestor.pdf` p.6 |
| `ما هي مدة فترة التدريب؟` | AR, AR | same, p.1 |
| `ما هي عملية تقييم ESG؟` / `أخبرني عن تدريب فولوايز` | AR, AR | grounded |
| `ما هو أطلس ولمن هو موجه؟` | AR, AR | grounded |

12/12 on language. Every substantive answer carried a real `[filename, p.N]` citation, which is only possible because page-level metadata now exists on the vectors.

Also verified: `مرحبا` answers in Arabic and `Hello` in English through the small-talk path with no retrieval; `api` and `mcp` modes return 200; `GET /api/health` 200; production Pages serves `<title>Agentic Personal Assistant</title>`.

## 7. Current State

### Deployed

| Component | Value |
|---|---|
| Worker API | https://personal-assistant-api.alsheikharama.workers.dev |
| Worker version | `e85c87c4-8a0f-4153-a05b-240d0a368ef5` |
| Frontend (production) | https://personal-assistant-8ve.pages.dev |
| Frontend (preview, this session) | https://aec76486.personal-assistant-8ve.pages.dev |
| Client bundle | `index-Cjuhvmmp.js` |
| MCP server | https://mcp-search-server.alsheikharama.workers.dev/mcp |
| Pinecone | 22 vectors, default namespace, 3 sources |

Worker deploys this session, in order: `82846a5d` (id unification) → `75a84b1b` (first language attempt, regressed English) → `e85c87c4` (current).

The frontend had not been rebuilt since session 2. This session's Pages deploy therefore also shipped session 3's `describeIngest` upload messaging, which distinguishes an ingest from a skipped duplicate and reports OCR page counts — it had been written and committed but never served.

### File states

```
worker/src/agent.test.js      new    30 tests, fake env.AI + KV
worker/src/agent.js           mod    LANGUAGE_RULE last, languageDirective after tool results
worker/src/ingest.js          mod    extractPdfPages, buildChunks, server id scheme
worker/src/ingest.test.js     mod    chunk id + buildChunks tests replace prefix tests
worker/src/tools.js           mod    imports shared/arabic.js
worker/src/arabic.js          del    moved to shared/
shared/arabic.js              new    moved from server/lib/, single copy
shared/package.json           new    "type": "module"
server/agent.js               mod    LANGUAGE_RULE last (prompt parity)
server/tools.js               mod    imports shared/arabic.js
server/lib/pdf-text.js        mod    imports shared/arabic.js
server/lib/ocr.js             mod    imports shared/arabic.js
server/scripts/query.js       mod    imports shared/arabic.js
client/index.html             mod    <title>Agentic Personal Assistant</title>
SESSION_NOTES.md              mod    this section
```

Working tree clean.

### Commits

```
be3ef4d fix(assistant): set the browser tab title to the app name
d56e0ae docs(assistant): record the answer-language fix and its English regression
60b260f fix(assistant): answer in the language the question was asked in
2ae3344 docs(assistant): record session 4 tests, id unification, and deploy
39503b1 fix(assistant): give the Worker the same vector ids as the server
9b3e223 refactor(assistant): share the Arabic normalizer between server and worker
9d9f54b test(assistant): cover runAgent against a fake Workers AI binding
4b81916 docs(assistant): record session 3 ingestion and retrieval fixes
47a8255 fix(assistant): make knowledge base search unconditional in RAG mode
3fa36fc feat(assistant): normalize search queries and cite passage sources
4b4591a fix(assistant): extract Arabic PDFs correctly and deduplicate ingestion
```

An external edit to `SESSION_NOTES.md` — session 3's Failure C, its §4 reconciliation, and its §5 defect report — arrived mid-session and was swept into `9b3e223` rather than committed on its own. The content is intact.

## 8. Next Steps

1. **The model transcribes instead of summarising.** `أخبرني عن تدريب فولوايز` answers in Arabic but reproduces the retrieved passages close to verbatim — headings, bullet marks, and page furniture included. The RAG prompt says to ground and cite, but never to write in its own words. A "summarise in your own words, do not transcribe" clause next to the citation rule is the fix. Highest-value item left, and the only one visible to a user.
2. **The duplicate-skip path is unverified end to end.** The id unification means a UI upload of an already-ingested document should now return `status: "skipped"` and render as "already in the knowledge base". No copy of the three PDFs is in this repo, so it was never exercised against production. Re-upload any of the three through the UI to confirm.
3. **The Worker has no OCR path.** It rejects a PDF with no usable text layer. `تقرير_التدريب_العملي_راما_الشيخة.pdf` can only be ingested through `server/`, which needs local Ollama — so production cannot recover a scanned document on its own.
4. **Server-side ingestion has no tests.** `server/lib/pdf-text.js` and `server/lib/ocr.js` are untested and the server has no test runner configured. The Worker's equivalents are covered; the server's are not, and the server is what produced every OCR'd vector in the index.
5. **`reindex.js` samples at `topK=1000`.** Fine at 22 vectors; a real audit needs `listPaginated` over all ids.
6. **Make MCP auth non-optional.** Unchanged since session 2. `01-mcp-search-server/worker/src/index.js:122` returns `true` when `MCP_AUTH_TOKEN` is unset, so a lost secret silently opens the endpoint.
7. **Consider a larger-context model.** The 24000-token window of `llama-3.3-70b-instruct-fp8-fast` is still the constraint behind every limit in `agent.js`, and now behind the trimming that the language directive has to survive.

---

# Session 5 — 2026-08-26

Scope: no code change. Recorded here because the account-level facts changed under this project.

## 1. Workers Paid

The account moved off the free plan, so the 10,000-neuron daily allocation shared by every project on it no longer applies. This was the blocker behind `03` and `05`'s deferred verification, not anything in this worker.

## 2. The MCP Token Was Rotated

`MCP_AUTH_TOKEN` was replaced on all four workers that speak MCP, in one pass: `mcp-search-server`, `personal-assistant-api`, `trip-planner-api`, and `a2a-search-agent`. The last two are new holders — `03` and `04` had never had it, which is why both were returning 401 over their Service Bindings.

Because this worker holds a copy, a rotation that missed it would have taken MCP mode down. It was re-tested immediately afterwards.

## 3. Verification

| Check | Result |
|---|---|
| `mcp-search-server` `/health` | 200 `{"ok":true,"server":"serp-search-mcp"}` |
| `mode: "mcp"` | real SerpAPI weather result for Amman |
| `mode: "api"` | real result |
| `mode: "rag"` | Pinecone hit; correctly reported the knowledge base has no weather data |

All three modes work on the rotated token. §8's items are all unchanged — in particular item 6, **make MCP auth non-optional**, is now more pointed than it was: four workers depend on that check, and `01-mcp-search-server/worker/src/index.js:122` still returns `true` when the secret is unset. A rotation that cleared the value rather than replacing it would open the endpoint silently instead of failing loudly.
