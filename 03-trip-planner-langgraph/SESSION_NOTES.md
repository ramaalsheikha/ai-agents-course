# Session Notes

Single source of truth for `03-trip-planner-langgraph`. Newest session last; the live state of the system is **session 1 §5**, and the open work is **session 1 §8**.

---

# Session 1 — 2026-08-26

Scope: migration from local Express + LangGraph + Anthropic to Cloudflare Workers AI + Pages, following the same shape as `02-personal-assistant` and `05-career-assistant`.

## 1. Starting Point

- `server/index.js` — Express on 3001, `cors()` wide open, SSE hand-rolled with `res.write`. One route, `GET /api/trip/stream`, taking `destination` / `days` / `budget` / `people` as query params.
- `server/trip-agent.js` — three-node LangGraph: `searchAgent` and `budgetAgent` fan out from `START`, both fan in to `itineraryAgent`. All three used `ChatAnthropic` (`claude-sonnet-4-20250514`). The search node built a `MultiServerMCPClient` over HTTP to `localhost:3002/mcp` and drove it with `createAgent` from `langchain`.
- `client/src/App.jsx` — React 19 + Vite on 5174, `http://localhost:3001` hardcoded at one call site, `EventSource` for the stream.

Unlike `05-career-assistant`, the client only ever issues a GET with query params, so there is no POST/session handshake to replicate and **no KV namespace is needed**.

## 2. What We Built

**`worker/src/index.js`** — Hono app. `GET /api/trip/stream` validates `destination`, coerces the three numeric params through a `positiveInt` helper (so `days=0` or `days=abc` fall back to the defaults rather than producing a zero-day trip), and wraps the run in `streamSSE`. Frame types are unchanged from Express — `agent_status`, `result`, `error` — so the client needed no protocol changes. Plus `GET /api/health`.

**`worker/src/trip-agent.js`** — the three agents without LangGraph.

**`worker/src/mcp.js`** — copied from `02-personal-assistant/worker/src/mcp.js`, with `clientInfo.name` changed to `trip-planner` and a `resetToolCache()` export added so tests are not order-dependent.

**`worker/src/cors.js`** — copied verbatim from `02`.

**`worker/wrangler.toml`** — `trip-planner-api`, `[ai]` binding, `[[services]]` binding to `mcp-search-server`, four `[vars]`.

## 3. Key Decisions

### LangGraph replaced with `Promise.allSettled`

A three-node fan-out/fan-in does not need a graph runtime. The whole orchestration is now:

```js
const settled = await Promise.allSettled([
  track("search", () => searchAgent({ env, destination })),
  track("budget", () => budgetAgent({ env, destination, days, budget, people })),
]);
```

`allSettled` rather than `all` is deliberate, and it is the lesson carried over from `05-career-assistant` session 2. With `Promise.all`, the first rejection wins and the second branch's rejection becomes an unhandled rejection — the user sees one cause and the other is lost. `allSettled` collects both, and the throw joins every failure message.

That paid off within minutes of deploying: the first production run returned **both** real causes in one frame — the MCP 401 *and* the Workers AI 4006 — instead of whichever lost the race.

Dropping LangGraph also drops `nodejs_compat`; the worker is 81 KiB uploaded / 21 KiB gzipped.

### Two models, split by output shape

- `TEXT_MODEL` = `@cf/openai/gpt-oss-120b` — search and budget. Prose and tool calling.
- `JSON_MODEL` = `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — itinerary. One large strict-schema JSON object, at `temperature: 0`.

Both are `[vars]`, so either can be swapped without touching code, and both are covered by an override test.

`gpt-oss` can answer in the Responses-API shape — an `output` array carrying `reasoning` parts alongside the `message` part — rather than a flat `response` string. The shared `toText` helper handles string, `{ response }`, `{ content }`, and `{ output: [...] }`, and **filters out `reasoning` parts**. Without that filter the model's chain of thought would be pasted into the itinerary prompt as if it were research findings. There is a test pinning exactly this.

### MCP over a Service Binding

`[[services]] binding = "MCP"` points at the already-deployed `mcp-search-server` Worker. `02`'s `mcp.js` already prefers `env.MCP.fetch(...)` over global `fetch` when the binding exists, so this needed no client change — traffic stays inside Cloudflare instead of egressing to the public URL. `MCP_SERVER_URL` is still set, because the request object needs a URL and the *path* (`/mcp`) still routes inside the target worker even though the host is ignored.

`@langchain/mcp-adapters` and `createAgent` are gone. The search agent runs the same hand-rolled tool loop as `02`: discover tools, hand the model OpenAI-style function schemas, execute up to 2 calls per round for up to 3 rounds, truncate each tool result to 2500 chars, and fall back to a no-more-tools synthesis call if the model finishes holding only tool calls and no prose.

### CORS narrowed from `cors()` to an origin allowlist

Same `isAllowedOrigin` as `02` and `05`: exact-match list plus an https-only suffix match so Pages previews work without admitting lookalike domains.

## 4. Deployed Resources

| Resource | Value |
|---|---|
| Worker | https://trip-planner-api.alsheikharama.workers.dev |
| Worker version | `7758b0de-0ee3-4ab0-a0a9-45342ced3fca` |
| Pages (production) | https://trip-planner-8xe.pages.dev |
| Pages (this deploy) | https://95a96b87.trip-planner-8xe.pages.dev |
| Service Binding target | `mcp-search-server` (version `4617a6cb`) |
| Account | `e524b4a1ac42eea56ccb0651083b2f9f` |

No KV namespace and no new secrets on the MCP server side.

## 5. Current File State

| Path | State |
|---|---|
| `worker/src/index.js` | Hono + streamSSE + origin-checked CORS |
| `worker/src/trip-agent.js` | three agents, `Promise.allSettled`, two models |
| `worker/src/mcp.js` | copy of `02`'s, plus `resetToolCache()` |
| `worker/src/cors.js` | copy of `02`'s |
| `worker/src/{cors,trip-agent}.test.js` | 22 tests, all passing |
| `worker/wrangler.toml` | real Pages origins, service binding, four vars |
| `worker/.dev.vars` | not created; `.dev.vars.example` holds the `MCP_AUTH_TOKEN` key |
| `client/src/App.jsx` | `API_URL` from `import.meta.env.VITE_API_URL`, fallback `http://localhost:8787` |
| `client/.env.{development,production,example}` | localhost:8787 / worker URL / placeholder |
| `README.md` | rewritten around the two backends |
| `package.json` | added `dev:worker` and `test:worker` |
| `server/**` | unchanged |

## 6. Verification

Tests: 22 passing (`npm --prefix worker test`). The `AI` binding and the MCP service binding are both stubbed, so the full three-agent flow runs on zero neurons. Covered: itinerary JSON parsing (bare, fenced, and unparseable), `gpt-oss` `output`-array handling with reasoning filtered out, the MCP tool loop reaching `tools/call` with the right arguments and feeding the result back as a `tool` message, traffic going over the binding and never over global `fetch`, model routing per agent plus the `TEXT_MODEL` / `JSON_MODEL` overrides, search and budget actually overlapping in time, both-branch failure reporting, a 502 from the MCP server not killing the run, and the synthesis fallback.

Production, after both deploys:

| Check | Result |
|---|---|
| Pages serves | 200 |
| `/api/health` from Pages origin | 200, ACAO echoed |
| `/api/health` from `evil.example.com` | no ACAO header |
| `/api/trip/stream` with no `destination` | 400 `{"error":"destination is required"}` |
| SSE frames | `search`/`budget` start frames emitted, then one `error` frame |
| MCP over Service Binding | **401 Unauthorized** |
| Workers AI inference | **failed — 4006 quota** |

```
MCP initialize failed (401): {"error":"Unauthorized"};
4006: you have used up your daily free allocation of 10,000 neurons,
please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage.
```

Two independent blockers, both external to the port:

1. **MCP 401.** `mcp-search-server` has an `MCP_AUTH_TOKEN` secret and rejects any request without a matching bearer token — the Service Binding does not bypass that check. `trip-planner-api` has no such secret yet. Cloudflare does not expose existing secret values and the token is not stored in any local `.dev.vars` or `.env`, so it cannot be copied programmatically. It has to be set directly with `wrangler secret put`, which also keeps the value out of any transcript. See §7 — the first attempt did not land.
2. **Workers AI 4006.** Account-wide daily allocation, shared with `02-personal-assistant` and `05-career-assistant`, exhausted earlier today. Resets 00:00 UTC.

**Neither the MCP round trip nor Workers AI inference has completed end-to-end on this project.** Everything else — routing, validation, CORS, SSE framing, error aggregation — is verified against the deployed worker.

## 7. Post-Deploy Follow-Up

Two things happened after §6 was written, both still inside session 1.

### The `MCP_AUTH_TOKEN` attempt did not land

The secret was set by hand, but afterwards:

```
$ npx wrangler secret list --name trip-planner-api
[]
```

and the stream returned the identical 401. All four workers on the account were checked: no `MCP_AUTH_TOKEN` appeared anywhere new, and the existing ones on `mcp-search-server` and `personal-assistant-api` were intact. So nothing was overwritten and nothing was misdirected — the `put` simply never completed. Most likely cancelled at the hidden-value prompt, or run from a directory where wrangler resolved a different `wrangler.toml`.

The retry has to run from `03-trip-planner-langgraph/worker`, because wrangler takes the target worker name from the nearest config rather than from the current project:

```bash
cd 03-trip-planner-langgraph/worker && npx wrangler secret put MCP_AUTH_TOKEN
```

Success prints `✨ Success! Uploaded secret MCP_AUTH_TOKEN`. No redeploy is needed afterwards — secrets apply to the running worker immediately.

### The Service Binding is already proven

Worth separating from the auth failure, because it is the part of the migration that was actually at risk. A 401 carrying `{"error":"Unauthorized"}` is `mcp-search-server`'s own handler replying — the request reached it, inside Cloudflare, over the binding. Had the binding been misconfigured the failure would have been a network or routing error instead.

**So `[[services]] MCP` is verified. Only the bearer check is outstanding.** The remaining MCP unknowns are `tools/list` returning the expected two tools and `tools/call` returning real SerpAPI results.

### Quota-reset run scheduled

One-shot cron `2b13c8a4`, firing 03:07 local / 00:07 UTC on 2026-08-27, covering the deferred end-to-end tests for **both** this project and `05-career-assistant`. It checks whether `MCP_AUTH_TOKEN` exists before attempting 03's run and skips it if not, since the search agent cannot function without it.

`05`'s earlier job `8e8d6af1` was gone by the time this session looked — `CronList` returned nothing — which is exactly the fragility that job's own notes flagged. **Cron jobs are session-only and in-memory.** If the session closes, the machine sleeps, or the REPL is mid-query at 00:07, `2b13c8a4` will not fire either and both tests must be triggered by hand.

## 8. Next Steps

1. **Set `MCP_AUTH_TOKEN` on `trip-planner-api`** — the first attempt failed (§7). Re-run the stream afterwards and confirm the 401 is gone. Independent of the AI quota, so testable immediately.
2. **Re-run end-to-end after 00:00 UTC 2026-08-27**, once the neuron allocation resets, and confirm a `result` frame with a parsed itinerary object. Cron `2b13c8a4` is scheduled to do this, with the caveats in §7.
3. **Confirm the itinerary JSON parses.** Same risk as `05-career-assistant`: the prompt demands one large strict-schema object and llama is less reliable than Sonnet at that. The `days` array must hold exactly the requested number of days. If it fails, tighten the prompt or pass a `response_format` json_schema to `AI.run` — do not loosen the client parser.
4. **Watch the `gpt-oss` output shape in production.** `toText` handles both shapes, but which one Workers AI actually returns for `@cf/openai/gpt-oss-120b` has not been observed live. If it returns the `output` array, confirm the reasoning filter is doing its job and the itinerary prompt has no chain of thought in it.
5. **Consider Workers Paid ($5/mo).** Three projects now share 10,000 neurons/day. Declined for `05` earlier today; the case gets stronger with each project added.
