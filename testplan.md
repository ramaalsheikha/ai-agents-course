# AI Agents Test Plan

Manual acceptance suite. 75 cases across five deployed apps, one MCP server, and the landing page that links them. Every step is written against the live production deployment, not a local dev server.

Written 2026-08-26.

---

## Contents

- [§0 Setup](#0-setup)
- [§1 Landing Page](#1-landing-page) — LP-01 → LP-05
- [§2 MCP Search Server](#2-mcp-search-server) — MCP-01 → MCP-09
- [§3 Personal Assistant](#3-personal-assistant) — PA-01 → PA-22
- [§4 Trip Planner (LangGraph)](#4-trip-planner-langgraph) — TP-01 → TP-13
- [§5 Trip Planner (Multi-Agent)](#5-trip-planner-multi-agent) — A2A-01 → A2A-10
- [§6 Career Assistant](#6-career-assistant) — CA-01 → CA-12
- [§7 Cross-cutting](#7-cross-cutting) — X-01 → X-04

---

## 0. Setup

### Targets under test

| Suite | Front end | API worker | Cases |
|---|---|---|---|
| Landing | `ai-agents-47w.pages.dev` | — | 5 |
| MCP Server | — | `mcp-search-server.alsheikharama.workers.dev` | 9 |
| Personal Assistant | `personal-assistant-8ve.pages.dev` | `personal-assistant-api.alsheikharama.workers.dev` | 22 |
| Trip Planner | `trip-planner-8xe.pages.dev` | `trip-planner-api.alsheikharama.workers.dev` | 13 |
| Multi-Agent | `trip-planner-a2a.pages.dev` | `a2a-orchestrator.alsheikharama.workers.dev` | 10 |
| Career Assistant | `career-assistant-3by.pages.dev` | `career-assistant-api.alsheikharama.workers.dev` | 12 |
| Cross-cutting | all | all | 4 |

### Before you start

- **Browser with DevTools.** Keep the Network and Console panels open. Several cases read SSE frames from the `EventStream` tab.
- **curl.** Every API-level case is a one-liner. No Postman needed.
- **The MCP bearer token.** Held only as a Cloudflare secret — it is in no local file. You need it in hand for MCP-03 through MCP-07.
- **Four test files.** A small text-layer PDF, the same PDF a second time, a non-PDF (any `.png`), a PDF over 25 MB, and a scanned PDF with no text layer.
- **A resume in plain text.** Any real one. Career Assistant takes pasted text, not a file.
- **Run order matters twice.** PA-12 needs PA-11 first, and CA-05 needs CA-04 first. Everything else is independent.

### Reading the type labels

| Type | Meaning |
|---|---|
| **Smoke** | Is it up at all. Run these first; a failure here invalidates the rest of the suite. |
| **Functional** | The feature does what it claims on a valid input. |
| **Negative** | Bad input is rejected cleanly, with the right status and a message a user can act on. |
| **Security** | Auth and origin controls hold. |
| **Known issue** | Documents a defect that is open today. It is written to *fail* — a pass means someone fixed it. |
| **UX / A11y** | Keyboard, contrast, responsive behaviour. |

### Cases written to fail

MCP-09, PA-04, PA-17, TP-13, A2A-10, CA-08, CA-09 document defects that are open today. A pass on any of them means the underlying defect was fixed and this plan needs updating.

**MCP-09 and A2A-10 both reproduce by removing a secret. Preview or throwaway workers only.** Clearing `MCP_AUTH_TOKEN` on the deployed `mcp-search-server` would not break it loudly — it would open the public endpoint.

---

## 1. Landing Page

| | |
|---|---|
| Page | https://ai-agents-47w.pages.dev |
| Project | `ai-agents` (Cloudflare Pages, branch `main`) |
| Source | `00-landing/public/index.html` |

### LP-01 — Page renders all four project cards
**Smoke**

**Steps**
1. Open `https://ai-agents-47w.pages.dev` in a fresh tab.
2. Count the cards in the grid.
3. Read each card's name, description, and hostname line.

**Expected**
- HTTP 200, no blank flash, no console errors.
- Exactly four cards.
- Names read Personal Assistant, Trip Planner (LangGraph), Trip Planner (Multi-Agent), Career Assistant.
- Each description matches its app: documents + web search; LangGraph planning; 4 agents collaborating; resume + job market.
- Browser tab reads *AI Agents — Deployed Projects*.

### LP-02 — Every card opens its live project
**Functional**

**Steps**
1. Click the Personal Assistant card. Confirm the app loads, then go back.
2. Repeat for Trip Planner (LangGraph), Trip Planner (Multi-Agent), Career Assistant.
3. Optionally verify all four from the shell:
   ```bash
   for u in personal-assistant-8ve trip-planner-8xe \
            trip-planner-a2a career-assistant-3by; do
     curl -s -o /dev/null -w "$u %{http_code}\n" https://$u.pages.dev
   done
   ```

**Expected**
- All four return 200.
- Each destination is the app named on the card — no cross-wired links.
- The hostname printed on the card matches the URL the browser lands on.

### LP-03 — Grid reflows without horizontal scroll
**UX / A11y**

**Steps**
1. Open DevTools device toolbar, set width to 375 px.
2. Scroll the full page; try to drag it sideways.
3. Set width to 768 px, then 1440 px.

**Expected**
- 375 px: one column, cards full width, no sideways drag.
- 640 px and above: two columns.
- Title scales down rather than wrapping into three lines.
- Long hostnames wrap inside the card instead of overflowing it.

### LP-04 — Dark theme holds contrast
**UX / A11y**

**Steps**
1. Switch the OS or browser to dark appearance.
2. Reload the page.
3. Switch back to light and reload again.

**Expected**
- Dark ground, light text — never dark text on a dark ground.
- Card borders stay visible against the surface in both themes.
- The link hostname stays legible in both themes.

### LP-05 — Keyboard reaches every card
**UX / A11y**

**Steps**
1. Click once on the page background, then press <kbd>Tab</kbd> repeatedly.
2. Watch the focus indicator move through the cards.
3. Press <kbd>Enter</kbd> on the third card.

**Expected**
- Four tab stops, one per card, in document order.
- A visible focus outline on each, not just a colour shift.
- <kbd>Enter</kbd> opens Trip Planner (Multi-Agent).

---

## 2. MCP Search Server

| | |
|---|---|
| Worker | https://mcp-search-server.alsheikharama.workers.dev |
| Endpoints | `GET /health` · `POST /mcp` (JSON-RPC 2.0) |
| Tools | `web_search` · `image_search` (SerpAPI) |
| Consumers | `personal-assistant-api` · `trip-planner-api` · `a2a-search-agent` |

### MCP-01 — Health endpoint is public and honest
**Smoke**

**Steps**
1. Run:
   ```bash
   curl -i https://mcp-search-server.alsheikharama.workers.dev/health
   ```

**Expected**
- 200 with `{"ok":true,"server":"serp-search-mcp"}`.
- No auth header required — health sits ahead of the auth check by design.

### MCP-02 — Unauthenticated JSON-RPC is rejected
**Security**

**Steps**
1. POST to `/mcp` with no `Authorization` header:
   ```bash
   curl -i -X POST \
     https://mcp-search-server.alsheikharama.workers.dev/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
2. Repeat with a deliberately wrong token: `-H "Authorization: Bearer wrong"`.

**Expected**
- Both attempts return 401 with `{"error":"Unauthorized"}`.
- No tool list, no SerpAPI call, nothing leaked in the body.

### MCP-03 — initialize returns protocol and server info
**Functional**

**Steps**
1. Export the token for this shell: `export TOK=<the MCP_AUTH_TOKEN value>`
2. Run:
   ```bash
   curl -s -X POST \
     https://mcp-search-server.alsheikharama.workers.dev/mcp \
     -H "Authorization: Bearer $TOK" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
   ```

**Expected**
- 200, `jsonrpc: "2.0"`, `id: 1`.
- `result.serverInfo` is `{"name":"serp-search-mcp","version":"1.0.0"}`.
- A `protocolVersion` and a `capabilities` object are present.

### MCP-04 — tools/list advertises both tools with schemas
**Functional**

**Steps**
1. Call `tools/list` with the bearer token, as in MCP-03.
2. Inspect each entry's `name`, `description`, and `inputSchema`.

**Expected**
- Exactly two tools: `web_search` and `image_search`.
- Each carries an `inputSchema` with a required query property.
- Descriptions are specific enough for a model to choose between them.

### MCP-05 — web_search returns real SerpAPI results
**Functional**

**Steps**
1. Run:
   ```bash
   curl -s -X POST \
     https://mcp-search-server.alsheikharama.workers.dev/mcp \
     -H "Authorization: Bearer $TOK" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
          "params":{"name":"web_search",
                    "arguments":{"query":"weather in Amman today"}}}'
   ```
2. Read the returned snippets.

**Expected**
- 200 with a `result.content` array.
- Snippets name real sources and a plausible current temperature — not a model-authored paragraph.
- Latency under roughly 5 s.

### MCP-06 — image_search returns image results
**Functional**

**Steps**
1. Repeat MCP-05 with `"name":"image_search"` and query `"Petra Jordan"`.
2. Open one returned URL in a browser.

**Expected**
- Results carry image URLs, not web page snippets.
- At least one URL loads an actual image.

### MCP-07 — Unknown JSON-RPC method fails per spec
**Negative**

**Steps**
1. Send `{"jsonrpc":"2.0","id":9,"method":"tools/invent"}` with the bearer token.

**Expected**
- A JSON-RPC error object, not an HTTP 500.
- `error.code` is `-32601`.
- `error.message` reads `Method not found: tools/invent`.
- `id` echoes back as `9`.

### MCP-08 — Any path other than /mcp is 404
**Negative**

**Steps**
1. Request `/`, `/api/mcp`, and `/tools` on the worker.

**Expected**
- All three return 404.
- No stack trace or worker internals in the body.

### MCP-09 — Auth fails open when the secret is missing
**Known issue**

**Steps**
1. Read `01-mcp-search-server/worker/src/index.js:122` and confirm the line `if (!env.MCP_AUTH_TOKEN) return true;` is still present.
2. In a *throwaway* worker or `wrangler dev` session with no `MCP_AUTH_TOKEN` set, POST `tools/list` with no `Authorization` header.
3. Record the result and stop.

> **Do not** unset or clear the secret on the deployed `mcp-search-server`. Four workers authenticate against it, and clearing it would open the public endpoint rather than break it visibly.

**Expected**
- *Today:* the unauthenticated call succeeds and returns the tool list — the defect reproduces.
- *After the fix:* a missing secret should reject every request, or refuse to boot, so a lost secret fails loudly instead of silently opening the endpoint.
- MCP-02 must still pass afterwards, on all four consuming workers.

---

## 3. Personal Assistant

| | |
|---|---|
| UI | https://personal-assistant-8ve.pages.dev |
| API | https://personal-assistant-api.alsheikharama.workers.dev |
| Endpoints | `GET /api/health` · `POST /api/chat` · `POST /api/ingest` |
| Modes | RAG (Pinecone) · API (SerpAPI direct) · MCP (JSON-RPC over Service Binding) |
| Model | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` · 24k context |

### PA-01 — API health
**Smoke**

**Steps**
1. `curl -i https://personal-assistant-api.alsheikharama.workers.dev/api/health`

**Expected**
- 200 with `{"ok":true}`.

### PA-02 — Shell renders with RAG selected
**Smoke**

**Steps**
1. Open the UI in a fresh tab.
2. Read the header, the three mode buttons, and the description line under them.
3. Click MCP, then API, then RAG, watching the description line.

**Expected**
- Title reads *Agentic Personal Assistant*; subtitle mentions uploading PDFs.
- Three buttons: RAG, API, MCP. RAG is active on load.
- Description changes with the mode — Pinecone for RAG, SerpAPI for API, runtime tool discovery for MCP.
- The active button is visually distinct, not just a colour the eye has to hunt for.

### PA-03 — RAG answers from the knowledge base
**Functional**

**Steps**
1. Stay in RAG mode.
2. Ask a question you know one of the three indexed PDFs answers.
3. Compare the answer against the source document.

**Expected**
- The answer is grounded in the document, with specifics that could only come from it.
- No invented dates, names, or figures.
- The reply is tagged with the RAG mode in the transcript.

### PA-04 — RAG summarises rather than transcribes
**Known issue**

**Steps**
1. In RAG mode, ask `أخبرني عن تدريب فولوايز`.
2. Compare the answer against the source PDF, character by character on the first two sentences.
3. Look for headings, bullet marks, and page furniture carried through verbatim.

**Expected**
- *Target:* the model writes in its own words and cites the source.
- *Today:* it reproduces retrieved passages close to verbatim, headings and bullet marks included — the case fails.
- Fix is a "summarise in your own words, do not transcribe" clause next to the citation rule in the RAG prompt.

> This is the only open defect a user can see. Re-run it after any prompt change.

### PA-05 — Answer language follows question language
**Functional**

**Steps**
1. Ask a question in Arabic. Note the reply's language.
2. In the same session, ask a different question in English.
3. Switch back to Arabic once more.

**Expected**
- Arabic question, Arabic answer. English question, English answer.
- Switching back and forth does not stick the assistant in one language.
- Arabic renders right-to-left without mangled punctuation.

> This regressed once before — English answers broke when the Arabic fix landed. Always test both directions, not just Arabic.

### PA-06 — API mode returns live web results
**Functional**

**Steps**
1. Switch to API mode.
2. Ask *what is the weather in Amman today*.

**Expected**
- A current, plausible temperature and condition.
- Content traceable to a real search result, not model memory.
- Reply tagged API.

### PA-07 — MCP mode discovers tools at runtime
**Functional**

**Steps**
1. Switch to MCP mode.
2. Ask the same weather question as PA-06.
3. Compare the answer's shape and latency against PA-06.

**Expected**
- A real result, comparable to API mode.
- No 401 — the worker holds a copy of the MCP bearer token and reaches the server over its Service Binding.
- Reply tagged MCP.

> A 401 here means the token rotation missed this worker. Re-check MCP-02 and the secret on `personal-assistant-api`.

### PA-08 — RAG admits when the knowledge base is empty on a topic
**Functional**

**Steps**
1. In RAG mode, ask about something no indexed PDF covers — *what is the weather in Amman* works.

**Expected**
- The assistant says the knowledge base holds nothing on that topic.
- It does not fall back to general knowledge and present it as retrieved.

### PA-09 — Small talk does not trigger retrieval
**Functional**

**Steps**
1. Send `hi`. Note the response time.
2. Send `thanks`, then `who are you`.
3. Send `مرحبا` and `شكرا`.
4. Then send a real question and compare the latency.

**Expected**
- Each greeting gets a short conversational reply.
- Small talk returns noticeably faster than a real query — no embedding or vector search runs.
- Arabic greetings are recognised as small talk, diacritics and spelling variants included.
- A real question still triggers full retrieval.

### PA-10 — Session memory persists and can be cleared
**Functional**

**Steps**
1. Ask a question with a specific subject.
2. Follow up with a pronoun-only question — *and when was that?* — that only makes sense in context.
3. In DevTools, read `localStorage["assistant-session-id"]` and note it.
4. Reload the page and ask another follow-up.
5. Clear that localStorage key, reload, and ask the same follow-up again.

**Expected**
- The follow-up is answered in context before the clear.
- The session id is a UUID and survives a reload.
- After clearing, a new id is minted and the assistant no longer has the earlier context.

### PA-11 — Valid PDF ingests and reports its chunk count
**Functional**

**Steps**
1. Choose a small PDF that has a real text layer.
2. Upload it and wait for the status line.
3. Then ask a RAG question that only that document answers.

**Expected**
- Status reads `Ingested N chunks from <filename>` with N greater than zero.
- The file picker resets after a successful upload.
- The new content is retrievable immediately in RAG mode.

### PA-12 — Re-uploading the same document is skipped
**Functional**

**Steps**
1. Run PA-11 first.
2. Upload the identical file a second time.
3. Read the status line and the `/api/ingest` response body in the Network panel.

**Expected**
- Response carries `status: "skipped"`.
- Status line reads `<filename> is already in the knowledge base — nothing re-ingested.`
- No duplicate vectors are written.

> Never exercised against production. The vector-id scheme was unified across both pipelines specifically so this path would work — this case is what proves it.

### PA-13 — Non-PDF upload is refused
**Negative**

**Steps**
1. Select a `.png` or `.docx` and upload it.
2. Also try it at the API level:
   ```bash
   curl -i -X POST \
     https://personal-assistant-api.alsheikharama.workers.dev/api/ingest \
     -F "file=@sample.png"
   ```

**Expected**
- API returns 400 with `{"error":"Only PDF files are allowed"}`.
- UI shows *Only PDF files can be uploaded.* — not a raw error string.
- Nothing is written to R2 or the vector index.

### PA-14 — Oversized PDF is refused with 413
**Negative**

**Steps**
1. Upload a PDF larger than 25 MB.

**Expected**
- 413 with `{"error":"File exceeds 25MB limit"}`.
- UI shows *That file is too large. Please upload a PDF under 25MB.*
- The limit is enforced before the file is read into memory.

### PA-15 — Empty and whitespace-only messages do nothing
**Negative**

**Steps**
1. With an empty composer, press <kbd>Enter</kbd>.
2. Type three spaces and press <kbd>Enter</kbd>.
3. Send a real message, then press <kbd>Enter</kbd> again while it is still in flight.

**Expected**
- No request leaves the browser in the first two cases.
- No empty bubble is appended to the transcript.
- The third case is ignored while loading — no double submit.

### PA-16 — Chat API rejects a missing message field
**Negative**

**Steps**
1. Run:
   ```bash
   curl -i -X POST \
     https://personal-assistant-api.alsheikharama.workers.dev/api/chat \
     -H "Content-Type: application/json" \
     -d '{"mode":"rag"}'
   ```

**Expected**
- 400 with `{"error":"Message required"}`.
- No model invocation is billed.

### PA-17 — Scanned PDF with no text layer is refused by the Worker
**Known issue**

**Steps**
1. Upload a scanned, image-only PDF through the UI.
2. Read the error.

**Expected**
- The upload is rejected — the Worker has no OCR path.
- The message says the PDF has no readable text, not a generic failure.
- Documents a real gap: such a document can only be ingested through `server/`, which needs local Ollama, so production cannot recover it on its own.

### PA-18 — CORS allowlist rejects foreign origins
**Security**

**Steps**
1. Send a preflight from an origin that is not allowed:
   ```bash
   curl -i -X OPTIONS \
     https://personal-assistant-api.alsheikharama.workers.dev/api/chat \
     -H "Origin: https://evil.example" \
     -H "Access-Control-Request-Method: POST"
   ```
2. Repeat with `-H "Origin: https://personal-assistant-8ve.pages.dev"`.
3. Repeat with a preview origin such as `https://abc123.personal-assistant-8ve.pages.dev`.

**Expected**
- Foreign origin: no `access-control-allow-origin` header echoed back.
- Production origin: echoed and allowed.
- Preview subdomain: allowed via the configured origin suffix.

### PA-19 — Rate limiter returns 429
**Security**

**Steps**
1. Fire repeated chat requests in a tight loop from one IP:
   ```bash
   for i in $(seq 1 40); do
     curl -s -o /dev/null -w "%{http_code} " -X POST \
       https://personal-assistant-api.alsheikharama.workers.dev/api/chat \
       -H "Content-Type: application/json" -d '{"message":"hi"}'
   done; echo
   ```

**Expected**
- Some requests return 429 with `{"error":"Too many requests"}`.
- In the UI the same condition renders as *Too many requests. Please wait a moment before trying again.*
- Normal use recovers within a short window.

### PA-20 — Network failure maps to a human message
**Negative**

**Steps**
1. In DevTools, set the network to Offline.
2. Send a message.
3. Go back online and send another.

**Expected**
- The bubble reads *Cannot reach the server. Check your connection and try again.*
- It is styled as an error, not as a normal assistant reply.
- No raw `TypeError: Failed to fetch` reaches the user; the detail is logged to the console instead.
- The next message after reconnecting succeeds.

### PA-21 — Enter sends, Shift+Enter breaks the line
**UX / A11y**

**Steps**
1. Type a line and press <kbd>Enter</kbd>.
2. Type a line and press <kbd>Shift</kbd>+<kbd>Enter</kbd>, then a second line, then <kbd>Enter</kbd>.
3. Send several messages and watch the transcript.

**Expected**
- <kbd>Enter</kbd> sends; <kbd>Shift</kbd>+<kbd>Enter</kbd> inserts a newline without sending.
- The multi-line message keeps its line break in the transcript.
- The view auto-scrolls to the newest message.

### PA-22 — Markdown in answers renders as markup
**Functional**

**Steps**
1. Ask a question whose answer will use a list — *list the main sections of the document*.
2. Inspect the rendered bubble.

**Expected**
- Lists, bold, and headings render as HTML, not as literal asterisks and hashes.
- Long words and URLs wrap inside the bubble rather than overflowing it.

---

## 4. Trip Planner (LangGraph)

| | |
|---|---|
| UI | https://trip-planner-8xe.pages.dev |
| API | https://trip-planner-api.alsheikharama.workers.dev |
| Endpoints | `GET /api/health` · `GET /api/trip/stream` (SSE) |
| Agents | search · budget · itinerary, fanned out with `Promise.allSettled` |
| Models | `gpt-oss-120b` (prose) · `llama-3.3-70b` (JSON, schema-constrained) |

### TP-01 — API health
**Smoke**

**Steps**
1. `curl -i https://trip-planner-api.alsheikharama.workers.dev/api/health`

**Expected**
- 200 with `{"ok":true}`.

### TP-02 — Form loads with sane defaults
**Smoke**

**Steps**
1. Open the UI.
2. Read the four fields and the three agent cards.

**Expected**
- Destination empty with placeholder *e.g. Tokyo, Japan*.
- Days 7, Budget 2000, Travelers 2.
- Three agent cards — search, budget, itinerary — all showing Pending.

### TP-03 — Happy path plans a trip end to end
**Functional**

**Steps**
1. Enter Lisbon, Portugal · 3 days · 2000 · 2 travelers.
2. Submit and watch the three agent cards.
3. Wait for the itinerary to render.

**Expected**
- Each card moves Pending → Working → Done.
- No error banner; no 4006 quota error.
- An itinerary, a budget chart, and tips all render.
- Place names are real and specific to Lisbon — proof the search results reached the synthesis prompt rather than the model filling gaps from memory.

### TP-04 — Day count matches the request exactly
**Functional**

**Steps**
1. Plan a 3-day trip. Count the day cards.
2. Plan a 5-day trip to a different city. Count again.
3. Plan a 1-day trip.

**Expected**
- 3, 5, and 1 day cards respectively, numbered from Day 1 with no gaps.
- The count is enforced by `minItems`/`maxItems` on the JSON schema, so a wrong count means Workers AI is not honouring the constraint — worth knowing before trusting the same schema elsewhere.

### TP-05 — Day cards expand into three time slots
**Functional**

**Steps**
1. Click Day 1 to expand it.
2. Read the morning, afternoon, and evening rows.
3. Collapse it and expand Day 2.

**Expected**
- Each slot shows an activity, and where present a location and a cost.
- The chevron flips between collapsed and expanded.
- A missing slot is simply absent, not rendered as an empty row or `undefined`.

### TP-06 — Budget chart adds up
**Functional**

**Steps**
1. Read the five category rows: accommodation, food, transport, activities, misc.
2. Add the five amounts by hand and compare to the stated total.
3. Compare the total against the budget you entered.

**Expected**
- All five categories present, each with a bar proportional to its amount.
- The total is consistent with the parts.
- The total is in the neighbourhood of the requested budget, not an order of magnitude off.
- Amounts are formatted with thousands separators.

### TP-07 — Missing destination is rejected
**Negative**

**Steps**
1. Leave Destination empty and try to submit.
2. Enter only spaces and try again.
3. At the API level:
   ```bash
   curl -i "https://trip-planner-api.alsheikharama.workers.dev/api/trip/stream?days=3"
   ```

**Expected**
- API returns 400 with `{"error":"destination is required"}`, not an SSE stream.
- The UI blocks the submit rather than starting a stream that immediately errors.
- Whitespace-only input is treated as empty.

### TP-08 — Numeric inputs clamp and fall back
**Negative**

**Steps**
1. In the UI try Days 0, Days 31, Budget 50, Travelers 0 and 21.
2. At the API level, pass garbage:
   ```bash
   curl -N "https://trip-planner-api.alsheikharama.workers.dev/api/trip/stream?destination=Rome&days=abc&budget=-5&people=0"
   ```

**Expected**
- UI enforces days 1–30, budget from 100, travelers 1–20.
- API coerces non-numeric, zero, and negative values to the defaults: 7 days, 2000 budget, 2 people.
- No crash and no NaN reaching the model prompt.

### TP-09 — SSE frames arrive in the right order
**Functional**

**Steps**
1. Open DevTools → Network, filter to the stream request, open the EventStream tab.
2. Run a plan and read every frame.
3. Or watch it from the shell:
   ```bash
   curl -N "https://trip-planner-api.alsheikharama.workers.dev/api/trip/stream?destination=Lisbon&days=3&budget=2000&people=2"
   ```

**Expected**
- A sequence of `agent_status` frames, then exactly one terminal frame.
- The terminal frame is `{"type":"result","itinerary":{...}}` — an object, not a JSON string needing a second parse.
- Response carries `Cache-Control: no-cache` and `X-Accel-Buffering: no`, so frames are not buffered to the end.

### TP-10 — One failing agent is reported without killing the others
**Negative**

**Steps**
1. Observe on any run where an agent genuinely fails, or force it in a preview deploy by pointing `MCP_SERVER_URL` at an unreachable host.
2. Read the error frame.

**Expected**
- The error names which agent failed and why — the fan-out uses `Promise.allSettled`, so one rejection does not mask the rest.
- Agents that succeeded still reported Done before the failure surfaced.
- One cause per failure, not a merged or truncated message.

### TP-11 — Reset clears the run
**UX / A11y**

**Steps**
1. Complete a plan, then click Reset.
2. Plan a second, different trip.

**Expected**
- Itinerary, budget chart, and any error clear.
- Agent cards return to Pending.
- The second run shows only its own results — no leftovers from the first.

### TP-12 — CORS allowlist holds
**Security**

**Steps**
1. Preflight `/api/trip/stream` from `https://evil.example`.
2. Repeat from `https://trip-planner-8xe.pages.dev`.
3. Repeat from a preview subdomain of that host.

**Expected**
- Only the allowlisted production origin and its preview suffix are echoed back.
- The foreign origin gets no allow header.
- Allowed methods are limited to GET and OPTIONS.

### TP-13 — Observe the gpt-oss response shape in production
**Known issue**

**Steps**
1. Add a temporary log of `typeof response` and the top-level keys returned by `AI.run` for the prose model.
2. Deploy to a preview, run one plan, and read the log with `npx wrangler tail --name trip-planner-api`.
3. Remove the log afterwards.

**Expected**
- The log states plainly whether `@cf/openai/gpt-oss-120b` returns a string or an object.
- Until then this is genuinely unknown — the helper handles both shapes silently, so a passing run proves nothing either way.
- The same ambiguity exists in project 04; one observation answers both.

---

## 5. Trip Planner (Multi-Agent)

| | |
|---|---|
| UI | https://trip-planner-a2a.pages.dev |
| Orchestrator | https://a2a-orchestrator.alsheikharama.workers.dev |
| Endpoints | `GET /api/health` · `GET /api/a2a/stream` (SSE) |
| Agents | `a2a-search-agent` · `a2a-budget-agent` · `a2a-itinerary-agent` — reachable only over Service Bindings |
| Frames | `phase` · `agent_discovered` · `task_sent` · `task_done` · `result` · `error` |

### A2A-01 — Orchestrator health
**Smoke**

**Steps**
1. `curl -i https://a2a-orchestrator.alsheikharama.workers.dev/api/health`

**Expected**
- 200 with `{"ok":true}`.

### A2A-02 — The three agents are not on the public internet
**Security**

**Steps**
1. Try to reach each agent directly:
   ```bash
   for a in search budget itinerary; do
     curl -s -o /dev/null -w "$a %{http_code}\n" \
       https://a2a-$a-agent.alsheikharama.workers.dev/api/health
   done
   ```

**Expected**
- All three fail to resolve to a worker — 404 with Cloudflare error 1042, since no `workers.dev` route is published.
- This is the designed behaviour: only the orchestrator can call them, over Service Bindings.
- A 200 here would mean an agent was accidentally exposed.

### A2A-03 — Discovery returns all three agent cards
**Functional**

**Steps**
1. Start a plan and watch the discovery panel before the tasks begin.
2. Read each card's name, description, and skills.

**Expected**
- Three `agent_discovered` frames, one per agent.
- Each card names the agent and the skills it advertises.
- Discovery completes before any `task_sent` frame.

### A2A-04 — Agent cards state how they are reachable
**Functional**

**Steps**
1. Read the URL line on each discovered agent card.

**Expected**
- Each reads `binding://a2a-search-agent` and so on.
- None reads `https://agent.internal` — that placeholder was the bug this fix removed.
- The panel makes it visible that these agents are reached through a binding, not over the internet.

### A2A-05 — Event log tells the whole protocol story
**Functional**

**Steps**
1. Run a plan with the event log panel visible.
2. Record the frame types in order.

**Expected**
- Order is: `phase`, three `agent_discovered`, three `task_sent`, three `task_done`, then `result`.
- Every task sent has a matching task done.
- Exactly one terminal frame — `result` or `error`, never both.

### A2A-06 — Tasks fan out in parallel, not in series
**Functional**

**Steps**
1. Watch the EventStream tab with timestamps visible.
2. Note when each `task_sent` arrives, and when the first `task_done` arrives.

**Expected**
- All three `task_sent` frames land before the first `task_done`.
- Total wall-clock is close to the slowest single agent, not the sum of all three.

### A2A-07 — Happy path returns a parsed itinerary
**Functional**

**Steps**
1. Plan Porto, Portugal · 2 days · 1200 · 2 travelers.
2. Expand both day cards and read the activities.

**Expected**
- All three agents complete; a `result` frame carries a parsed object.
- Exactly two day cards, numbered 1 and 2.
- Real Porto landmarks with prices — evidence the search agent's MCP results reached the synthesis prompt.

### A2A-08 — Day count is read out of the prompt correctly
**Functional**

**Steps**
1. Run plans at 1, 2, 5, and 10 days.
2. Count day cards each time.

**Expected**
- The count always matches the request.
- If it does not, check `dayCountOf` — the count rides on a regex over the prompt here, unlike project 03's sibling, which takes it as a query parameter. A double-digit count is the likeliest place for that regex to slip.

### A2A-09 — Missing destination is rejected
**Negative**

**Steps**
1. `curl -i "https://a2a-orchestrator.alsheikharama.workers.dev/api/a2a/stream?days=2"`

**Expected**
- 400 with `{"error":"destination is required"}`.
- No agent is dispatched and no stream opens.

### A2A-10 — A search failure discards work already completed
**Known issue**

**Steps**
1. In a preview deploy, make the search agent fail — clear its `MCP_AUTH_TOKEN` or point `MCP_SERVER_URL` at an unreachable host.
2. Run a plan and watch the event log.
3. Note whether the budget agent completed before the run ended.

> Force this on a preview worker only. Do not clear secrets on the deployed `a2a-search-agent`.

**Expected**
- *Today:* the run ends on an `error` frame and nothing renders, even though the budget agent already produced usable output.
- *Target:* the A2A task model has `failed` and `input-required` states; this implementation collapses them to completed-or-throw. A partial result should render with the failed lane marked.

---

## 6. Career Assistant

| | |
|---|---|
| UI | https://career-assistant-3by.pages.dev |
| API | https://career-assistant-api.alsheikharama.workers.dev |
| Endpoints | `POST /api/career/start` · `GET /api/career/stream` (SSE) · `GET /api/health` |
| Agents | resume · market · gap |
| State | KV session, 600 s TTL, deleted on first read |

### CA-01 — API health
**Smoke**

**Steps**
1. `curl -i https://career-assistant-api.alsheikharama.workers.dev/api/health`

**Expected**
- 200 with `{"ok":true}`.

### CA-02 — All three fields are required
**Negative**

**Steps**
1. In the UI, submit with each of the three fields empty in turn.
2. At the API level, omit one field:
   ```bash
   curl -i -X POST \
     https://career-assistant-api.alsheikharama.workers.dev/api/career/start \
     -H "Content-Type: application/json" \
     -d '{"resume":"text","targetRole":"Android Engineer"}'
   ```

**Expected**
- 400 with `{"error":"resume, targetMarket, and targetRole are required"}`.
- The UI blocks submission rather than starting a run that will fail.

### CA-03 — start mints a session id
**Functional**

**Steps**
1. POST a complete payload to `/api/career/start`.
2. Keep the returned id for CA-05.

**Expected**
- 200 with `{"sessionId":"<uuid>"}`.
- The resume text is not echoed back in the response.

### CA-04 — Happy path scores a real resume
**Functional**

**Steps**
1. Paste a real resume into the textarea.
2. Target Market: `Germany`. Target Role: `Senior Android Engineer`.
3. Submit and watch the three agent rows.
4. Read the full result: readiness score, top skills, salary range, gaps.

**Expected**
- resume → market → gap each move Pending → Working → Done, with a live elapsed timer.
- All three payloads parse — no `text.replace is not a function`, the bug that took this worker down in production before the schemas landed.
- `readinessScore` is a number from 0 to 100.
- `topSkills` and `keyTrends` hold 5–8 items, not one and not thirty.
- Gap analysis references skills that actually appear in the pasted resume.

### CA-05 — A session is single-use
**Security**

**Steps**
1. Take the session id from CA-03 and stream it once:
   ```bash
   curl -N "https://career-assistant-api.alsheikharama.workers.dev/api/career/stream?sessionId=$SID"
   ```
2. Run the exact same command again.

**Expected**
- First call streams normally.
- Second call returns 404 with `{"error":"Session not found"}` — the key is deleted as soon as it is read.
- A captured URL cannot be replayed to re-run someone's analysis.

### CA-06 — Sessions expire after ten minutes
**Security**

**Steps**
1. POST to `/api/career/start` and keep the id.
2. Wait longer than 600 seconds without streaming it.
3. Then stream it.

**Expected**
- 404 with `{"error":"Session not found"}`.
- Resume text does not sit in KV indefinitely.

### CA-07 — Unknown or missing session id is rejected
**Negative**

**Steps**
1. Stream with `?sessionId=does-not-exist`.
2. Stream with no `sessionId` parameter at all.

**Expected**
- Both return 404 with `{"error":"Session not found"}`.
- Neither opens an SSE stream or invokes the model.

### CA-08 — Zero job postings still produce a confident market report
**Known issue**

**Steps**
1. Run an analysis with a deliberately obscure market and role — something SerpAPI will not have postings for.
2. Watch the market agent's detail line for its posting count.
3. Read the market section of the result anyway.

**Expected**
- *Today:* the detail line reports `Found 0 jobs` and the node still emits a populated `topSkills` and a specific `salaryRange` — a market invented from nothing, which is exactly what the prompt forbids.
- *Target:* either the node fails loudly, or the payload is marked unsourced and the UI says so.
- Nothing in the interface currently distinguishes real market data from invented market data.

### CA-09 — google_jobs still returns results at all
**Known issue**

**Steps**
1. Call SerpAPI directly with a deliberately common role and market:
   ```bash
   curl -s "https://serpapi.com/search?engine=google_jobs&q=Android+Developer+in+Germany&api_key=$SERPAPI_KEY" \
     | head -c 600
   ```
2. Check whether `google_jobs_results` is present and non-empty.

**Expected**
- A non-empty `google_jobs_results` array.
- If it is empty or the engine errors, the whole market lane is decorative and CA-08 is not an edge case but the normal path.

### CA-10 — Schema-constrained output survives a rejected schema
**Functional**

**Steps**
1. Run CA-04 several times with different resumes and roles.
2. Watch for any run that produces a parse error or an empty section.

**Expected**
- Every run yields all three sections.
- If Workers AI rejects a schema, the call retries unconstrained and the run still completes — degraded, never failed.
- An object payload from the model is used directly; a fenced string is stripped and parsed. Both paths end in a real object.

### CA-11 — CORS allowlist holds
**Security**

**Steps**
1. Preflight `/api/career/start` from `https://evil.example`.
2. Repeat from `https://career-assistant-3by.pages.dev` and from a preview subdomain.

**Expected**
- Only the production origin and its preview suffix are echoed.
- Resume text cannot be posted from a page on another origin.

### CA-12 — Progress detail and timers are live
**UX / A11y**

**Steps**
1. Start an analysis and watch each agent row while it runs.
2. Read the detail text the market agent reports.
3. After the result renders, click Reset and run a second analysis.

**Expected**
- The elapsed timer ticks during Working and stops at Done.
- Detail text is specific — a posting count, not a spinner label.
- Reset clears the previous result; the second run shows only its own output.

---

## 7. Cross-cutting

### X-01 — Every deployment is served over HTTPS with a valid certificate
**Security**

**Steps**
1. Load all five Pages sites and check the padlock.
2. Confirm no mixed-content warnings in the console.

**Expected**
- Valid certificates on all five hosts.
- No page loads an asset over plain HTTP.

### X-02 — Each app is usable at 375 px
**UX / A11y**

**Steps**
1. Set the viewport to 375 px on each of the four apps.
2. Complete one primary action per app: send a chat message, plan a trip, run an analysis.

**Expected**
- No horizontal page scroll anywhere.
- Every control is reachable and tappable.
- Wide content — budget bars, tables, code — scrolls inside its own container, not the page.

### X-03 — Consoles are clean on a normal run
**Functional**

**Steps**
1. Open each app with the console visible.
2. Complete one full happy-path run.

**Expected**
- No uncaught exceptions, no React key warnings, no failed asset requests.
- Deliberate API failure logs are the only console output, and only when something failed.

### X-04 — Preview deployments can still reach their API
**Functional**

**Steps**
1. Deploy any client to a Pages preview branch.
2. Open the preview URL and complete one primary action.

**Expected**
- The request succeeds — the origin suffix allowlist covers preview subdomains.
- A CORS failure here means the suffix var is missing or wrong on that worker.

---

Written against production on 26 August 2026. Seven known-issue cases — MCP-09, PA-04, PA-17, TP-13, A2A-10, CA-08, CA-09 — are written to fail today; a pass on any of them means the underlying defect was fixed and this plan needs updating.
