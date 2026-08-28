import { describe, expect, it } from "vitest";
import { stripToolCalls } from "./sanitize";

describe("stripToolCalls", () => {
  it("removes a raw tool call emitted as JSON", () => {
    const raw =
      '{"type":"function","name":"image_search","parameters":{"query":"Baha\'a"}}';

    expect(stripToolCalls(raw)).toBe("");
  });

  it("keeps the prose around a stripped call", () => {
    const raw =
      'Looking that up.\n<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>\nDone.';

    expect(stripToolCalls(raw)).toBe("Looking that up.\n\nDone.");
  });

  it("removes a call whose arguments use an invalid escape", () => {
    const raw = `{"type": "function", "name": "image_search", "parameters": {"query": "Baha\\'a Abdul-Rahman"}}`;

    expect(stripToolCalls(raw)).toBe("");
  });

  it("leaves an answer without tool calls untouched", () => {
    const raw = "Here are the images:\n\n![Kitten](https://example.com/a.jpg)";

    expect(stripToolCalls(raw)).toBe(raw);
  });

  it("leaves unrelated JSON untouched", () => {
    const raw =
      'A config looks like {"name":"app","version":"1.0","port":3000}.';

    expect(stripToolCalls(raw)).toBe(raw);
  });

  it("handles empty and missing values", () => {
    expect(stripToolCalls(undefined)).toBe("");
    expect(stripToolCalls("")).toBe("");
  });
});
