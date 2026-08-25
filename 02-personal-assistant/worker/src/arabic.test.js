import { describe, expect, it } from "vitest";
import { hasArabic, hasPresentationForms, normalizeText } from "../../shared/arabic.js";

describe("normalizeText", () => {
  it("folds Arabic presentation forms back to base letters", () => {
    expect(normalizeText("ﺱﻼﻡ")).toBe("سلام");
  });

  it("recovers a full presentation-form line", () => {
    const encoded = "ﺍﻟﺝﺎﻣﻌﺔ";

    expect(normalizeText(encoded)).toBe("الجامعة");
  });

  it("strips tatweel and diacritics", () => {
    expect(normalizeText("الـــسَلام")).toBe(
      "السلام",
    );
  });

  it("converts Arabic-Indic digits to ASCII", () => {
    expect(normalizeText("٢٢٣٣١٨٩")).toBe("2233189");
  });

  it("maps Arabic punctuation to ASCII equivalents", () => {
    expect(normalizeText("نعم؟")).toBe("نعم?");
  });

  it("removes bidi control characters", () => {
    expect(normalizeText("‫hello‬")).toBe("hello");
  });

  it("collapses horizontal whitespace and blank line runs", () => {
    expect(normalizeText("a   b\n\n\n\nc")).toBe("a b\n\nc");
  });

  it("leaves latin text intact", () => {
    expect(normalizeText("Atlas Business Overview")).toBe("Atlas Business Overview");
  });
});

describe("script detection", () => {
  it("detects Arabic letters", () => {
    expect(hasArabic("مرحبا")).toBe(true);
    expect(hasArabic("hello")).toBe(false);
  });

  it("detects presentation forms", () => {
    expect(hasPresentationForms("ﺱ")).toBe(true);
    expect(hasPresentationForms("س")).toBe(false);
  });
});
