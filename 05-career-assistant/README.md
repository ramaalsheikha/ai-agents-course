# Career Assistant

An AI-powered career advisor that analyzes your resume against real job market data using a LangGraph multi-agent workflow.

## What It Does

You paste your resume, pick a target role and market, and the system runs three specialized AI agents to produce a career gap analysis. The agents fetch live job postings via SerpAPI, analyze your resume with an LLM, then combine both outputs into actionable recommendations -- including a readiness score, skill gaps, and a prioritized action plan.

## Architecture

The graph is a LangGraph `StateGraph` with three nodes and a fan-out/fan-in pattern:

```
START
  |--- resumeAnalyzer  (parses resume, extracts skills/strengths/gaps)
  |--- marketResearcher (queries SerpAPI for live job postings, extracts market trends)
  |         |
  v         v
      gapAnalyst  (compares resume vs. market, produces readiness score + action plan)
          |
         END
```

- **resumeAnalyzer** and **marketResearcher** run in parallel (fan-out from START).
- **gapAnalyst** waits for both to finish (fan-in), then produces the final analysis.
- Progress updates are streamed to the client via Server-Sent Events (SSE).

`EventSource` cannot POST, so the client uses a two-step handshake: it POSTs the payload to `/api/career/start` and receives a session id, then opens `/api/career/stream?sessionId=...`. The session is single-use and is deleted as soon as the stream reads it.

## Two Backends

The same graph exists twice. Pick whichever you want to run.

| Directory | Runtime | Model | Sessions | Status |
|-----------|---------|-------|----------|--------|
| `worker/` | Cloudflare Workers (Hono) | Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) | Workers KV, 10 min TTL | deployed |
| `server/` | Node + Express, port 3001 | Anthropic Claude Sonnet | in-memory `Map` | local reference implementation |

`server/` is kept unchanged as the course reference. `worker/` is what the deployed app runs.

## Prerequisites

- Node.js 18+
- **SerpAPI key** -- used by the market researcher to fetch live job postings
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

   Then put your real SerpAPI key in `worker/.dev.vars`. It is gitignored.

3. Point the client at the local worker:

   ```bash
   cp client/.env.example client/.env.development
   ```

   For local runs set `VITE_API_URL=http://localhost:8787`; `.env.production` holds the deployed worker URL.

4. Start both processes:

   ```bash
   npm --prefix worker run dev     # wrangler dev on 8787
   npm --prefix client run dev     # vite on 5175
   ```

Run the worker unit tests with `npm --prefix worker test`.

## Running the Express Backend

```bash
npm run install:all
cp server/.env.example server/.env      # then fill in ANTHROPIC_API_KEY and SERPAPI_API_KEY
npm run dev
```

This starts Express on 3001 and Vite on 5175. Set `VITE_API_URL=http://localhost:3001` in `client/.env.development` so the client talks to Express instead of the worker.

## Configuration

**`worker/wrangler.toml`**

| Var | Purpose |
|-----|---------|
| `AI_MODEL` | Workers AI model id; falls back to the default in `career-agent.js` |
| `CLIENT_ORIGIN` | Comma-separated exact-match CORS allowlist |
| `CLIENT_ORIGIN_SUFFIXES` | Https-only suffix match, so Pages preview deployments are allowed |

Bindings: `AI` (Workers AI) and `SESSIONS` (KV). `SERPAPI_API_KEY` is a Worker secret, set with `wrangler secret put SERPAPI_API_KEY` -- not a `[vars]` entry.

**`client/`**

| File | Value |
|------|-------|
| `.env.development` | `http://localhost:8787` |
| `.env.production` | deployed worker URL |
| `.env.example` | template |

## Deploying

```bash
npm --prefix worker run deploy
npm --prefix client run build
npx wrangler pages deploy client/dist --project-name career-assistant
```

After the first Pages deploy, add the Pages URL to `CLIENT_ORIGIN` and its suffix to `CLIENT_ORIGIN_SUFFIXES`, then redeploy the worker.

## Ports

| Service | Port |
|---------|------|
| `wrangler dev` (worker) | 8787 |
| Express API server | 3001 |
| Vite dev server (React client) | 5175 |
