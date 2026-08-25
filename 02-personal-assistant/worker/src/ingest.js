import { getDocumentProxy } from "unpdf";
import { deleteByPrefix, embed, listByPrefix, upsert } from "./pinecone.js";
import { normalizeText } from "./arabic.js";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 96;
const MIN_ADVANCE = 1;
const UNREADABLE_RATIO = 0.02;
const SAME_LINE_TOLERANCE = 2;
const WORD_GAP = 1;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

const isRtlLine = (items) => {
  let rtl = 0;
  let ltr = 0;

  for (const item of items) {
    const weight = item.str.trim().length;
    if (!weight) continue;
    if (item.dir === "rtl") rtl += weight;
    else ltr += weight;
  }

  return rtl > ltr;
};

const groupIntoLines = (items) => {
  const lines = [];

  for (const item of items) {
    if (typeof item.str !== "string" || !item.str) continue;

    const y = item.transform[5];
    const line = lines.find(
      (candidate) => Math.abs(candidate.y - y) <= SAME_LINE_TOLERANCE,
    );

    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + y) / line.items.length;
    } else {
      lines.push({ y, items: [item] });
    }
  }

  return lines.sort((a, b) => b.y - a.y);
};

const lineToText = (line) => {
  const rtl = isRtlLine(line.items);
  const ordered = [...line.items].sort((a, b) =>
    rtl ? b.transform[4] - a.transform[4] : a.transform[4] - b.transform[4],
  );

  let text = "";
  let previous = null;

  for (const item of ordered) {
    if (previous) {
      const gap = rtl
        ? previous.transform[4] - (item.transform[4] + (item.width || 0))
        : item.transform[4] - (previous.transform[4] + (previous.width || 0));
      const alreadySpaced = /\s$/.test(text) || /^\s/.test(item.str);
      if (!alreadySpaced && gap > WORD_GAP) text += " ";
    }

    text += item.str;
    previous = item;
  }

  return text;
};

export const pageToText = (items) =>
  groupIntoLines(items).map(lineToText).join("\n");

const normalize = (text) => normalizeText(text.replace(/\r\n?/g, "\n"));

const assertReadable = (text) => {
  const unreadable = (text.match(CONTROL_CHARS) || []).length;
  if (text.length > 0 && unreadable / text.length > UNREADABLE_RATIO) {
    throw new Error(
      "PDF text layer is not machine-readable: its embedded fonts have no usable ToUnicode mapping, so extracted characters are meaningless. Re-export the PDF with Unicode fonts embedded, or OCR it before uploading.",
    );
  }
};

export const splitText = (text) => {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  const chunks = [];

  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    const atEnd = end >= clean.length;
    let slice = clean.slice(start, end);

    if (!atEnd) {
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
      );
      if (breakAt > CHUNK_SIZE * 0.5) slice = slice.slice(0, breakAt + 1);
    }

    const trimmed = slice.trim();
    if (trimmed) chunks.push(trimmed);

    if (atEnd) break;

    start += Math.max(slice.length - CHUNK_OVERLAP, MIN_ADVANCE);
  }

  return chunks;
};

const sha256Hex = async (bytes) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const documentPrefix = async (source) =>
  `doc_${(await sha256Hex(new TextEncoder().encode(source))).slice(0, 16)}`;

export const contentHash = async (arrayBuffer) =>
  sha256Hex(new Uint8Array(arrayBuffer).slice());

export const contentPrefix = (hash) => `sha_${hash.slice(0, 32)}`;

export const extractPdfText = async (arrayBuffer) => {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer).slice());
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const { items } = await page.getTextContent();
    pages.push(pageToText(items));
  }

  const text = normalize(pages.join("\n\n"));
  assertReadable(text);

  return text.replace(CONTROL_CHARS, "");
};

export const ingestPdf = async (env, { arrayBuffer, source, objectKey, force = false }) => {
  const hash = await contentHash(arrayBuffer);
  const prefix = contentPrefix(hash);

  if (!force) {
    const existing = await listByPrefix(env, `${prefix}#`, 1);
    if (existing.length > 0) {
      return { status: "skipped", reason: "duplicate", contentHash: hash, source, chunks: 0 };
    }
  }

  const text = await extractPdfText(arrayBuffer);
  const chunks = splitText(text);

  if (chunks.length === 0) {
    throw new Error("No extractable text found in PDF");
  }

  const replaced = await deleteByPrefix(env, `${await documentPrefix(source)}#`);

  let upserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embed(env, batch, "passage");

    await upsert(
      env,
      batch.map((chunk, index) => ({
        id: `${prefix}#${i + index}`,
        values: vectors[index],
        metadata: {
          text: chunk,
          source,
          objectKey,
          contentHash: hash,
          chunkIndex: i + index,
        },
      })),
    );

    upserted += batch.length;
  }

  return { status: "ingested", contentHash: hash, source, chunks: upserted, replaced };
};
