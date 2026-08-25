import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { extractPages, assessDocument, assessText } from "./lib/pdf-text.js";
import { isOcrAvailable, ocrPages } from "./lib/ocr.js";

const EMBEDDING_MODEL = "llama-text-embed-v2";
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH_SIZE = 96;
const UPSERT_BATCH_SIZE = 96;

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
});

const hashContent = (buffer) => createHash("sha256").update(buffer).digest("hex");

const getIndex = () => {
  if (!process.env.PINECONE_API_KEY) throw new Error("Missing PINECONE_API_KEY");
  if (!process.env.PINECONE_INDEX) throw new Error("Missing PINECONE_INDEX");

  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const index = pc.Index(process.env.PINECONE_INDEX);
  const namespace = process.env.PINECONE_NAMESPACE || "";

  return { pc, index: namespace ? index.namespace(namespace) : index };
};

const findExisting = async (index, contentHash) => {
  const { vectors = [] } = await index.listPaginated({
    prefix: `${contentHash}#`,
    limit: 1,
  });

  return vectors.length > 0;
};

const resolveText = async (data, onProgress) => {
  const pages = await extractPages(data);
  const assessment = assessDocument(pages);

  if (assessment.usable) {
    return { pages: pages.map(({ pageNumber, text }) => ({ pageNumber, text, extraction: "text" })), assessment, ocrPagesUsed: 0 };
  }

  const damaged = pages.filter((page) => !page.quality.usable).map((page) => page.pageNumber);

  if (!(await isOcrAvailable())) {
    throw new Error(
      `Text layer is unusable (${(assessment.mojibakeRatio * 100).toFixed(1)}% unmapped glyphs on ` +
        `${damaged.length}/${pages.length} pages) and OCR fallback is unavailable. ` +
        `Start Ollama with a vision model, or set OCR_MODEL to one you have.`,
    );
  }

  onProgress?.({ stage: "ocr", pages: damaged.length });

  const recovered = await ocrPages(data, damaged, (pageNumber, total) =>
    onProgress?.({ stage: "ocr-page", pageNumber, total }),
  );

  const byPage = new Map(recovered.map((page) => [page.pageNumber, page.text]));
  const merged = pages.map((page) =>
    byPage.has(page.pageNumber)
      ? { pageNumber: page.pageNumber, text: byPage.get(page.pageNumber), extraction: "ocr" }
      : { pageNumber: page.pageNumber, text: page.text, extraction: "text" },
  );

  const rescued = merged.filter((page) => assessText(page.text).usable);

  if (rescued.length === 0) {
    throw new Error("Neither the PDF text layer nor OCR produced readable text");
  }

  return { pages: merged, assessment, ocrPagesUsed: recovered.length };
};

const buildChunks = async (pages, { source, contentHash }) => {
  const chunks = [];

  for (const page of pages) {
    if (!assessText(page.text).usable) continue;

    const parts = await splitter.splitText(page.text);

    parts.forEach((text, chunkIndex) => {
      chunks.push({
        id: `${contentHash}#${page.pageNumber}#${chunkIndex}`,
        text,
        metadata: {
          text,
          source,
          contentHash,
          pageNumber: page.pageNumber,
          chunkIndex,
          extraction: page.extraction,
        },
      });
    });
  }

  return chunks;
};

const embedAll = async (pc, texts) => {
  const values = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await pc.inference.embed(EMBEDDING_MODEL, batch, {
      inputType: "passage",
      truncate: "END",
    });

    values.push(...embeddings.data.map((entry) => entry.values));
  }

  return values;
};

export const ingestData = async (filePath, options = {}) => {
  const { source, force = false, onProgress } = options;
  const data = await readFile(filePath);
  const contentHash = hashContent(data);
  const label = source || filePath.split("/").pop();

  const { pc, index } = getIndex();

  if (!force && (await findExisting(index, contentHash))) {
    return { status: "skipped", reason: "duplicate", contentHash, source: label };
  }

  onProgress?.({ stage: "extract" });

  const { pages, assessment, ocrPagesUsed } = await resolveText(data, onProgress);
  const chunks = await buildChunks(pages, { source: label, contentHash });

  if (chunks.length === 0) throw new Error("No extractable text found in PDF");

  onProgress?.({ stage: "embed", chunks: chunks.length });

  const vectors = await embedAll(
    pc,
    chunks.map((chunk) => chunk.text),
  );

  for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPSERT_BATCH_SIZE);

    await index.upsert(
      batch.map((chunk, offset) => ({
        id: chunk.id,
        values: vectors[i + offset],
        metadata: chunk.metadata,
      })),
    );
  }

  return {
    status: "ingested",
    contentHash,
    source: label,
    chunks: chunks.length,
    pages: pages.length,
    ocrPages: ocrPagesUsed,
    textLayerUsable: assessment.usable,
  };
};

export const deleteByContentHash = async (contentHash) => {
  const { index } = getIndex();
  const ids = [];
  let paginationToken;

  do {
    const page = await index.listPaginated({
      prefix: `${contentHash}#`,
      limit: 100,
      paginationToken,
    });

    ids.push(...(page.vectors || []).map((vector) => vector.id));
    paginationToken = page.pagination?.next;
  } while (paginationToken);

  if (ids.length) await index.deleteMany(ids);

  return ids.length;
};
