# Deploying to Cloudflare

Backend runs as a Cloudflare Worker (`worker/`), frontend as a static site on Cloudflare Pages (`client/`).
Inference uses Workers AI. The original Node server in `server/` is kept for local course work and is not deployed.

## Prerequisites

- Cloudflare account
- `npm i -g wrangler` (or use `npx wrangler`)
- Pinecone index using the `llama-text-embed-v2` model
- SerpAPI key

```sh
npx wrangler login
```

## 1. Create the resources

```sh
cd 02-personal-assistant/worker
npm install

npx wrangler kv namespace create CHAT_HISTORY
npx wrangler r2 bucket create personal-assistant-docs
```

Copy the `id` printed by the KV command into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

## 2. Set secrets

Secrets are encrypted and never live in `wrangler.toml`.

```sh
npx wrangler secret put PINECONE_API_KEY
npx wrangler secret put PINECONE_INDEX
npx wrangler secret put SERPAPI_API_KEY
```

## 3. Deploy the Worker

```sh
npx wrangler deploy
```

Note the deployed URL, e.g. `https://personal-assistant-api.<subdomain>.workers.dev`.

```sh
curl https://personal-assistant-api.<subdomain>.workers.dev/api/health
```

## 4. Deploy the frontend

```sh
cd ../client
echo "VITE_API_URL=https://personal-assistant-api.<subdomain>.workers.dev" > .env.production
npm install
npm run build
npx wrangler pages deploy dist --project-name personal-assistant
```

## 5. Lock CORS to the Pages URL

Set `CLIENT_ORIGIN` in `wrangler.toml` to the Pages URL returned in step 4, then redeploy:

```sh
cd ../worker
npx wrangler deploy
```

Multiple origins are comma-separated:

```toml
CLIENT_ORIGIN = "https://personal-assistant.pages.dev,https://assistant.example.com"
```

## Local development

```sh
cd worker
cp .dev.vars.example .dev.vars
npx wrangler dev

cd ../client
npm run dev
```

`.dev.vars` holds local secrets and is gitignored. The Workers AI binding always calls the remote
Cloudflare API, so local runs consume Neurons.

## Configuration reference

| Name | Where | Purpose |
| --- | --- | --- |
| `AI` | binding | Workers AI inference |
| `CHAT_HISTORY` | KV binding | Per-session conversation history, 7 day TTL |
| `DOCUMENTS` | R2 binding | Original uploaded PDFs |
| `AI_MODEL` | var | Workers AI model ID |
| `CLIENT_ORIGIN` | var | Comma-separated allowed CORS origins |
| `PINECONE_NAMESPACE` | var | Optional Pinecone namespace |
| `PINECONE_API_KEY` | secret | Pinecone auth |
| `PINECONE_INDEX` | secret | Pinecone index name |
| `SERPAPI_API_KEY` | secret | SerpAPI auth |

## Model selection

`AI_MODEL` must be a Workers AI model that supports function calling, otherwise the agent
cannot call its tools.

| Model | Context |
| --- | --- |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default) | 24k |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 131k |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 128k |

`@cf/meta/llama-3-8b-instruct` does not support function calling and is deprecated.

## MCP mode

The `mcp` mode discovers its tools at runtime from a second Worker in `01-mcp-search-server/worker`,
which speaks MCP JSON-RPC over HTTP (`initialize`, `tools/list`, `tools/call`).

Deploy it first:

```sh
cd 01-mcp-search-server/worker
npm install
npx wrangler secret put SERPAPI_API_KEY
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler deploy
```

`MCP_AUTH_TOKEN` gates the endpoint so it is not an open SerpAPI proxy. Set the same value as a
secret on the assistant Worker.

The assistant reaches it through a service binding, not its public URL. Worker-to-Worker calls over
`workers.dev` on the same account fail with error 1042.

```toml
[[services]]
binding = "MCP"
service = "mcp-search-server"
```

The `mcp-stdio` mode from the local version cannot be ported. It spawned the MCP server as a child
process over stdin/stdout, and Workers have no process model.

## Optional: rate limiting

Add to `wrangler.toml` and redeploy. The Worker enables per-IP limiting automatically when the
binding is present.

```toml
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 60, period = 60 }
```
