import { getDocumentProxy } from "unpdf";
import { normalizeText } from "./arabic.js";

const LINE_TOLERANCE = 2.5;
const SPACE_GAP_RATIO = 0.2;
const MOJIBAKE_THRESHOLD = 0.01;
const MIN_CHARS_PER_PAGE = 24;

const MOJIBAKE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFD]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const isRtl = (items) => {
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
    const line = lines.find((candidate) => Math.abs(candidate.y - y) <= LINE_TOLERANCE);

    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + y) / line.items.length;
    } else {
      lines.push({ y, items: [item] });
    }
  }

  return lines.sort((a, b) => b.y - a.y);
};

const joinLine = (line) => {
  const rtl = isRtl(line.items);
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
      const reference = item.height || previous.height || 10;
      const needsSpace =
        gap > reference * SPACE_GAP_RATIO &&
        WORD_CHAR.test(text.slice(-1)) &&
        WORD_CHAR.test(item.str.slice(0, 1));

      if (needsSpace) text += " ";
    }

    text += item.str;
    previous = item;
  }

  return text;
};

export const assessText = (text) => {
  const stripped = text.replace(/\s/g, "");
  const mojibake = (text.match(MOJIBAKE) || []).length;
  const mojibakeRatio = stripped.length ? mojibake / stripped.length : 0;

  return {
    characters: stripped.length,
    mojibake,
    mojibakeRatio,
    usable: stripped.length >= MIN_CHARS_PER_PAGE && mojibakeRatio <= MOJIBAKE_THRESHOLD,
  };
};

export const assessDocument = (pages) => {
  const characters = pages.reduce((sum, page) => sum + page.quality.characters, 0);
  const mojibake = pages.reduce((sum, page) => sum + page.quality.mojibake, 0);
  const usablePages = pages.filter((page) => page.quality.usable).length;

  return {
    characters,
    mojibake,
    mojibakeRatio: characters ? mojibake / characters : 0,
    usablePages,
    totalPages: pages.length,
    usable: pages.length > 0 && usablePages / pages.length >= 0.6,
  };
};

export const extractPages = async (data) => {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const { items } = await page.getTextContent();
    const raw = groupIntoLines(items).map(joinLine).join("\n");
    const text = normalizeText(raw);

    pages.push({ pageNumber, text, quality: assessText(text) });
  }

  return pages;
};
