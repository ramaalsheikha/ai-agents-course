# Session Notes

Single source of truth for `00-landing` — the portfolio landing page and the repo-wide test plan. Newest session last; the live state of the system is **session 1 §5**, and the open work is **session 1 §8**.

The other four projects keep their own notes. Nothing here supersedes them.

---

# Session 1 — 2026-08-26

Scope: a landing page that links the four deployed apps, and a manual acceptance suite covering every deployment in the repo. No changes to any existing project.

## 1. Starting Point

Four apps were already live and verified end to end in production — `02`, `03`, `04`, and `05` — plus `01-mcp-search-server` behind them. Nothing linked them together, and nothing described how to re-test them after a change.

The session opened by reading all four `SESSION_NOTES.md` files. There is no root notes file; each project owns its own, and the newest commit at the time was `5f8c333`.

## 2. What We Built

### `00-landing/public/index.html`

One self-contained page, no build step and no dependencies. Four cards, one per deployed app, each an anchor wrapping the name, description, and hostname.

- Mobile-first: one column, two at `40rem`.
- CSS custom properties for the palette, with a `prefers-color-scheme` dark block.
- Semantic `ul`/`li` list, a visually-hidden `h2`, visible `:focus-visible` outlines, and a `prefers-reduced-motion` guard on the hover transform.
- Favicon is an inline SVG data URI, so the page makes no external requests at all.

### The test plan

75 manual acceptance cases across six suites, written against production URLs rather than a local dev server. Published as an artifact:

`https://claude.ai/code/artifact/c11cff9c-456b-4370-a05d-3f2cbc783c36`

| Suite | Cases | Range |
|---|---|---|
| Landing page | 5 | LP-01 → LP-05 |
| MCP search server | 9 | MCP-01 → MCP-09 |
| Personal Assistant | 22 | PA-01 → PA-22 |
| Trip Planner (LangGraph) | 13 | TP-01 → TP-13 |
| Trip Planner (Multi-Agent) | 10 | A2A-01 → A2A-10 |
| Career Assistant | 12 | CA-01 → CA-12 |
| Cross-cutting | 4 | X-01 → X-04 |

Every case carries numbered steps and an expected-result list. Cases are chipped Smoke, Functional, Negative, Security, Known issue, or UX / A11y.

## 3. Key Decisions

### The landing page is its own Pages project, not a route on an existing one

`ai-agents` is a fifth Pages project. Attaching the index to any one app's deployment would have coupled the portfolio's uptime to that app's next deploy, and none of the four is a natural host for the other three.

### Steps were written from source, not from memory

Before writing a single case, the session read the actual route handlers, client components, and `wrangler.toml` vars for all six workers. That is where the concrete assertions come from — `{"error":"Message required"}`, the 25 MB cap, the 600-second KV TTL, the `-32601` JSON-RPC code, the `positiveInt` fallbacks. A test plan written from the session notes alone would have been plausible and wrong in a dozen places.

### Seven cases are written to fail

MCP-09, PA-04, PA-17, TP-13, A2A-10, CA-08, and CA-09 document defects that are open today. They are chipped **Known issue** and their expected-result blocks state both today's behaviour and the target. A pass on any of them means someone fixed the underlying defect and the plan needs updating — the inversion is deliberate, so a fix cannot land silently.

### Two known-issue cases carry a do-not-run warning

MCP-09 and A2A-10 both reproduce by removing a secret. Both say explicitly: preview or throwaway workers only. Clearing `MCP_AUTH_TOKEN` on the deployed `mcp-search-server` would not break it loudly — it would open the public endpoint, because `isAuthorized` returns `true` when the secret is unset. Four workers authenticate against that check.

### The plan is an artifact, not a repo file

It is a reference someone reads and works through, not source the build consumes. It lives at a stable URL that can be reshared and updated in place.

## 4. Deployed Resources

| Resource | Value |
|---|---|
| Pages project | `ai-agents` |
| Production branch | `main` |
| Production URL | `https://ai-agents-47w.pages.dev` |
| First deployment | `36fe836b` |
| Files uploaded | 1 |

## 5. Current File State

| Path | State |
|---|---|
| `00-landing/public/index.html` | new, deployed, **uncommitted** |
| `00-landing/SESSION_NOTES.md` | this file, new, **uncommitted** |
| Everything else in the repo | untouched |

No existing project was modified this session. `git status` was clean at the start; the only changes are the two files above.

## 6. Verification

| Check | Result |
|---|---|
| `ai-agents-47w.pages.dev` | 200, correct `<title>` |
| All four card links present in served HTML | 4 / 4 |
| `personal-assistant-8ve.pages.dev` | 200 |
| `trip-planner-8xe.pages.dev` | 200 |
| `trip-planner-a2a.pages.dev` | 200 |
| `career-assistant-3by.pages.dev` | 200 |

Worker health, probed the same session:

| Worker | Path | Result |
|---|---|---|
| `mcp-search-server` | `/health` | 200 `{"ok":true,"server":"serp-search-mcp"}` |
| `personal-assistant-api` | `/api/health` | 200 |
| `trip-planner-api` | `/api/health` | 200 |
| `career-assistant-api` | `/api/health` | 200 |
| `a2a-orchestrator` | `/api/health` | 200 |
| `a2a-search-agent` | `/api/health` | 404, Cloudflare error 1042 |

The `a2a-search-agent` 404 is correct and expected — the three A2A agents publish no `workers.dev` route and are reachable only over Service Bindings. It became test case **A2A-02**, where a 200 would be the failure.

## 7. Open Items Inherited, Not Introduced

The plan encodes the open work already recorded in the other four projects. Nothing new was discovered this session; nothing old was fixed.

| Case | Project | Defect |
|---|---|---|
| MCP-09 | `01` | `isAuthorized` fails open when `MCP_AUTH_TOKEN` is unset — `worker/src/index.js:122`. Four workers depend on that check. |
| PA-04 | `02` | RAG reproduces retrieved passages near-verbatim instead of summarising. The only open defect a user can see. |
| PA-12 | `02` | Duplicate-skip path still unverified against production. |
| PA-17 | `02` | Worker has no OCR path; a scanned PDF can only be ingested through `server/`, which needs local Ollama. |
| TP-13 | `03` | `gpt-oss-120b` response shape never observed live on any project. |
| A2A-10 | `04` | A search failure kills the run even though the budget agent already produced usable output. |
| CA-08 | `05` | Zero SerpAPI postings still yield a confident `topSkills` and `salaryRange`. |
| CA-09 | `05` | Whether `engine=google_jobs` returns anything at all is unconfirmed. |

## 8. Next Steps

1. **Commit `00-landing/`.** Both files are untracked. Nothing else in the repo is dirty, so this is a clean single commit.
2. **Run the suite once, end to end, and record results.** 75 cases have been written and none have been executed. Seven are expected to fail; the other 68 are unmeasured, and a written-but-never-run plan is worth very little.
3. **Fix MCP-09 first if any fix is made.** It is the only security item, and its blast radius is four workers rather than one.
4. **Then PA-04.** It is the only open defect visible to a user, and the fix is a clause in the RAG prompt.
5. **Add the landing page to the suite's own regression path.** Every time an app's Pages URL changes, LP-02 is the case that catches the stale link — the landing page is the one place in the repo that hardcodes all four hostnames.
