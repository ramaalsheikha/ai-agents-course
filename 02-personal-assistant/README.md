# Personal Assistant

An agentic personal assistant that lets you upload PDFs and chat with your knowledge base using four different tool-integration modes.

## What It Does

This project demonstrates multiple ways an LLM agent can use tools: RAG over uploaded PDFs via Pinecone, direct REST API calls to SerpAPI, and two flavors of MCP (HTTP and stdio) for runtime tool discovery. The React frontend provides a chat interface with a mode switcher and PDF upload. The Express backend runs a LangChain agent that selects tools based on the chosen mode.

## Prerequisites

- Node.js 18+
- A Pinecone account and index (for RAG mode)
- An OpenAI API key (the agent defaults to `gpt-4o`)
- A SerpAPI key (for API and MCP modes)
- (Optional) A LangSmith API key for tracing
- (Optional) Ollama with a vision model (default `gemma4:26b`) for OCR fallback on PDFs with broken text layers
- (Optional for MCP modes) The `01-mcp-search-server` project from this course, running on port 3002 or available as a stdio process

## Setup

1. **Install dependencies:**

   ```bash
   npm run install:all
   ```

2. **Configure environment variables:**

   ```bash
   cp server/.env.example server/.env
   ```

   Then edit `server/.env` and fill in your keys:

   ```
   PINECONE_API_KEY=...
   PINECONE_INDEX=...
   OPENAI_API_KEY=...
   SERPAPI_API_KEY=...
   LANGSMITH_API_KEY=...          # optional
   LANGSMITH_PROJECT=...          # optional
   OCR_MODEL=gemma4:26b           # optional; vision model used for OCR fallback
   OCR_FALLBACK=off               # optional; disables OCR fallback entirely
   ```

3. **Run the app:**

   ```bash
   npm run dev
   ```

   This starts both the server and client concurrently.

## Architecture

| Component | Port | Details |
|-----------|------|---------|
| React client (Vite) | 5173 | Chat UI with mode switcher and PDF upload |
| Express server | 3001 | `/api/chat` (agent) and `/api/ingest` (PDF upload) |
| MCP search server | 3002 | External; required only for the MCP HTTP mode (`01-mcp-search-server`) |

### Modes

- **RAG** -- Searches uploaded PDFs stored in Pinecone.
- **API** -- Calls SerpAPI directly using tools defined in the agent process.
- **MCP** -- Connects to the MCP search server over HTTP at `localhost:3002/mcp` and discovers tools at runtime.
- **MCP stdio** -- Spawns the MCP search server as a child process and communicates over stdin/stdout.

## PDF Ingestion

Uploaded PDFs go through a pipeline that handles the two ways a text layer commonly fails.

1. **Extraction.** Text runs are grouped into lines by vertical position, then ordered along the writing direction of the line -- ascending x for LTR, descending x for RTL. Joining runs in raw content-stream order is what scrambles Arabic.
2. **Normalization.** `lib/arabic.js` folds Arabic Presentation Forms (`U+FB50-FEFF`) back to base letters, strips tatweel, harakat, and bidi controls, and converts Arabic-Indic digits to ASCII. Search queries are normalized the same way so they match the stored chunks.
3. **Quality gate.** Each page is scored on the share of unmapped glyphs. A PDF whose fonts carry no `ToUnicode` CMap yields control characters rather than text; no extractor can recover it.
4. **OCR fallback.** Pages that fail the gate are rendered to images and transcribed by a local Ollama vision model. Set `OCR_FALLBACK=off` to reject such PDFs instead.
5. **Deduplication.** Chunk IDs are `sha256(file)#page#chunk`, so re-uploading the same bytes under any filename is skipped. Pass `force=true` with the upload to re-ingest anyway.

Each vector stores `source` (the original filename), `contentHash`, `pageNumber`, `chunkIndex`, and `extraction` (`text` or `ocr`).

### Index maintenance

```bash
node scripts/reindex.js stats                  # vector counts and per-source metadata health
node scripts/reindex.js purge-legacy           # drop vectors ingested before content hashing
node scripts/reindex.js purge-source <name>    # drop vectors for a named source
node scripts/reindex.js ingest <file...>       # ingest files, overwriting existing chunks
```
