const CONTROL_PLANE = "https://api.pinecone.io";
const API_VERSION = "2025-04";
const EMBEDDING_MODEL = "llama-text-embed-v2";

const hostCache = new Map();

const headers = (apiKey) => ({
  "Api-Key": apiKey,
  "Content-Type": "application/json",
  "X-Pinecone-Api-Version": API_VERSION,
});

const assertConfig = (env) => {
  if (!env.PINECONE_API_KEY) throw new Error("Missing PINECONE_API_KEY");
  if (!env.PINECONE_INDEX) throw new Error("Missing PINECONE_INDEX");
};

const readError = async (res, label) => {
  const body = await res.text().catch(() => "");
  return new Error(`${label} failed (${res.status}): ${body.slice(0, 500)}`);
};

const getIndexHost = async (env) => {
  assertConfig(env);

  const cached = hostCache.get(env.PINECONE_INDEX);
  if (cached) return cached;

  const res = await fetch(`${CONTROL_PLANE}/indexes/${env.PINECONE_INDEX}`, {
    headers: headers(env.PINECONE_API_KEY),
  });
  if (!res.ok) throw await readError(res, "Pinecone describe index");

  const { host } = await res.json();
  if (!host) throw new Error(`Pinecone index "${env.PINECONE_INDEX}" has no host`);

  hostCache.set(env.PINECONE_INDEX, host);
  return host;
};

export const embed = async (env, texts, inputType) => {
  assertConfig(env);

  const res = await fetch(`${CONTROL_PLANE}/embed`, {
    method: "POST",
    headers: headers(env.PINECONE_API_KEY),
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      parameters: { input_type: inputType, truncate: "END" },
      inputs: texts.map((text) => ({ text })),
    }),
  });
  if (!res.ok) throw await readError(res, "Pinecone embed");

  const { data } = await res.json();
  return data.map((item) => item.values);
};

export const query = async (env, vector, topK = 10) => {
  const host = await getIndexHost(env);

  const res = await fetch(`https://${host}/query`, {
    method: "POST",
    headers: headers(env.PINECONE_API_KEY),
    body: JSON.stringify({
      vector,
      topK,
      includeMetadata: true,
      namespace: env.PINECONE_NAMESPACE ?? "",
    }),
  });
  if (!res.ok) throw await readError(res, "Pinecone query");

  const { matches = [] } = await res.json();
  return matches;
};

export const listByPrefix = async (env, prefix, limit = Infinity) => {
  const host = await getIndexHost(env);
  const namespace = env.PINECONE_NAMESPACE ?? "";

  const ids = [];
  let paginationToken;

  do {
    const pageSize = Math.min(100, limit - ids.length);
    const params = new URLSearchParams({ prefix, limit: String(pageSize) });
    if (namespace) params.set("namespace", namespace);
    if (paginationToken) params.set("paginationToken", paginationToken);

    const res = await fetch(`https://${host}/vectors/list?${params}`, {
      headers: headers(env.PINECONE_API_KEY),
    });
    if (!res.ok) throw await readError(res, "Pinecone list vectors");

    const { vectors = [], pagination } = await res.json();
    for (const vector of vectors) ids.push(vector.id);
    paginationToken = pagination?.next;
  } while (paginationToken && ids.length < limit);

  return ids;
};

export const deleteByPrefix = async (env, prefix) => {
  const host = await getIndexHost(env);
  const namespace = env.PINECONE_NAMESPACE ?? "";
  const ids = await listByPrefix(env, prefix);

  for (let i = 0; i < ids.length; i += 1000) {
    const res = await fetch(`https://${host}/vectors/delete`, {
      method: "POST",
      headers: headers(env.PINECONE_API_KEY),
      body: JSON.stringify({ ids: ids.slice(i, i + 1000), namespace }),
    });
    if (!res.ok) throw await readError(res, "Pinecone delete vectors");
  }

  return ids.length;
};

export const upsert = async (env, vectors) => {
  const host = await getIndexHost(env);

  const res = await fetch(`https://${host}/vectors/upsert`, {
    method: "POST",
    headers: headers(env.PINECONE_API_KEY),
    body: JSON.stringify({
      vectors,
      namespace: env.PINECONE_NAMESPACE ?? "",
    }),
  });
  if (!res.ok) throw await readError(res, "Pinecone upsert");

  return res.json();
};
