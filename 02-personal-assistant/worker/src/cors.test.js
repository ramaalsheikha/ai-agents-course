import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./cors.js";

const env = {
  CLIENT_ORIGIN: "https://personal-assistant-8ve.pages.dev",
  CLIENT_ORIGIN_SUFFIXES: ".personal-assistant-8ve.pages.dev",
};

describe("isAllowedOrigin", () => {
  it("allows the exact production origin", () => {
    expect(isAllowedOrigin("https://personal-assistant-8ve.pages.dev", env)).toBe(true);
  });

  it("allows preview deployments of the same Pages project", () => {
    expect(isAllowedOrigin("https://8007c40f.personal-assistant-8ve.pages.dev", env)).toBe(true);
    expect(isAllowedOrigin("https://branch.personal-assistant-8ve.pages.dev", env)).toBe(true);
  });

  it("rejects a lookalike project that only ends with the same words", () => {
    expect(isAllowedOrigin("https://evil-personal-assistant-8ve.pages.dev", env)).toBe(false);
  });

  it("rejects other Pages projects", () => {
    expect(isAllowedOrigin("https://someone-else.pages.dev", env)).toBe(false);
  });

  it("rejects non-https origins that match the suffix", () => {
    expect(isAllowedOrigin("http://preview.personal-assistant-8ve.pages.dev", env)).toBe(false);
  });

  it("rejects missing or malformed origins", () => {
    expect(isAllowedOrigin(undefined, env)).toBe(false);
    expect(isAllowedOrigin("", env)).toBe(false);
    expect(isAllowedOrigin("not-a-url", env)).toBe(false);
  });

  it("falls back to exact matching when no suffixes are configured", () => {
    const strict = { CLIENT_ORIGIN: env.CLIENT_ORIGIN };

    expect(isAllowedOrigin("https://personal-assistant-8ve.pages.dev", strict)).toBe(true);
    expect(isAllowedOrigin("https://8007c40f.personal-assistant-8ve.pages.dev", strict)).toBe(false);
  });

  it("supports multiple comma separated origins", () => {
    const multi = { CLIENT_ORIGIN: "http://localhost:5173, https://personal-assistant-8ve.pages.dev" };

    expect(isAllowedOrigin("http://localhost:5173", multi)).toBe(true);
  });
});
