import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import { deleteByContentHash, ingestData } from "../ingest.js";

const PROBE_DIMENSION = 1024;

const getIndex = () => {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.Index(process.env.PINECONE_INDEX);
  const namespace = process.env.PINECONE_NAMESPACE || "";

  return namespace ? index.namespace(namespace) : index;
};

const sampleMetadata = async (index, limit) => {
  const { matches = [] } = await index.query({
    vector: new Array(PROBE_DIMENSION).fill(0.001),
    topK: limit,
    includeMetadata: true,
  });

  return matches;
};

const stats = async () => {
  const index = getIndex();
  const description = await index.describeIndexStats();

  console.log("total vectors:", description.totalRecordCount ?? 0);
  console.log("namespaces:", JSON.stringify(description.namespaces ?? {}, null, 2));

  const matches = await sampleMetadata(index, 1000);
  const bySource = new Map();

  for (const match of matches) {
    const source = match.metadata?.source ?? "(none)";
    const entry = bySource.get(source) ?? { chunks: 0, hashed: 0, extraction: new Set() };

    entry.chunks += 1;
    if (match.metadata?.contentHash) entry.hashed += 1;
    entry.extraction.add(match.metadata?.extraction ?? "legacy");
    bySource.set(source, entry);
  }

  console.log(`\nsampled ${matches.length} vectors:`);
  for (const [source, entry] of [...bySource].sort((a, b) => b[1].chunks - a[1].chunks)) {
    console.log(
      `  ${entry.chunks.toString().padStart(4)}  hashed=${entry.hashed}  ` +
        `extraction=${[...entry.extraction].join("/")}  ${source}`,
    );
  }
};

const purge = async (predicate, label) => {
  const index = getIndex();
  const matches = await sampleMetadata(index, 1000);
  const ids = matches.filter((match) => predicate(match.metadata ?? {})).map((match) => match.id);

  if (ids.length === 0) {
    console.log(`nothing matched ${label}`);
    return 0;
  }

  for (let i = 0; i < ids.length; i += 1000) {
    await index.deleteMany(ids.slice(i, i + 1000));
  }

  console.log(`deleted ${ids.length} vectors (${label})`);
  return ids.length;
};

const ingest = async (files) => {
  for (const file of files) {
    const source = decodeURIComponent(file.split("/").pop());

    try {
      const result = await ingestData(file, {
        source,
        force: true,
        onProgress: (event) => console.log(`  ${source}`, JSON.stringify(event)),
      });

      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(`FAILED ${source}: ${error.message}`);
    }
  }
};

const [command, ...rest] = process.argv.slice(2);

if (command === "stats") {
  await stats();
} else if (command === "purge-legacy") {
  await purge((metadata) => !metadata.contentHash, "vectors without a contentHash");
} else if (command === "purge-temp-sources") {
  await purge(
    (metadata) => typeof metadata.source === "string" && metadata.source.startsWith("/"),
    "vectors whose source is a filesystem path",
  );
} else if (command === "purge-hash") {
  for (const hash of rest) {
    console.log(`deleted ${await deleteByContentHash(hash)} vectors for ${hash}`);
  }
} else if (command === "purge-source") {
  await purge((metadata) => rest.includes(metadata.source), `sources ${rest.join(", ")}`);
} else if (command === "ingest") {
  await ingest(rest);
} else {
  console.log(
    [
      "usage: node scripts/reindex.js <command>",
      "  stats                      show vector counts and per-source metadata health",
      "  purge-legacy               delete vectors ingested before content hashing",
      "  purge-temp-sources         delete vectors whose source is a temp file path",
      "  purge-source <name...>     delete vectors for the named sources",
      "  purge-hash <hash...>       delete every vector for a content hash",
      "  ingest <file...>           ingest files, overwriting existing chunks",
    ].join("\n"),
  );
}
