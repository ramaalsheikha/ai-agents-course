# Career Assistant

An AI-powered career advisor that analyzes your resume against real job market data using a LangGraph multi-agent workflow.

## What It Does

You paste your resume, pick a target role and market, and the system runs three specialized AI agents in parallel to produce a career gap analysis. The agents fetch live job postings via SerpAPI, analyze your resume with Claude, then combine both outputs into actionable recommendations -- including a readiness score, skill gaps, and a prioritized action plan.

## Architecture

The server uses a LangGraph `StateGraph` with three nodes and a fan-out/fan-in pattern:

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

## Prerequisites

- Node.js 18+
- **Anthropic API key** -- used by all three agent nodes (Claude Sonnet)
- **SerpAPI key** -- used by the market researcher to fetch live job postings

## Setup

1. Install dependencies:

```bash
npm run install:all
```

2. Create the server environment file:

```bash
cp server/.env.example server/.env
```

3. Edit `server/.env` and add your API keys:

```
ANTHROPIC_API_KEY=your_anthropic_key_here
SERPAPI_API_KEY=your_serpapi_key_here
```

4. Start both the server and client:

```bash
npm run dev
```

You can also run them separately with `npm run dev:server` and `npm run dev:client`.

## Ports

| Service | Port |
|---------|------|
| Express API server | 3001 |
| Vite dev server (React client) | 5175 |
