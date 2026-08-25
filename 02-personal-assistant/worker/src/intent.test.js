import { describe, expect, it } from "vitest";
import { isSmallTalk } from "./intent.js";

describe("isSmallTalk", () => {
  it("matches English greetings", () => {
    for (const message of ["Hello", "hi", "Hiii", "Hey there", "Good morning", "yo"]) {
      expect(isSmallTalk(message), message).toBe(true);
    }
  });

  it("matches thanks, farewells and acknowledgements", () => {
    for (const message of ["Thanks!", "thank you so much", "Bye", "ok", "Got it", "Perfect"]) {
      expect(isSmallTalk(message), message).toBe(true);
    }
  });

  it("matches capability questions", () => {
    for (const message of ["Who are you?", "What can you do?", "Introduce yourself"]) {
      expect(isSmallTalk(message), message).toBe(true);
    }
  });

  it("matches Arabic greetings and small talk", () => {
    for (const message of ["مرحبا", "أهلا", "السلام عليكم", "شكراً", "كيف حالك؟", "من أنت"]) {
      expect(isSmallTalk(message), message).toBe(true);
    }
  });

  it("does not match questions that need retrieval", () => {
    for (const message of [
      "Summarize the uploaded document",
      "What is in the training period PDF?",
      "hello, what does the document say about pricing?",
      "who are you looking for in the report",
      "ما هي مدة فترة التدريب؟",
      "search the web for llama 3.3 pricing",
    ]) {
      expect(isSmallTalk(message), message).toBe(false);
    }
  });

  it("does not match empty or non-string input", () => {
    expect(isSmallTalk("")).toBe(false);
    expect(isSmallTalk("   ")).toBe(false);
    expect(isSmallTalk(null)).toBe(false);
    expect(isSmallTalk(undefined)).toBe(false);
  });

  it("does not match long messages that merely open with a greeting", () => {
    expect(
      isSmallTalk("hi there, could you please tell me everything the knowledge base knows"),
    ).toBe(false);
  });
});
