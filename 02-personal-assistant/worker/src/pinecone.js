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
