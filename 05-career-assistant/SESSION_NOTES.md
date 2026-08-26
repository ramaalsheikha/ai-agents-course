# Session Notes

Single source of truth for `05-career-assistant`. Newest session last; the live state of the system is **session 2 §3**, and the open work is **session 2 §4**.

---

# Session 1 — 2026-08-26

Scope: migration from local Express + Anthropic to Cloudflare Workers AI + Pages

## 1. Starting Point

The app was a local-only LangGraph multi-agent demo:

- `server/index.js` — Express on port 3001, `cors()` wide open, sessions in a module-level `Map`, SSE hand-rolled with `res.write` / `res.flushHeaders`.
- `server/career-agent.js` — three-node LangGraph: `resumeAnalyzer` and `marketResearcher` fan out from `START`, both fan in to `gapAnalyst`. Each node called `ChatAnthropic` (`claude-sonnet-4-20250514`).
- `client/src/App.jsx` — React 19 + Vite, `http://localhost:3001` hardcoded at two call sites, `EventSource` for the stream.

The two-step handshake exists because `EventSource` cannot POST: the client POSTs the payload to `/start`, gets a session id, then opens the stream with that id as a query param.

## 2. What We Built

New `worker/` directory deployed as a Cloudflare Worker, plus the client repointed at it and deployed to Pages.

**`worker/src/index.js`** — Hono app, routes ported 1:1 from Express.

- `POST /api/career/start` — validates `resume` / `targetMarket` / `targetRole`, writes the payload to KV under a `crypto.randomUUID()` key, returns `{ sessionId }`.
- `GET /api/career/stream` — reads and deletes the KV entry, then `streamSSE(c, ...)`. Emits the same three frame types as the Express version: `agent_status`, `result`, `error`. The client needed no protocol changes.
- `GET /api/health` — `{ ok: true }`.
- CORS restricted to known origins (see §3).

**`worker/src/career-agent.js`** — the LangGraph graph, unchanged in shape. Model calls replaced (§3).

**`worker/src/cors.js`** — copied verbatim from `02-personal-assistant/worker/src/cors.js`.

**`worker/wrangler.toml`** — `career-assistant-api`, `nodejs_compat`, `[ai]` binding, KV namespace `SESSIONS`, `[vars]` for model id and allowed origins.

## 3. Key Decisions

### Workers AI replaces ChatAnthropic

All three nodes went through one helper instead of three `new ChatAnthropic(...)` instances:

```js
async function invokeModel(env, prompt, temperature) {
  const response = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, {
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: 2048,
  });
  const text = typeof response === "string" ? response : response.response || "";
  return text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}
```

- Model id lives in `[vars] AI_MODEL` rather than in code, matching `02`. `DEFAULT_MODEL` is the fallback.
- Per-node temperatures preserved from the Anthropic version: resume 0, market 0, gap 0.3.
- The fence strip is new. Llama wraps JSON in ``` fences more often than Sonnet did, and all three prompts demand raw JSON. The client already strips fences at `client/src/App.jsx:84`; that stays as a backstop, so the payload is cleaned on both sides.

### `env` threaded through graph state

Workers have no `process.env`. Rather than pass `env` down through every node signature, it was added as a field on the `CareerState` annotation and supplied once at `graph.invoke()`. Nodes destructure it from `state` alongside their other inputs. `marketResearcherNode` reads `env.SERPAPI_API_KEY` this way; the model helper takes it as its first argument.

### KV replaces the in-memory Map

The `Map` was not merely non-idiomatic on Workers — it was broken. `/start` and `/stream` are separate requests and can land in different isolates, so the second lookup would miss. Sessions now use `SESSIONS.put/get/delete` with `expirationTtl: 600`, which also cleans up sessions where the client never opens the stream. The stream handler deletes the key immediately after reading, preserving the original single-use semantics.

### CORS narrowed from `cors()` to an origin allowlist

The Express version allowed every origin. The worker uses `02`'s `isAllowedOrigin`, which checks an exact-match list plus an https-only suffix match so Pages preview deployments work without opening the door to lookalike domains. Configured via `CLIENT_ORIGIN` and `CLIENT_ORIGIN_SUFFIXES`.

### Naming follows 02

Worker `career-assistant-api`, Pages project `career-assistant` — same `-api` suffix convention as `personal-assistant-api` / `personal-assistant`.

### `server/` left untouched

Still Express, still `ChatAnthropic`, still runnable with `npm run dev:server`. Kept as the reference implementation for the course material.

## 4. Deployed Resources

| Resource | Value |
|---|---|
| Worker | https://career-assistant-api.alsheikharama.workers.dev |
| Pages (production) | https://career-assistant-3by.pages.dev |
| Pages (this deploy) | https://a5b318af.career-assistant-3by.pages.dev |
| KV namespace `SESSIONS` | `537fc6a979ac471c82907787a859bd62` |
| Worker version | `eda8e10e-620c-45a0-a068-0f88a0086098` |
| Account | `e524b4a1ac42eea56ccb0651083b2f9f` |

`SERPAPI_API_KEY` is a Worker secret, uploaded with `wrangler secret put` from the value already in `server/.env`. `worker/.dev.vars` holds a placeholder for local runs and is gitignored.

## 5. Current File State

Uncommitted at the end of this session:

| Path | State |
|---|---|
| `worker/` | untracked — new directory, deployed |
| `worker/src/index.js` | Hono + streamSSE + KV + origin-checked CORS |
| `worker/src/career-agent.js` | LangGraph graph on Workers AI, `env` in state |
| `worker/src/cors.js` | copy of `02-personal-assistant/worker/src/cors.js` |
| `worker/wrangler.toml` | KV id and both origin vars filled in with real values |
| `worker/.dev.vars` | placeholder SerpAPI key, gitignored |
| `client/src/App.jsx` | modified — `API_URL` from `import.meta.env.VITE_API_URL`, fallback `http://localhost:8787` |
| `client/.env.development` | untracked — `http://localhost:8787` |
| `client/.env.production` | untracked — worker URL |
| `client/.env.example` | untracked — `<your-subdomain>` placeholder |
| `server/**` | unchanged |

## 6. Verification

Local (`wrangler dev`, local KV, placeholder secret):

- `/api/health` 200 with `Access-Control-Allow-Origin` echoed for `http://localhost:5175`; no ACAO header for a foreign origin.
- `/start` returns a uuid; unknown session id → `{"error":"Session not found"}`; missing fields → 400.
- Real session streamed SSE frames and both branch agents fired in parallel, confirming LangGraph runs under `workerd`.

Production, after both deploys:

| Check | Result |
|---|---|
| Pages serves | 200 |
| `/api/health` from Pages origin | 200, ACAO echoed |
| `/api/health` from `evil.example.com` | no ACAO header |
| `POST /start` → KV | sessionId returned |
| `GET /stream` SSE | 6 frames, both branch agents fired in parallel |
| llama inference | **failed** |

```
4006: you have used up your daily free allocation of 10,000 neurons,
please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.
```

Account-level Workers AI quota, not a defect in the port. The same allocation feeds `personal-assistant-api`, which shares the `AI` binding on this account.

SerpAPI was ruled out separately: a direct call with the deployed key returned HTTP 200 and 10 job results for the same query. The secret is good.

**Workers AI inference has therefore never completed end-to-end on this project.** Everything up to and including the model call is verified; the model's actual output is not.

## 7. Next Steps (as written at the end of session 1)

1. **Re-run the end-to-end test after the quota resets** at 00:00 UTC. A one-shot cron job (`8e8d6af1`) is scheduled for 03:06 local / 00:06 UTC on 2026-08-27 to do this. That job is session-only and in-memory — if the Claude session was closed, or the machine asleep, or the REPL busy at that moment, it did not run and the test must be triggered manually.
2. **Confirm the three JSON payloads parse** once inference succeeds. This is the main open risk of the model swap: llama-3.3-70b is less reliable than Sonnet at "respond ONLY with valid JSON", and the prompts were carried over unchanged. If parsing fails, the fix is to tighten the prompts or pass a `response_format` json_schema to `AI.run`, not to loosen the client parser.
3. **Consider Workers Paid ($5/mo).** 10,000 neurons/day is thin for a three-call graph shared with `02`.
4. **Commit.** Nothing from this session is committed yet.
5. **Update `README.md`.** It still describes the local Express setup and port 3001, which is no longer how the deployed app runs.
6. **Optional: port `02`'s `cors.test.js`.** `cors.js` was copied without its test; `worker/` has no test runner configured.

---

# Session 2 — 2026-08-26

Scope: closing out the non-blocked items from session 1 §7 — the `cors.js` test port, the README, and the commit — plus a graph test suite that turned up an error-reporting bug.

## 1. What Was Blocked

Session 1 §7 item 1 (re-run end-to-end inference) could not be done. The Workers AI free allocation resets at 00:00 UTC; the session-1 failure happened at ~11:40 UTC on 2026-08-26, so the next reset is 00:00 UTC on 2026-08-27. Session 2 ran at 11:57 UTC on 2026-08-26 — inside the same quota day.

**Workers AI inference still has not completed end-to-end on this project.** That is unchanged from session 1 §6 and remains the single largest unverified area.

Session 1's one-shot cron `8e8d6af1` **did not survive** — `CronList` returned nothing when this session checked, confirming the caveat session 1 §7 wrote about it. Cron jobs are session-only and in-memory, and that session had ended.

It was replaced later in this session with one-shot cron `2b13c8a4`, firing 03:07 local / 00:07 UTC on 2026-08-27, which covers the deferred end-to-end tests for **both** this project and `03-trip-planner-langgraph` (migrated to Cloudflare in the same session). The caveat is unchanged and applies equally: if this session closes, the machine sleeps, or the REPL is mid-query at 00:07, it will not fire and both tests must be run by hand.

## 2. What Was Done

### `worker/src/cors.test.js` ported

Ported from `02-personal-assistant/worker/src/cors.test.js` with this project's origins substituted:

- `CLIENT_ORIGIN` — `http://localhost:5175,https://career-assistant-3by.pages.dev`
- `CLIENT_ORIGIN_SUFFIXES` — `.career-assistant-3by.pages.dev`

Two cases were added beyond a straight copy: the local dev origin `http://localhost:5175` is asserted allowed (02's env had no localhost entry, this one does), and the "rejects other Pages projects" case now uses `personal-assistant-8ve.pages.dev` so the two sibling projects are explicitly proven not to cross-allow each other. The lookalike case (`evil-career-assistant-3by.pages.dev`) is the important one — it is what the dot-prefixed suffix match exists to stop.

`vitest ^3.2.7` added to `worker/package.json` devDependencies with `test` / `test:watch` scripts, matching 02. 9 tests, all passing.

### `README.md` rewritten

The old README described only the Express setup and told the reader to supply an `ANTHROPIC_API_KEY`, which is no longer how the deployed app runs. Rewritten around the fact that the graph now exists twice:

- A **Two Backends** table stating plainly that `worker/` is deployed and `server/` is the local course reference, with the runtime, model, and session store for each.
- Separate run instructions per backend, including `wrangler dev` on 8787 and the `VITE_API_URL` value the client needs for each.
- A **Configuration** section covering the three `[vars]`, the two bindings, and the fact that `SERPAPI_API_KEY` is a `wrangler secret put` secret rather than a var.
- A **Deploying** section, and the note that a first Pages deploy has to be followed by adding its URL to `CLIENT_ORIGIN` and redeploying the worker — otherwise the client is CORS-blocked by its own backend.
- The two-step `EventSource` handshake is now documented in Architecture rather than living only in these notes.

Ports table keeps 3001 but adds 8787, since both backends are still runnable.

### `worker/src/career-agent.test.js` added, and it found a real bug

The graph is now tested with a stubbed `AI` binding and a stubbed `fetch`, so the whole three-node run is exercised without spending a single neuron. 12 tests. What they pin down:

- All three payloads survive as parseable JSON when the model wraps them in ```` ```json ```` fences, in bare ``` fences, or in nothing at all. This is the session-1 §7 item 2 risk, tested from the worker side.
- `AI.run` returning a plain string is handled as well as `{ response }`.
- The fan-in actually feeds both branch outputs into the gap analyst's prompt.
- `AI_MODEL` is honoured, the hardcoded default is used when it is unset, and the per-node temperatures are still 0 / 0 / 0.3.
- `onProgress` emits `start` and `done` for all three agents.
- SerpAPI is queried with `engine=google_jobs` and `q="<role> in <market>"`, a missing key and a non-2xx both throw, and an empty result set still runs the graph to completion.

The quota test — both branch nodes throwing 4006 — failed, and not because the test was wrong:

```
expected [Function] to throw error including '4006'
but got 'Multiple errors occurred during superstep 1. See the "errors" field of this exception for more details.'
```

When more than one node fails inside the same superstep, LangGraph aggregates them and puts the real causes in `err.errors`, leaving `err.message` as that placeholder. `index.js` sends `err.message` straight into the SSE `error` frame, so the user would have seen the placeholder instead of the actual reason.

The production run earlier this session *did* show the real 4006 text, which is why session 1 never caught this: `marketResearcher` awaits SerpAPI before its model call, so `resumeAnalyzer` usually fails first and alone. Whether the user sees a real error message or a placeholder is a race.

Fixed in `career-agent.js` with `flattenGraphError`: `graph.invoke` is wrapped, and an error carrying an `errors` array is rethrown with the nested messages joined and the original kept as `cause`. Single-node failures pass through untouched.

### Committed

Everything from sessions 1 and 2 landed in one commit. `worker/.dev.vars` and `server/.env` are gitignored and were confirmed absent from the staged set before committing. `client/.env.development` and `client/.env.production` are **not** gitignored and are committed deliberately — they hold only a localhost URL and the public worker URL, no secrets.

## 3. Current File State

All of `05-career-assistant` is committed. Working tree clean except for anything written after this note.

| Path | State |
|---|---|
| `worker/src/index.js`, `worker/src/cors.js` | committed, deployed |
| `worker/src/career-agent.js` | committed and deployed, with `flattenGraphError` |
| `worker/src/cors.test.js` | committed, 9 passing |
| `worker/src/career-agent.test.js` | committed, 12 passing |
| `worker/package.json` | committed, now has vitest + `npm test` |
| `worker/wrangler.toml` | committed, real KV id and origins |
| `worker/.dev.vars` | gitignored, local only |
| `client/src/App.jsx` | committed, `VITE_API_URL` |
| `client/.env.{development,production,example}` | committed |
| `README.md` | committed, rewritten |
| `server/**` | unchanged since before session 1 |

The worker was redeployed after `flattenGraphError` landed — version `4ab55cc0-b7c9-4106-9129-2eef1fed2975`, superseding session 1's `eda8e10e`. Post-deploy checks: `/api/health` 200 with ACAO echoed for the Pages origin, no ACAO for a foreign origin. Nothing in `client/` changed, so Pages was not redeployed and the URLs in session 1 §4 still stand.

Workers Paid was declined; the project stays on the 10,000 neuron/day free tier. Note that `03-trip-planner-langgraph` was migrated to Workers AI later in this same session, so three projects now share that one daily allocation.

## 4. Next Steps

1. **Re-run the end-to-end test after 00:00 UTC 2026-08-27.** Still the top item, still unverified. `POST /api/career/start` then `GET /api/career/stream` against `https://career-assistant-api.alsheikharama.workers.dev` and read the `result` frame. Cron `2b13c8a4` is scheduled to do this, with the caveats in §1.
2. **Confirm the three JSON payloads parse.** Same open risk as session 1 §7 item 2: llama-3.3-70b is less reliable than Sonnet at "respond ONLY with valid JSON" and the prompts were carried over unchanged. If parsing fails, tighten the prompts or pass a `response_format` json_schema to `AI.run` — do not loosen the client parser.
3. **Consider a `response_format` json_schema on `AI.run`.** The tests prove the fence stripping handles what the model *might* wrap the JSON in, but they cannot prove llama will emit well-formed JSON in the first place; only item 1 can. A json_schema would make item 2 a non-issue rather than a tested-around risk.
