const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const CHUNK_TARGET_CHARS = 700;
const MIN_CHARS_FOR_RETRIEVAL = 1200;
const MAX_CHUNKS_TO_EMBED = 40;

const METRIC_PATTERN =
  /(\d+(\.\d+)?\s*%)|([$€£]\s?\d)|(\d+(\.\d+)?\s*(k|m|bn|b)\b)|(\d+(\.\d+)?\s*x\b)|(\d+\s*(ms|sec|seconds|minutes|hours|days|weeks|months|years|yrs))|(\d{3,})|(\d+(\.\d+)?\s*(users|customers|downloads|installs|requests|records|rows|tests|engineers|people|teams|clients|orders|transactions))/i;

const ACTION_VERB_PATTERN =
  /\b(reduced|increased|improved|cut|grew|scaled|saved|shipped|launched|led|drove|raised|lowered|boosted|optimi[sz]ed|decreased|accelerated|migrated|delivered|handled|served|processed|automated)\b/i;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "our", "you", "your",
  "are", "was", "were", "will", "have", "has", "had", "not", "but", "all", "any",
  "can", "who", "how", "why", "what", "when", "where", "job", "role", "work",
  "team", "years", "year", "experience", "skills", "using", "used", "use", "new",
  "in", "of", "to", "on", "at", "by", "as", "is", "it", "or", "an", "be", "we",
  "do", "if", "so", "up", "no", "my", "me", "he", "us",
]);

export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function chunkResume(resume, targetChars = CHUNK_TARGET_CHARS) {
  const text = String(resume || "").trim();
  if (!text) return [];

  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";
  let previous = "";

  for (const block of blocks) {
    if (block.length > targetChars * 1.6) {
      if (current) {
        chunks.push(current);
        previous = current;
        current = "";
      }
      const lines = block.split("\n");
      let piece = "";
      for (const line of lines) {
        if (piece && piece.length + line.length > targetChars) {
          chunks.push(piece);
          previous = piece;
          piece = "";
        }
        piece = piece ? `${piece}\n${line}` : line;
      }
      if (piece) current = piece;
      continue;
    }

    if (current && current.length + block.length > targetChars) {
      chunks.push(current);
      previous = current;
      const tail = previous.split("\n").slice(-1)[0] || "";
      current = tail.length < targetChars / 4 ? `${tail}\n${block}` : block;
      continue;
    }

    current = current ? `${current}\n\n${block}` : block;
  }

  if (current) chunks.push(current);
  return chunks;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function readVectors(response) {
  const data = Array.isArray(response) ? response : response?.data;
  if (!Array.isArray(data)) return null;
  const vectors = data.filter((v) => Array.isArray(v) && v.length > 0);
  return vectors.length ? vectors : null;
}

async function embed(env, texts) {
  const model = env.EMBEDDING_MODEL || EMBEDDING_MODEL;
  const response = await env.AI.run(model, { text: texts });
  return readVectors(response);
}

export async function buildResumeIndex(env, resume) {
  const text = String(resume || "").trim();
  const chunks = chunkResume(text);

  if (chunks.length < 2 || text.length < MIN_CHARS_FOR_RETRIEVAL) {
    return { mode: "raw", chunks, vectors: null, text };
  }

  const embeddable = chunks.slice(0, MAX_CHUNKS_TO_EMBED);

  try {
    const vectors = await embed(env, embeddable);
    if (vectors && vectors.length === embeddable.length) {
      return { mode: "embedding", chunks: embeddable, vectors, text };
    }
    console.error("[career] Embedding returned an unusable shape, falling back to keyword retrieval");
  } catch (error) {
    console.error(`[career] Embedding failed, falling back to keyword retrieval: ${error.message}`);
  }

  return { mode: "keyword", chunks: embeddable, vectors: null, text };
}

function keywordScores(index, query) {
  const terms = tokenize(query);
  if (!terms.length) return index.chunks.map(() => 0);
  return index.chunks.map((chunk) => {
    const haystack = chunk.toLowerCase();
    return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0);
  });
}

async function scoreChunks(env, index, query) {
  if (index.mode === "embedding") {
    try {
      const vectors = await embed(env, [query]);
      if (vectors && vectors[0]) {
        return index.vectors.map((v) => cosineSimilarity(v, vectors[0]));
      }
    } catch (error) {
      console.error(`[career] Query embedding failed, using keyword scores: ${error.message}`);
    }
  }
  return keywordScores(index, query);
}

const RELATIVE_SCORE_FLOOR = 0.6;

export async function retrieveContext(env, index, queries, { perQuery = 2, maxChars = 6000 } = {}) {
  if (!index || index.mode === "raw" || index.chunks.length === 0) {
    return String(index?.text || "").slice(0, maxChars);
  }

  const selected = new Set();

  for (const query of queries) {
    const scores = await scoreChunks(env, index, query);
    const best = Math.max(...scores, 0);
    if (best <= 0) continue;

    const ranked = scores
      .map((score, i) => ({ score, i }))
      .filter((entry) => entry.score >= best * RELATIVE_SCORE_FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, perQuery);

    for (const entry of ranked) selected.add(entry.i);
  }

  if (selected.size === 0) return index.text.slice(0, maxChars);

  const ordered = [...selected].sort((a, b) => a - b);
  let context = "";
  for (const i of ordered) {
    const next = context ? `${context}\n\n---\n\n${index.chunks[i]}` : index.chunks[i];
    if (next.length > maxChars) break;
    context = next;
  }

  return context || index.chunks[ordered[0]].slice(0, maxChars);
}

export function extractQuantifiedLines(resume, limit = 8) {
  const lines = String(resume || "")
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.replace(/^[\s•\-*–—]+/, "").trim())
    .filter((line) => line.length > 12 && line.length < 400);

  const strength = (line) =>
    (/(\d+(\.\d+)?\s*%)|(\d+(\.\d+)?\s*x\b)/i.test(line) ? 2 : 0) +
    (ACTION_VERB_PATTERN.test(line) ? 1 : 0);

  const scored = lines
    .filter((line) => METRIC_PATTERN.test(line))
    .map((line, i) => ({ line, rank: strength(line), i }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i);

  const seen = new Set();
  const out = [];
  for (const { line } of scored) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractMetric(text) {
  const match = String(text || "").match(METRIC_PATTERN);
  return match ? match[0].trim() : "";
}
