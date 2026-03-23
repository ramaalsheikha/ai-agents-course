# 01 - MCP Search Server

A standalone MCP (Model Context Protocol) server that exposes web and image search tools via SerpAPI.

## What It Does

This server wraps SerpAPI's Google Search and Google Images endpoints as MCP tools (`web_search` and `image_search`). AI agents connect to it over MCP and call these tools to retrieve live search results. Each tool returns the top 5 results formatted as markdown.

## Prerequisites

- Node.js 18+
- A SerpAPI API key (free tier available at https://serpapi.com)

## Setup

```bash
# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Then edit .env and add your real SERPAPI_API_KEY
```

## Running the Server

### HTTP Transport (index.js) -- Port 3002

Runs a persistent Express server. Clients connect via `POST http://localhost:3002/mcp`.

```bash
npm start
```

### Stdio Transport (stdio.js)

The client spawns this as a child process and communicates over stdin/stdout. You typically do not run this directly -- the client launches it.

```bash
npm run stdio
```

## How Other Projects Use This Server

Later projects in this course (e.g., `02-personal-assistant`, `03-trip-planner-langgraph`) connect to this server as an MCP tool provider. They either:

- Start the HTTP server on port 3002 and point their MCP client at `http://localhost:3002/mcp`, or
- Spawn `stdio.js` as a child process for a self-contained stdio connection.

Make sure this server is running (or configured as a stdio command) before starting any project that depends on it.
