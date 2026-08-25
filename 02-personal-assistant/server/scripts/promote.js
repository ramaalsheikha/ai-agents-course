import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";

const [from, to = "", ...prefixes] = process.argv.slice(2);

if (!from || prefixes.length === 0) {
  console.log('usage: node scripts/promote.js <fromNamespace> <toNamespace> <idPrefix...>');
  process.exit(1);
}

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const base = pc.Index(process.env.PINECONE_INDEX);
const source = base.namespace(from);
const target = to ? base.namespace(to) : base;

for (const prefix of prefixes) {
  const ids = [];
  let paginationToken;

  do {
    const page = await source.listPaginated({ prefix, limit: 100, paginationToken });
    ids.push(...(page.vectors || []).map((vector) => vector.id));
    paginationToken = page.pagination?.next;
  } while (paginationToken);

  if (ids.length === 0) {
    console.log(`no vectors under ${prefix} in "${from}"`);
    continue;
  }

  const { records } = await source.fetch(ids);
  const vectors = Object.values(records).map((record) => ({
    id: record.id,
    values: record.values,
    metadata: record.metadata,
  }));

  await target.upsert(vectors);
  console.log(`promoted ${vectors.length} vectors under ${prefix}: "${from}" -> "${to || "(default)"}"`);
}
