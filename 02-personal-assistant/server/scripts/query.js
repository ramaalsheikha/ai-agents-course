import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import { normalizeText } from "../../shared/arabic.js";

const EMBEDDING_MODEL = "llama-text-embed-v2";
const TOP_K = Number(process.env.TOP_K || 4);

const [rawQuery] = process.argv.slice(2);

if (!rawQuery) {
  console.log('usage: node scripts/query.js "your question"');
  process.exit(1);
}

const query = normalizeText(rawQuery);
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const namespace = process.env.PINECONE_NAMESPACE || "";
const base = pc.Index(process.env.PINECONE_INDEX);
const index = namespace ? base.namespace(namespace) : base;

const embeddings = await pc.inference.embed(EMBEDDING_MODEL, [query], {
  inputType: "query",
  truncate: "END",
});

const { matches = [] } = await index.query({
  vector: embeddings.data[0].values,
  topK: TOP_K,
  includeMetadata: true,
});

console.log(`query: ${query}`);
console.log(`matches: ${matches.length}\n`);

for (const match of matches) {
  const { source, pageNumber, extraction, contentHash } = match.metadata ?? {};

  console.log(
    `score=${match.score.toFixed(4)}  ${source ?? "(no source)"}  ` +
      `p.${pageNumber ?? "?"}  via=${extraction ?? "legacy"}  hash=${(contentHash ?? "none").slice(0, 8)}`,
  );
  console.log(`  ${(match.metadata?.text ?? "").slice(0, 220).replace(/\n/g, " ")}\n`);
}
