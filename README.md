# AI Agent Engineering Course

This repository is created for educational purposes as part of the [AI Agent Engineering Course](https://tariqlabs.com/courses/ai-agents/) by Tariq Labs. It progressively builds AI agent systems — from standalone tool servers to multi-agent architectures.

## Projects

| # | Project | What you build | Key concepts |
|---|---------|---------------|--------------|
| 01 | [MCP Search Server](./01-mcp-search-server) | A standalone MCP server exposing a `web_search` tool via SerpAPI | MCP protocol, tool servers, stdio + HTTP transports |
| 02 | [Personal Assistant](./02-personal-assistant) | A full-stack chat app where an LLM calls tools through MCP | Client-server architecture, tool use, streaming |
| 03 | [Trip Planner — LangGraph](./03-trip-planner-langgraph) | Multi-agent trip planner with parallel search + budget nodes | LangGraph, state graphs, fan-out/fan-in, MCP integration |
| 04 | [Trip Planner — A2A](./04-trip-planner-a2a) | Same trip planner rebuilt as independent agent services | A2A protocol, agent cards, JSON-RPC 2.0, service discovery |
| 05 | [Career Assistant](./05-career-assistant) | Career gap analyzer with resume + market research agents | LangGraph patterns applied to a new domain |

Projects 03 and 04 depend on Project 01 (MCP search server) for live web search.

## Prerequisites

- Node.js 18+
- npm
- A SerpAPI key (for projects that use web search)
- An Anthropic API key

## Getting Started

Install all project dependencies at once from the root:

```bash
npm run install:all
```

Then `cd` into any project directory and run `npm run dev` to start it.
