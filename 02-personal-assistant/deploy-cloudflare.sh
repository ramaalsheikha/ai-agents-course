#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$ROOT/worker"
CLIENT_DIR="$ROOT/client"
ENV_FILE="$ROOT/server/.env"
WORKER_NAME="personal-assistant-api"
PAGES_PROJECT="personal-assistant"
BUCKET_NAME="personal-assistant-docs"
KV_BINDING="CHAT_HISTORY"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

read_env_key() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '\r')"
  [ -n "$value" ] || fail "$key not found in $ENV_FILE"
  printf '%s' "$value"
}

wr() { (cd "$WORKER_DIR" && npx --yes wrangler "$@"); }

log "Checking Cloudflare authentication"
if ! wr whoami 2>&1 | grep -qiE "account id|associated with the email"; then
  fail "Not authenticated. Run: npx wrangler login   (or export CLOUDFLARE_API_TOKEN)"
fi

log "Installing worker dependencies"
(cd "$WORKER_DIR" && npm install --no-fund --no-audit)

log "Ensuring KV namespace '$KV_BINDING'"
KV_ID="$(wr kv namespace list 2>/dev/null \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((n['id'] for n in d if n.get('title','').endswith('$KV_BINDING')),''))" 2>/dev/null || true)"

if [ -z "$KV_ID" ]; then
  KV_OUTPUT="$(wr kv namespace create "$KV_BINDING" 2>&1)"
  echo "$KV_OUTPUT"
  KV_ID="$(printf '%s' "$KV_OUTPUT" | grep -oE '[0-9a-f]{32}' | head -1)"
fi
[ -n "$KV_ID" ] || fail "Could not determine KV namespace id"
echo "KV namespace id: $KV_ID"

log "Writing KV id into wrangler.toml"
python3 - "$WORKER_DIR/wrangler.toml" "$KV_ID" <<'PYEOF'
import re, sys
path, kv_id = sys.argv[1], sys.argv[2]
text = open(path).read()
text = re.sub(r'(\[\[kv_namespaces\]\]\nbinding = "CHAT_HISTORY"\nid = ")[^"]*(")', rf'\g<1>{kv_id}\g<2>', text)
open(path, "w").write(text)
PYEOF

if grep -q "r2_buckets" "$WORKER_DIR/wrangler.toml"; then
  log "Ensuring R2 bucket '$BUCKET_NAME'"
  wr r2 bucket create "$BUCKET_NAME" 2>&1 | grep -viE "already (exists|owned)" || true
else
  log "R2 binding not configured, skipping bucket creation"
fi

log "Uploading secrets from server/.env"
for KEY in PINECONE_API_KEY PINECONE_INDEX SERPAPI_API_KEY; do
  VALUE="$(read_env_key "$KEY")"
  printf '%s' "$VALUE" | wr secret put "$KEY" >/dev/null 2>&1 \
    && echo "  $KEY uploaded" \
    || fail "Failed to upload $KEY"
  unset VALUE
done

log "Deploying Worker"
DEPLOY_OUTPUT="$(wr deploy 2>&1)"
echo "$DEPLOY_OUTPUT"
WORKER_URL="$(printf '%s' "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)"
[ -n "$WORKER_URL" ] || fail "Could not parse Worker URL from deploy output"

log "Health check: $WORKER_URL/api/health"
curl -fsS --retry 5 --retry-delay 2 "$WORKER_URL/api/health" || fail "Worker health check failed"
echo

log "Building frontend against $WORKER_URL"
printf 'VITE_API_URL=%s\n' "$WORKER_URL" > "$CLIENT_DIR/.env.production"
(cd "$CLIENT_DIR" && npm install --no-fund --no-audit && npm run build)

log "Ensuring Pages project '$PAGES_PROJECT'"
wr pages project create "$PAGES_PROJECT" --production-branch main 2>&1 | grep -viE "already exists" || true

log "Deploying frontend to Pages"
PAGES_OUTPUT="$(cd "$CLIENT_DIR" && npx --yes wrangler pages deploy dist --project-name "$PAGES_PROJECT" --commit-dirty=true 2>&1)"
echo "$PAGES_OUTPUT"
PAGES_URL="$(printf '%s' "$PAGES_OUTPUT" | grep -oE 'https://[a-z0-9.-]+\.pages\.dev' | tail -1)"
[ -n "$PAGES_URL" ] || fail "Could not parse Pages URL from deploy output"

PROD_URL="https://$(printf '%s' "$PAGES_URL" | sed -E 's|https://[^.]+\.||')"

log "Locking CORS to $PROD_URL"
python3 - "$WORKER_DIR/wrangler.toml" "$PROD_URL" "$PAGES_URL" <<'PYEOF'
import re, sys
path, prod, preview = sys.argv[1], sys.argv[2], sys.argv[3]
origins = prod if preview == prod else f"{prod},{preview}"
text = open(path).read()
text = re.sub(r'(CLIENT_ORIGIN = ")[^"]*(")', rf'\g<1>{origins}\g<2>', text)
open(path, "w").write(text)
PYEOF

log "Redeploying Worker with locked CORS"
wr deploy >/dev/null

printf '\n\033[1;32m=== LIVE ===\033[0m\n'
printf 'Frontend : %s\n' "$PROD_URL"
printf 'Preview  : %s\n' "$PAGES_URL"
printf 'API      : %s\n' "$WORKER_URL"
