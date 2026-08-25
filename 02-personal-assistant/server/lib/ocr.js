import { renderPageAsImage } from "unpdf";
import { normalizeText } from "./arabic.js";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "gemma4:26b";
const DEFAULT_SCALE = 2;
const DEFAULT_TIMEOUT_MS = 900000;
const DEFAULT_KEEP_ALIVE = "15m";
const MAX_ATTEMPTS = 2;

const PROMPT = [
  "Transcribe every piece of text visible in this scanned page.",
  "Preserve the original language, reading order, and line breaks.",
  "Do not translate, summarise, explain, or add commentary.",
  "Return the transcription only. If the page has no text, return nothing.",
].join(" ");

const FENCE = /^```[a-z]*\n?|\n?```$/g;

const baseUrl = () => (process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

const model = () => process.env.OCR_MODEL || DEFAULT_MODEL;

const scale = () => Number(process.env.OCR_SCALE || DEFAULT_SCALE);

const timeoutMs = () => Number(process.env.OCR_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

const keepAlive = () => process.env.OCR_KEEP_ALIVE || DEFAULT_KEEP_ALIVE;

export const isOcrEnabled = () => process.env.OCR_FALLBACK !== "off";

export const isOcrAvailable = async () => {
  if (!isOcrEnabled()) return false;

  try {
    const res = await fetch(`${baseUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;

    const { models = [] } = await res.json();
    return models.some((entry) => entry.name === model());
  } catch {
    return false;
  }
};

const requestTranscription = async (png) => {
  const res = await fetch(`${baseUrl()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs()),
    body: JSON.stringify({
      model: model(),
      prompt: PROMPT,
      images: [Buffer.from(png).toString("base64")],
      stream: false,
      think: false,
      keep_alive: keepAlive(),
      options: { temperature: 0 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama OCR failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const { response = "" } = await res.json();
  return normalizeText(response.replace(FENCE, ""));
};

const transcribe = async (png, pageNumber) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestTranscription(png);
    } catch (error) {
      lastError = error;
      console.warn(`[ocr] page ${pageNumber} attempt ${attempt} failed: ${error.message}`);
    }
  }

  throw new Error(`OCR failed for page ${pageNumber}: ${lastError.message}`);
};

export const ocrPages = async (data, pageNumbers, onProgress) => {
  const pages = [];

  for (const pageNumber of pageNumbers) {
    const png = await renderPageAsImage(new Uint8Array(data), pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: scale(),
    });

    const text = await transcribe(png, pageNumber);
    pages.push({ pageNumber, text });
    onProgress?.(pageNumber, pageNumbers.length);
  }

  return pages;
};
