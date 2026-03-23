# 03 - Trip Planner (LangGraph)

A multi-agent trip planner that uses LangGraph to orchestrate parallel AI agents for travel research, budgeting, and itinerary generation.

## What It Does

The backend defines a LangGraph `StateGraph` with three nodes -- **Search**, **Budget**, and **Itinerary** -- that collaborate to produce a structured day-by-day travel itinerary. The Search and Budget nodes run in parallel (fan-out from `START`), and their results feed into the Itinerary node (fan-in), which merges everything into a final JSON plan. The React frontend streams agent progress via SSE and renders the itinerary with expandable day cards.

## Architecture

```
START
  |--- searchAgent  (uses MCP server to web-search attractions, hotels, flights)
  |--- budgetAgent  (estimates per-category costs for the trip)
  |         |
  +----+----+
       |
  itineraryAgent  (combines search + budget into a structured JSON itinerary)
       |
      END
```

- **searchAgent** -- Connects to the project 01 MCP search server (`localhost:3002`) via `@langchain/mcp-adapters` and uses the `web_search` tool to find real travel data.
- **budgetAgent** -- Calls the LLM directly with trip parameters to produce a cost breakdown.
- **itineraryAgent** -- Receives both outputs and generates the final day-by-day JSON itinerary.

All three nodes use `ChatAnthropic` (Claude Sonnet) by default. Commented-out code shows how to swap in Ollama for local models.

## Prerequisites

- Node.js 18+
- An **Anthropic API key** (for Claude)
- A **SerpAPI key** (used by the MCP search server in project 01)
- Project **01-mcp-search-server** must be available at `../01-mcp-search-server` (it is started automatically by `npm run dev`)

## Setup

1. **Install all dependencies** (root, server, and client):

   ```bash
   npm run install:all
   ```

2. **Configure environment variables.** Copy the example and fill in your keys:

   ```bash
   cp server/.env.example server/.env
   ```

   Edit `server/.env`:

   ```
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```

   Also make sure `../01-mcp-search-server` has its own `.env` configured with your `SERPAPI_API_KEY`.

3. **Start all services** (MCP server + backend + frontend):

   ```bash
   npm run dev
   ```

   This uses `concurrently` to launch all three processes at once.

## Port Numbers

| Service              | Port   |
|----------------------|--------|
| MCP Search Server    | 3002   |
| Backend (Express)    | 3001   |
| Frontend (Vite/React)| 5174   |

Open `http://localhost:5174` in your browser to use the app.
