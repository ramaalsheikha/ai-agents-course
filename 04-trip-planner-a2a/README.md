# 04 - Trip Planner (A2A Protocol)

A multi-agent trip planner built on Google's Agent-to-Agent (A2A) protocol, where each agent runs as an independent HTTP server.

## What It Does

Three specialist agents -- search, budget, and itinerary -- each run in their own process and expose an A2A-compliant JSON-RPC endpoint. An orchestrator discovers them via their agent cards, dispatches tasks over HTTP, and streams progress events to a React frontend via SSE. The search and budget agents run in parallel; the itinerary agent synthesizes their results into a day-by-day plan.

## Architecture

```
React Client (Vite)
    |
    | SSE stream
    v
Orchestrator (Express, port 3013)
    |
    |--- GET /.well-known/agent.json  (discovery)
    |--- POST /  tasks/send           (JSON-RPC 2.0)
    |
    +--> Search Agent   :3010  (Ollama + MCP tool via project 01)
    +--> Budget Agent   :3011  (Ollama, no tools)
    +--> Itinerary Agent :3012 (Ollama, no tools)
```

- Each agent serves an **agent card** at `/.well-known/agent.json` describing its name, skills, and capabilities.
- The orchestrator uses the `tasks/send` JSON-RPC method to delegate work.
- Search and budget run in **parallel**; itinerary runs after both complete.

## Prerequisites

- **Node.js 18+**
- **Ollama** running locally with the `qwen3.5:2b` model pulled (`ollama pull qwen3.5:2b`)
- **Project 01 MCP server** -- the search agent connects to it at `http://localhost:3002/mcp` for web search via SerpAPI
- **SerpAPI key** -- required by the MCP server in project 01

## Setup

1. Install dependencies:

```bash
npm install
npm run install:all
```

2. Copy and fill in environment variables:

```bash
cp server/.env.example server/.env
# Set SERPAPI_API_KEY in server/.env
```

3. Make sure Ollama is running and the model is available:

```bash
ollama pull qwen3.5:2b
```

4. Start everything (MCP server + all agents + orchestrator + client):

```bash
npm run dev
```

This uses `concurrently` to launch all five processes at once, including the MCP server from `../01-mcp-search-server`.

## Port Reference

| Service          | Port  |
|------------------|-------|
| Search Agent     | 3010  |
| Budget Agent     | 3011  |
| Itinerary Agent  | 3012  |
| Orchestrator     | 3013  |
| React Client     | 5175  |
| MCP Server (01)  | 3002  |

## How This Differs from Project 03

Project 03 runs all agents inside a single LangGraph process -- they share memory and call each other as functions. This project distributes each agent into its own HTTP server. The orchestrator has no direct access to agent internals; it discovers capabilities through agent cards and communicates exclusively through the A2A protocol. This is closer to how agents would interact across teams or organizations in production.
