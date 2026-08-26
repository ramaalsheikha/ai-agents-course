# 04 - Trip Planner (A2A Protocol)

A multi-agent trip planner built on Google's Agent-to-Agent (A2A) protocol, where each agent is an independently deployed service with its own agent card.

## What It Does

Three specialist agents -- search, budget, and itinerary -- each run as their own service and expose an A2A-compliant JSON-RPC endpoint. An orchestrator discovers them through their agent cards, dispatches `tasks/send` requests, and streams progress events to a React frontend over SSE. Search and budget run in parallel; itinerary synthesizes their results into a day-by-day plan.

## Two Backends

The same four services exist twice. Pick whichever you want to run.

| Directory | Runtime | Models | Agent transport | Status |
|-----------|---------|--------|-----------------|--------|
| `workers/` | Cloudflare Workers (Hono) | Workers AI -- `@cf/openai/gpt-oss-120b` for text, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for JSON | Service Bindings between Workers | deployed |
| `server/` | Node + Express, ports 3010-3013 | Ollama `qwen3.5:2b` | HTTP to `localhost` | local reference implementation |

`server/` is unchanged as the course reference. `workers/` is what the deployed app runs.

## Architecture

```
React Client (Vite / Pages)
    |
    | SSE stream
    v
Orchestrator Worker  (a2a-orchestrator)
    |
    |--- GET /.well-known/agent.json   (discovery)
    |--- POST /  tasks/send            (JSON-RPC 2.0)
    |
    +--> Search Agent    (a2a-search-agent)    Workers AI + MCP over a Service Binding to project 01
    +--> Budget Agent    (a2a-budget-agent)    Workers AI, no tools
    +--> Itinerary Agent (a2a-itinerary-agent) Workers AI, JSON schema enforced
```

- Each agent serves an **agent card** at `/.well-known/agent.json` describing its name, skills, and capabilities.
- The orchestrator delegates work with the `tasks/send` JSON-RPC method and reads the reply out of `result.artifacts[0].parts[0].text`.
- Search and budget are fanned out with `Promise.allSettled`, so if both fail the error frame carries both causes rather than whichever rejected first.
- The three agents set `workers_dev = false`. They are reachable only over the orchestrator's Service Bindings, which keeps unauthenticated traffic off the Workers AI budget. Discovery still happens over real HTTP requests inside Cloudflare.

### Why two models

Search and budget produce prose and drive tool calls, which `gpt-oss-120b` handles well. The itinerary agent must emit one large strict-schema JSON object, and `llama-3.3-70b` is steadier at that. Both ids are `[vars]`, so either can be swapped without a code change.

The itinerary agent also passes a `response_format` json_schema to `AI.run`, with `minItems`/`maxItems` on `days` pulled from the `Duration: N days` line of the incoming prompt. If the model rejects the schema, it retries unconstrained and falls back to fence-stripping plus `JSON.parse`.

## Prerequisites

- Node.js 18+
- Project **01-mcp-search-server** -- deployed as a Worker (for `workers/`) or runnable at `../01-mcp-search-server` (for `server/`)
- A **SerpAPI key** -- used by the MCP search server, not by this project directly
- For `workers/`: a Cloudflare account with Workers AI enabled, plus `wrangler`
- For `server/`: **Ollama** with `qwen3.5:2b` pulled

## Running the Workers Backend

1. Install dependencies:

   ```bash
   npm --prefix workers install
   npm --prefix client install --legacy-peer-deps
   ```

2. Create the local secrets file:

   ```bash
   cp workers/.dev.vars.example workers/.dev.vars
   ```

   Set `MCP_AUTH_TOKEN` to the same value the MCP search server expects.

3. Start the orchestrator and the client:

   ```bash
   npm --prefix workers run dev:orchestrator   # wrangler dev on 8787
   npm --prefix client run dev                 # vite on 5175
   ```

Run the unit tests with `npm --prefix workers test`. They stub the `AI` binding and every Service Binding, so the full four-service flow is exercised without spending Workers AI neurons.

## Deploying

Agents first -- the orchestrator's Service Bindings need them to exist:

```bash
npm --prefix workers run deploy:all
```

The search agent needs the MCP bearer token, set once per worker:

```bash
cd workers && npx wrangler secret put MCP_AUTH_TOKEN --config search-agent/wrangler.toml
```

Then the client:

```bash
npm --prefix client run build
npx wrangler pages deploy client/dist --project-name trip-planner-a2a --branch main
```

## Running the Express Backend

```bash
npm run install:all
cp server/.env.example server/.env
ollama pull qwen3.5:2b
npm run dev                             # MCP server + 3 agents + orchestrator + Vite
```

Set `VITE_API_URL=http://localhost:3013` in `client/.env.development` so the client talks to Express instead of the orchestrator worker.

### Port Reference (Express backend)

| Service          | Port  |
|------------------|-------|
| Search Agent     | 3010  |
| Budget Agent     | 3011  |
| Itinerary Agent  | 3012  |
| Orchestrator     | 3013  |
| React Client     | 5175  |
| MCP Server (01)  | 3002  |

## Configuration

**`workers/orchestrator/wrangler.toml`**

| Key | Purpose |
|-----|---------|
| `[[services]] SEARCH / BUDGET / ITINERARY` | the three agent workers |
| `CLIENT_ORIGIN` | comma-separated exact-match CORS allowlist |
| `CLIENT_ORIGIN_SUFFIXES` | https-only suffix match, so Pages previews work |

**`workers/search-agent/wrangler.toml`**

| Key | Purpose |
|-----|---------|
| `[[services]] MCP` | the deployed `mcp-search-server` worker |
| `MCP_SERVER_URL` | supplies the request path; the host is ignored over a binding |
| `TEXT_MODEL` | Workers AI model for research |

`MCP_AUTH_TOKEN` is a secret, never a var.

## How This Differs from Project 03

Project 03 runs all three agents inside one Worker -- they call each other as functions. This project gives each agent its own Worker. The orchestrator has no access to agent internals; it discovers capabilities through agent cards and communicates exclusively through the A2A protocol, over real HTTP requests that stay inside Cloudflare. That is closer to how agents interact across teams or organizations in production.
