# 03 - Trip Planner (LangGraph)

A multi-agent trip planner that orchestrates parallel AI agents for travel research, budgeting, and itinerary generation.

## What It Does

Three agents -- **Search**, **Budget**, and **Itinerary** -- collaborate to produce a structured day-by-day travel itinerary. Search and Budget run in parallel, and their results feed into Itinerary, which merges everything into a final JSON plan. The React frontend streams agent progress via SSE and renders the itinerary with expandable day cards.

## Architecture

```
  +--- searchAgent  (uses the MCP search server to research attractions, hotels, flights)
  |--- budgetAgent  (estimates per-category costs for the trip)
  |         |
  +----+----+
       |
  itineraryAgent  (combines search + budget into a structured JSON itinerary)
```

- **searchAgent** -- Discovers tools from the project 01 MCP search server and runs a tool-calling loop against `web_search`, up to 3 rounds.
- **budgetAgent** -- One model call with the trip parameters, producing a cost breakdown.
- **itineraryAgent** -- Receives both outputs and generates the final day-by-day JSON itinerary.

Search and Budget are fanned out with `Promise.allSettled`; if either fails, both failure messages are reported rather than only the first to reject.

## Two Backends

The same three agents exist twice. Pick whichever you want to run.

| Directory | Runtime | Models | MCP transport | Status |
|-----------|---------|--------|---------------|--------|
| `worker/` | Cloudflare Workers (Hono) | Workers AI -- `@cf/openai/gpt-oss-120b` for text, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for JSON | Service Binding to `mcp-search-server` | deployed |
| `server/` | Node + Express, port 3001 | Anthropic Claude Sonnet via LangGraph | HTTP to `localhost:3002` | local reference implementation |

`server/` keeps the LangGraph `StateGraph` and is unchanged as the course reference. `worker/` is what the deployed app runs; LangGraph is dropped there because a three-node fan-out/fan-in does not need a graph runtime.

### Why two models

The search and budget agents produce prose and drive tool calls, which `gpt-oss-120b` handles well. The itinerary agent must emit one large strict-schema JSON object, and `llama-3.3-70b` is steadier at that. Both ids are `[vars]`, so either can be swapped without a code change.

## Prerequisites

- Node.js 18+
- Project **01-mcp-search-server** -- deployed as a Worker (for `worker/`) or runnable at `../01-mcp-search-server` (for `server/`)
- A **SerpAPI key** -- used by the MCP search server, not by this project directly
- For `worker/`: a Cloudflare account with Workers AI enabled, plus `wrangler`
- For `server/`: an **Anthropic API key**

## Running the Worker Backend

1. Install dependencies:

   ```bash
   npm --prefix worker install
   npm --prefix client install --legacy-peer-deps
   ```

2. Create the local secrets file:

   ```bash
   cp worker/.dev.vars.example worker/.dev.vars
   ```

   Set `MCP_AUTH_TOKEN` to the same value the MCP search server expects. Leave it empty only if that server has no token configured. The file is gitignored.

3. Point the client at the local worker -- `client/.env.development` already holds `http://localhost:8787`.

4. Start both processes:

   ```bash
   npm run dev:worker     # wrangler dev on 8787
   npm run dev:client     # vite on 5174
   ```

Run the worker unit tests with `npm --prefix worker test`. They stub the `AI` binding and the MCP service binding, so the whole three-agent flow is exercised without spending Workers AI neurons.

## Running the Express Backend

```bash
npm run install:all
cp server/.env.example server/.env      # then fill in ANTHROPIC_API_KEY
npm run dev                             # MCP server + Express + Vite
```

Set `VITE_API_URL=http://localhost:3001` in `client/.env.development` so the client talks to Express instead of the worker.

## Configuration

**`worker/wrangler.toml`**

| Var | Purpose |
|-----|---------|
| `TEXT_MODEL` | Model for the search and budget agents |
| `JSON_MODEL` | Model for the itinerary agent |
| `MCP_SERVER_URL` | Request URL for MCP calls; the host is ignored when the Service Binding is used, but the path is not |
| `CLIENT_ORIGIN` | Comma-separated exact-match CORS allowlist |
| `CLIENT_ORIGIN_SUFFIXES` | Https-only suffix match, so Pages preview deployments are allowed |

Bindings: `AI` (Workers AI) and `MCP` (Service Binding to the `mcp-search-server` Worker). `MCP_AUTH_TOKEN` is a Worker secret:

```bash
cd worker && npx wrangler secret put MCP_AUTH_TOKEN
```

The Service Binding keeps MCP traffic inside Cloudflare rather than going out over the public internet, but `mcp-search-server` still checks the bearer token on every request, so the secret is required either way.

## Deploying

```bash
npm --prefix worker run deploy
npm --prefix client run build
npx wrangler pages deploy client/dist --project-name trip-planner
```

After the first Pages deploy, add the Pages URL to `CLIENT_ORIGIN` and its suffix to `CLIENT_ORIGIN_SUFFIXES`, then redeploy the worker.

## Ports

| Service | Port |
|---------|------|
| `wrangler dev` (worker) | 8787 |
| MCP Search Server (local) | 3002 |
| Backend (Express) | 3001 |
| Frontend (Vite/React) | 5174 |
