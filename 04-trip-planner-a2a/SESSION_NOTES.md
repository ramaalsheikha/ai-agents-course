# Session Notes

Single source of truth for `04-trip-planner-a2a`. Newest session last; the live state of the system is **session 1 §8**, and the open work is **session 1 §9**.

---

# Session 1 — 2026-08-26

Scope: migration from four local Express servers (Ollama + A2A over `localhost`) to four Cloudflare Workers wired with Service Bindings, plus a Pages client. Follows `02`, `03`, and `05`, but this is the first project in the course deployed as **more than one worker**.

## 1. Starting Point

- `server/agent-search.js` (3010), `agent-budget.js` (3011), `agent-itinerary.js` (3012) — three Express servers, each serving `GET /.well-known/agent.json` and `POST /` for JSON-RPC `tasks/send`. All three used `ChatOllama` with `qwen3.5:2b`. Search built a `MultiServerMCPClient` over HTTP to `localhost:3002/mcp` and drove it with `createAgent`.
- `server/orchestrator.js` (3013) — fetched the three agent cards, dispatched search and budget with `Promise.all`, then itinerary, streaming `phase` / `agent_discovered` / `task_sent` / `task_done` / `result` / `error` frames over hand-rolled SSE.
- `client/src/App.jsx` — React 19 + Vite on 5175, `http://localhost:3013` hardcoded at one call site, `EventSource` for the stream.

## 2. What We Built

Everything new lives under `workers/`, with one directory per service and a shared directory beside them. `wrangler` is driven with `--config <dir>/wrangler.toml`, so all four share one `node_modules` and one test suite.

**`workers/shared/a2a.js`** — `createAgentApp({ card, label, run })` returns a Hono app serving the agent card, a `/health` route, and the `tasks/send` envelope. It validates `jsonrpc === "2.0"` and the method, wraps the `run` result in `result.artifacts[0].parts[0].text`, and maps a thrown error onto JSON-RPC `-32603`. The three agents differ only in their card and their `run` function.

**`workers/shared/ai.js`** — `toText` (string / `{response}` / `{content}` / `{output:[...]}` with `reasoning` parts filtered out), `toStructured`, and the two model helpers. Carried over from `03`.

**`workers/shared/mcp.js`**, **`workers/shared/cors.js`** — copies of `03`'s, with `clientInfo.name` changed to `trip-planner-a2a`.

**`workers/search-agent`** — the same hand-rolled tool loop as `03`: discover tools, hand the model OpenAI-style function schemas, up to 2 calls per round for up to 3 rounds, tool results truncated to 2500 chars, and a no-more-tools synthesis call if the model finishes holding only tool calls.

**`workers/budget-agent`** — one `AI.run` on the text model.

**`workers/itinerary-agent`** — JSON model at `temperature: 0`, with a `response_format` json_schema.

**`workers/orchestrator`** — Hono + `streamSSE`. Frame types are unchanged from Express, so the client needed no protocol changes beyond its base URL.

## 3. Key Decisions

### One worker per agent, not one worker with four routes

The alternative was a single worker hosting all the cards and calling the agents in-process. That would have been cheaper to deploy and would have made the A2A protocol decorative — no real inter-agent hop. Separate workers keep the lesson: the orchestrator holds no reference to agent internals, only a Service Binding, and discovery is a real HTTP request for a real agent card.

### Agents are not on `workers.dev`

All three agent workers set `workers_dev = false`. They are reachable only through the orchestrator's Service Bindings. On the free plan an exposed agent was a nuisance; on Workers Paid an unauthenticated public endpoint that calls Workers AI is someone else's inference on this account's bill. The cost is that agent cards can no longer be curled directly — the orchestrator's `agent_discovered` frames are how discovery gets verified.

### `Promise.all` replaced with `Promise.allSettled`

Same change, same reason as `03` and `05`: with `Promise.all` the first rejection wins and the second branch's rejection is lost. The orchestrator now joins every failure message into one error frame. There is a test for it.

### The itinerary agent derives its day count from the prompt

A2A messages carry text parts, not structured params, so the itinerary agent has no `days` field to read. `dayCountOf` regexes `Duration: N days` out of the incoming prompt and feeds it to `minItems` / `maxItems` on the schema's `days` array, falling back to 7. This keeps the A2A envelope untouched — the alternative was smuggling trip parameters through `params.metadata`, which the protocol allows but the local reference implementation never used.

### Structured output on the JSON model

`response_format: { type: "json_schema", json_schema }` on the itinerary call, with the fence-stripping parser kept as a fallback and an unconstrained retry if the model rejects the schema. Added across `03`, `04`, and `05` in the same session — see `05`'s session 3 for why.

## 4. Deployed Resources

| Resource | Value |
|---|---|
| Orchestrator | https://a2a-orchestrator.alsheikharama.workers.dev (`8bc36b16-7158-47f7-a779-3da11b7e760f`) |
| Search agent | `a2a-search-agent` (`5b95bbe5-37c9-4ced-849b-99f81c96ac20`), no public route |
| Budget agent | `a2a-budget-agent` (`603a3f67-8f50-4fbb-a600-282b98482554`), no public route |
| Itinerary agent | `a2a-itinerary-agent` (`c060d26a-2369-4c93-a3cd-9a6c66f7a422`), no public route |
| Pages (production) | https://trip-planner-a2a.pages.dev |
| Pages (this deploy) | https://1d2c7faf.trip-planner-a2a.pages.dev |
| Account | `e524b4a1ac42eea56ccb0651083b2f9f` |

No KV namespace. One secret outstanding — see §7.

## 5. Current File State

| Path | State |
|---|---|
| `workers/shared/{a2a,ai,cors,mcp}.js` | shared by all four services |
| `workers/{search,budget,itinerary}-agent/src/index.js` | one `createAgentApp` each |
| `workers/orchestrator/src/{index,orchestrate,a2a-client,prompts}.js` | SSE route, phases, JSON-RPC client, prompt builders |
| `workers/tests/{agents,orchestrator}.test.js` | 21 tests, all passing |
| `workers/*/wrangler.toml` | four configs; agents `workers_dev = false` |
| `workers/.dev.vars.example` | holds the `MCP_AUTH_TOKEN` key |
| `client/src/App.jsx` | `API_URL` from `import.meta.env.VITE_API_URL`, fallback `http://localhost:8787` |
| `client/.env.{development,production,example}` | localhost:8787 / orchestrator URL / placeholder |
| `README.md` | rewritten around the two backends |
| `package.json` | added `dev:workers`, `test:workers`, `deploy:workers` |
| `server/**` | unchanged |

## 6. Verification

Tests: 21 passing (`npm --prefix workers test`). The `AI` binding and all three Service Bindings are stubbed, so the whole four-service flow runs on zero neurons. Covered: the agent card carrying the request origin as its `url`, rejection of anything that is not a `2.0` `tasks/send`, a thrown agent error becoming `-32603`, day-count extraction, the schema's `minItems`/`maxItems` tracking the requested days, a schema-enforced object being serialized back to artifact text, fence stripping, the unconstrained retry, the MCP tool loop going over the binding and never over global `fetch`, the synthesis fallback, discovery preceding dispatch, both parallel results reaching the itinerary prompt, both failures landing in one error frame, no itinerary dispatch after a parallel failure, unparseable itinerary text passing through, a missing binding failing loudly, and the CORS allowlist.

Production, after all five deploys:

| Check | Result |
|---|---|
| Pages serves | 200 |
| `/api/health` from Pages origin | 200, ACAO echoed |
| `/api/health` from `evil.example.com` | no ACAO header |
| `/api/a2a/stream` with no `destination` | 400 `{"error":"destination is required"}` |
| Agent discovery over Service Bindings | all three cards returned |
| Budget agent, Workers AI inference | **completed** |
| Search agent, MCP over Service Binding | **401 Unauthorized** |
| Itinerary agent | not reached |

```
search: MCP initialize failed (401): {"error":"Unauthorized"}
```

No 4006 anywhere — the account moved to Workers Paid earlier in the session, and the budget agent returned a real breakdown. The A2A layer is proven end to end: discovery, dispatch, parallel fan-out, per-agent task frames, and error aggregation all work against deployed workers. Only the search agent's bearer token is missing.

## 7. Next Steps

1. **Set `MCP_AUTH_TOKEN` on `a2a-search-agent`.** Same blocker as `03`, and the same cause — `mcp-search-server` rejects any request without the bearer token, and a Service Binding does not bypass that check. Cloudflare does not expose existing secret values and the token is in no local file, so it has to be typed:

   ```bash
   cd 04-trip-planner-a2a/workers && npx wrangler secret put MCP_AUTH_TOKEN --config search-agent/wrangler.toml
   ```

   Note the `--config` flag. Without it wrangler resolves the nearest `wrangler.toml`, which is how the first attempt on `03` silently targeted nothing.

2. **Re-run the stream afterwards** and confirm a `result` frame with a parsed itinerary object. That is the only part of the flow still unverified in production.
3. **Confirm the itinerary JSON parses and holds exactly the requested number of days.** The `days` count now rides on a regex over the prompt; if the model returns the wrong number, check `dayCountOf` before blaming the schema.
4. **Watch the `gpt-oss` output shape in production.** `toText` handles both, but which shape Workers AI returns for `@cf/openai/gpt-oss-120b` has still not been observed live on any project.

## 8. Resolved — Verified End to End

`MCP_AUTH_TOKEN` was set on `a2a-search-agent` with the `--config` flag, and the token was rotated across all four MCP-speaking workers in the account at the same time.

A full run of `Porto / 2 days / $1200 / 2 people`:

| Check | Result |
|---|---|
| Discovery | all three cards returned over Service Bindings |
| Search agent, MCP over Service Binding | completed |
| Budget agent | completed |
| Itinerary agent | completed |
| `result` frame | parsed object |
| `days` array | exactly 2, numbered 1-2 |
| Content | real Porto places — the Cathedral and São Francisco, priced |

`dayCountOf` reading the duration out of the prompt works against a live model: a 2-day request produced exactly 2 days, as did a 3-day request on the earlier Lisbon run. **§7 items 1, 2, and 3 are closed. The A2A flow is verified end to end in production.**

### Agent cards now say how they are reachable

The first verified run exposed a cosmetic bug. `createAgentApp` filled `card.url` from the request origin, which over a Service Binding is whatever URL the caller invented — `https://agent.internal`, the placeholder in `a2a-client.js`. The client renders `card.url` directly (`client/src/App.jsx:17`), so the discovery panel showed three agents claiming to live at a hostname that does not exist.

Each agent now carries an `AGENT_URL` var — `binding://a2a-search-agent` and so on — and the card falls back to the request origin when it is unset, which is what `wrangler dev` wants locally. Honest for agents that have no public route at all, and it keeps the point visible in the UI: these are reachable through a binding, not over the internet. Two tests pin both branches; 22 passing.

Agent versions after the fix: search `810c4c81`, budget `265ad3f2`, itinerary `bddcf082`.

## 9. Next Steps

1. **Watch the `gpt-oss` output shape in production.** Carried from §7 item 4, still unobserved on any project — `toText` handles both shapes silently, so a live run cannot distinguish them without logging.
2. **Consider whether the orchestrator should degrade instead of failing.** A search failure currently kills the run, even though the budget agent has already produced usable output. The A2A protocol has a task state model (`failed`, `input-required`) that this implementation reduces to completed-or-throw.
