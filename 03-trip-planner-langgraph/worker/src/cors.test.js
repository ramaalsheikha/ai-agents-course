import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./cors.js";

const env = {
  CLIENT_ORIGIN: "http://localhost:5174,https://trip-planner-8xe.pages.dev",
  CLIENT_ORIGIN_SUFFIXES: ".trip-planner-8xe.pages.dev",
};

describe("isAllowedOrigin", () => {
  it("allows the exact production origin", () => {
    expect(isAllowedOrigin("https://trip-planner-8xe.pages.dev", env)).toBe(true);
  });

  it("allows the local dev client origin", () => {
    expect(isAllowedOrigin("http://localhost:5174", env)).toBe(true);
  });

  it("allows preview deployments of the same Pages project", () => {
    expect(isAllowedOrigin("https://95a96b87.trip-planner-8xe.pages.dev", env)).toBe(true);
    expect(isAllowedOrigin("https://branch.trip-planner-8xe.pages.dev", env)).toBe(true);
  });

  it("rejects a lookalike project that only ends with the same words", () => {
    expect(isAllowedOrigin("https://evil-trip-planner-8xe.pages.dev", env)).toBe(false);
  });

  it("rejects the sibling projects on the same account", () => {
    expect(isAllowedOrigin("https://career-assistant-3by.pages.dev", env)).toBe(false);
    expect(isAllowedOrigin("https://personal-assistant-8ve.pages.dev", env)).toBe(false);
  });

  it("rejects non-https origins that match the suffix", () => {
    expect(isAllowedOrigin("http://preview.trip-planner-8xe.pages.dev", env)).toBe(false);
  });

  it("rejects missing or malformed origins", () => {
    expect(isAllowedOrigin(undefined, env)).toBe(false);
    expect(isAllowedOrigin("", env)).toBe(false);
    expect(isAllowedOrigin("not-a-url", env)).toBe(false);
  });

  it("falls back to exact matching when no suffixes are configured", () => {
    const strict = { CLIENT_ORIGIN: "https://trip-planner-8xe.pages.dev" };

    expect(isAllowedOrigin("https://trip-planner-8xe.pages.dev", strict)).toBe(true);
    expect(isAllowedOrigin("https://95a96b87.trip-planner-8xe.pages.dev", strict)).toBe(false);
  });
});
