import { extractText, getDocumentProxy } from "unpdf";
import { embed, upsert } from "./pinecone.js";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 96;

const splitText = (text) => {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  const chunks = [];

  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    let slice = clean.slice(start, end);

    if (end < clean.length) {
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
      );
      if (breakAt > CHUNK_SIZE * 0.5) slice = slice.slice(0, breakAt + 1);
    }

    const trimmed = slice.trim();
    if (trimmed) chunks.push(trimmed);

    start += Math.max(slice.length - CHUNK_OVERLAP, 1);
  }

  return chunks;
};

export const extractPdfText = async (arrayBuffer) => {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
};

export const ingestPdf = async (env, { arrayBuffer, source, objectKey }) => {
  const text = await extractPdfText(arrayBuffer);
  const chunks = splitText(text);

  if (chunks.length === 0) {
    throw new Error("No extractable text found in PDF");
  }

  let upserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embed(env, batch, "passage");

    await upsert(
      env,
      batch.map((chunk, index) => ({
        id: `${objectKey}#${i + index}`,
        values: vectors[index],
        metadata: { text: chunk, source, objectKey },
      })),
    );

    upserted += batch.length;
  }

  return { chunks: upserted };
};
