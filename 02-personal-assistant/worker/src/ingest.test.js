import { describe, expect, it } from "vitest";
import { contentHash, contentPrefix, documentPrefix, pageToText, splitText } from "./ingest.js";

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

const buildDocument = (paragraphs) =>
  Array.from(
    { length: paragraphs },
    (_, i) => `Paragraph ${i}. ${"word ".repeat(60).trim()}.`,
  ).join("\n\n");

describe("splitText", () => {
  it("terminates without emitting one-character-shifted tail duplicates", () => {
    const text = `${buildDocument(8)}\n\ncreating a smarter connection between companies.`;
    const chunks = splitText(text);

    expect(chunks.length).toBeLessThan(20);
    expect(new Set(chunks).size).toBe(chunks.length);
  });

  it("emits the trailing remainder exactly once", () => {
    const text = `${"a".repeat(CHUNK_SIZE * 2)}\nTRAILING SENTENCE.`;
    const chunks = splitText(text);
    const tails = chunks.filter((chunk) => chunk.includes("TRAILING SENTENCE."));

    expect(tails).toHaveLength(1);
  });

  it("keeps every chunk within the configured size", () => {
    const chunks = splitText(buildDocument(12));

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("covers the whole document across chunks", () => {
    const text = buildDocument(6);
    const chunks = splitText(text);

    expect(chunks[0].startsWith("Paragraph 0.")).toBe(true);
    expect(chunks[chunks.length - 1].endsWith(".")).toBe(true);
    expect(chunks.join(" ")).toContain("Paragraph 5.");
  });

  it("advances by at least the non-overlapping span on long documents", () => {
    const chunks = splitText(buildDocument(20));
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    expect(totalLength).toBeLessThan(buildDocument(20).length * 2);
    expect(chunks.every((chunk) => chunk.length > CHUNK_OVERLAP)).toBe(true);
  });

  it("returns no chunks for empty input", () => {
    expect(splitText("   \n  ")).toEqual([]);
  });
});

describe("documentPrefix", () => {
  it("is stable for the same source name", async () => {
    const a = await documentPrefix("Atlas_Business_Overview_NoInvestor.pdf");
    const b = await documentPrefix("Atlas_Business_Overview_NoInvestor.pdf");

    expect(a).toBe(b);
  });

  it("differs across source names", async () => {
    const a = await documentPrefix("Atlas_Business_Overview_NoInvestor.pdf");
    const b = await documentPrefix("other.pdf");

    expect(a).not.toBe(b);
  });

  it("produces an ASCII-safe id prefix for non-latin file names", async () => {
    const prefix = await documentPrefix("تقرير_التدريب_العملي.pdf");

    expect(prefix).toMatch(/^doc_[0-9a-f]{16}$/);
  });
});

const item = (str, x, y, { dir = "ltr", width = str.length * 5 } = {}) => ({
  str,
  dir,
  width,
  height: 10,
  transform: [1, 0, 0, 1, x, y],
});

describe("pageToText", () => {
  it("reads left-to-right runs in ascending x order", () => {
    const items = [item("world", 60, 700), item("hello", 10, 700)];

    expect(pageToText(items)).toBe("hello world");
  });

  it("reads right-to-left runs in descending x order", () => {
    const items = [
      item("\u0627\u0644\u0645\u064a\u062f\u0627\u0646\u064a", 60, 700, { dir: "rtl", width: 40 }),
      item("\u0627\u0644\u062a\u062f\u0631\u064a\u0628", 110, 700, { dir: "rtl", width: 40 }),
    ];

    expect(pageToText(items)).toBe(
      "\u0627\u0644\u062a\u062f\u0631\u064a\u0628 \u0627\u0644\u0645\u064a\u062f\u0627\u0646\u064a",
    );
  });

  it("keeps lines separated by vertical position, top first", () => {
    const items = [item("second", 10, 680), item("first", 10, 700)];

    expect(pageToText(items)).toBe("first\nsecond");
  });

});

describe("contentPrefix", () => {
  it("is stable for identical bytes regardless of file name", async () => {
    const bytes = new TextEncoder().encode("same content").buffer;
    const a = contentPrefix(await contentHash(bytes));
    const b = contentPrefix(await contentHash(new TextEncoder().encode("same content").buffer));

    expect(a).toBe(b);
    expect(a).toMatch(/^sha_[0-9a-f]{32}$/);
  });

  it("differs when the bytes differ", async () => {
    const a = contentPrefix(await contentHash(new TextEncoder().encode("one").buffer));
    const b = contentPrefix(await contentHash(new TextEncoder().encode("two").buffer));

    expect(a).not.toBe(b);
  });
});
