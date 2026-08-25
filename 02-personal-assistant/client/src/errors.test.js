import { describe, expect, it } from "vitest";
import { ApiError, extractErrorCode, toFriendlyMessage } from "./errors";

const USAGE_LIMIT = "The AI service has hit its usage limit. Please try again in a little while.";
const AI_UNAVAILABLE = "The AI service is temporarily unavailable. Please try again in a moment.";
const TOO_MANY = "Too many requests. Please wait a moment before trying again.";
const TIMED_OUT = "The request took too long. Please try again.";
const UNREACHABLE = "Cannot reach the server. Check your connection and try again.";
const TOO_LARGE = "That file is too large. Please upload a PDF under 25MB.";
const GENERIC = "Something went wrong. Please try again.";

describe("extractErrorCode", () => {
  it("pulls a four digit provider code out of an error string", () => {
    expect(extractErrorCode("AiError: 4006: usage limit")).toBe(4006);
  });

  it("ignores codes that are not exactly four digits", () => {
    expect(extractErrorCode("error 500")).toBeNull();
    expect(extractErrorCode("error 123456")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractErrorCode(undefined)).toBeNull();
    expect(extractErrorCode("")).toBeNull();
  });
});

describe("toFriendlyMessage", () => {
  it("resolves known provider codes first", () => {
    expect(toFriendlyMessage(new ApiError({ message: "x", status: 500, code: 4006 }))).toBe(
      USAGE_LIMIT,
    );
    expect(toFriendlyMessage(new ApiError({ message: "x", status: 500, code: 3036 }))).toBe(
      USAGE_LIMIT,
    );
    expect(toFriendlyMessage(new ApiError({ message: "x", status: 500, code: 3040 }))).toBe(
      AI_UNAVAILABLE,
    );
  });

  it("extracts the code from the detail when it is not set explicitly", () => {
    const error = new ApiError({
      message: "boom",
      status: 500,
      detail: "AiError: 4006: capacity exceeded",
    });

    expect(toFriendlyMessage(error)).toBe(USAGE_LIMIT);
  });

  it("prefers a known code over the status map", () => {
    const error = new ApiError({ message: "boom", status: 500, code: 4006 });

    expect(toFriendlyMessage(error)).toBe(USAGE_LIMIT);
  });

  it("falls through to patterns when the code is unknown", () => {
    const error = new ApiError({
      message: "boom",
      status: 500,
      code: 8007,
      detail: "8007: rate limit reached",
    });

    expect(toFriendlyMessage(error)).toBe(TOO_MANY);
  });

  it("matches quota wording", () => {
    expect(toFriendlyMessage({ detail: "monthly quota exhausted" })).toBe(USAGE_LIMIT);
    expect(toFriendlyMessage({ detail: "insufficient balance" })).toBe(USAGE_LIMIT);
  });

  it("matches timeout wording", () => {
    expect(toFriendlyMessage({ detail: "upstream timed out" })).toBe(TIMED_OUT);
  });

  it("matches network failure wording", () => {
    expect(toFriendlyMessage({ message: "Failed to fetch" })).toBe(UNREACHABLE);
    expect(toFriendlyMessage({ message: "Load failed" })).toBe(UNREACHABLE);
  });

  it("matches upload validation wording", () => {
    expect(toFriendlyMessage({ detail: "Only PDF files are allowed" })).toBe(
      "Only PDF files can be uploaded.",
    );
    expect(toFriendlyMessage({ detail: "File exceeds 25MB limit" })).toBe(TOO_LARGE);
  });

  it("falls back to the status map when nothing else matches", () => {
    expect(toFriendlyMessage(new ApiError({ message: "nope", status: 429 }))).toBe(TOO_MANY);
    expect(toFriendlyMessage(new ApiError({ message: "nope", status: 413 }))).toBe(TOO_LARGE);
    expect(toFriendlyMessage(new ApiError({ message: "nope", status: 504 }))).toBe(TIMED_OUT);
    expect(toFriendlyMessage(new ApiError({ message: "nope", status: 401 }))).toBe(
      "The service is not authorized right now. Please contact the administrator.",
    );
  });

  it("returns the generic message for unmapped statuses", () => {
    expect(toFriendlyMessage(new ApiError({ message: "nope", status: 418 }))).toBe(GENERIC);
  });

  it("returns the generic message for null and undefined", () => {
    expect(toFriendlyMessage(null)).toBe(GENERIC);
    expect(toFriendlyMessage(undefined)).toBe(GENERIC);
  });

  it("treats a network failure as unreachable rather than generic", () => {
    const error = new ApiError({
      message: "Network request failed",
      status: 0,
      detail: "Failed to fetch",
    });

    expect(toFriendlyMessage(error)).toBe(UNREACHABLE);
  });
});
