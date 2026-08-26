import { describe, expect, it, vi } from "vitest";
import {
  buildResumeIndex,
  chunkResume,
  extractMetric,
  extractQuantifiedLines,
  retrieveContext,
} from "./resume-rag.js";

const filler = (phrase) => Array.from({ length: 12 }, () => phrase).join(" ");

const LONG_RESUME = [
  `EXPERIENCE\nSenior Software Engineer at Shopfront, 2019-2025.\nBuilt a microservices e-commerce checkout serving 2M+ users.\nReduced latency by 40% through API optimization.\n${filler("Owned checkout throughput and release quality for the storefront team.")}`,
  `SKILLS\nPython, Java, React, AWS, Terraform, PostgreSQL.\n${filler("Comfortable across backend services, infrastructure as code and browser clients.")}`,
  `VOLUNTEERING\nWeekend gardening at the community allotment. Ran the raffle stall at the summer fair.\n${filler("Organised neighbourhood weekend fundraising events for the allotment society.")}`,
  `EDUCATION\nBSc Computer Science, UT Austin.\nCertified AWS Solutions Architect.\n${filler("Coursework covered algorithms, distributed systems and compilers.")}`,
].join("\n\n");

function vectorEnv({ failEmbedding = false } = {}) {
  const run = vi.fn(async (model, options) => {
    if (failEmbedding) throw new Error("embedding model unavailable");
    const texts = Array.isArray(options.text) ? options.text : [options.text];
    return {
      data: texts.map((text) => {
        const vector = new Array(512).fill(0);
        for (const token of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
          let hash = 0;
          for (let i = 0; i < token.length; i += 1) hash = (hash * 31 + token.charCodeAt(i)) % 512;
          vector[hash] += 1;
        }
        return vector;
      }),
    };
  });
  return { AI: { run } };
}

const padded = (text) => text;

describe("chunkResume", () => {
  it("splits on blank lines and keeps chunks near the target size", () => {
    const chunks = chunkResume(LONG_RESUME, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("Reduced latency by 40%");
  });

  it("returns nothing for an empty resume", () => {
    expect(chunkResume("   ")).toEqual([]);
  });
});

describe("buildResumeIndex", () => {
  it("skips retrieval for a short resume", async () => {
    const env = vectorEnv();
    const index = await buildResumeIndex(env, "Android dev, 3 years, Kotlin.");
    expect(index.mode).toBe("raw");
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("embeds the chunks of a long resume", async () => {
    const env = vectorEnv();
    const index = await buildResumeIndex(env, padded(LONG_RESUME));
    expect(index.mode).toBe("embedding");
    expect(index.vectors).toHaveLength(index.chunks.length);
  });

  it("falls back to keyword retrieval when embedding fails", async () => {
    const env = vectorEnv({ failEmbedding: true });
    const index = await buildResumeIndex(env, padded(LONG_RESUME));
    expect(index.mode).toBe("keyword");
    expect(index.vectors).toBeNull();
  });
});

describe("retrieveContext", () => {
  it("returns the passages matching the query and leaves the rest out", async () => {
    const env = vectorEnv();
    const index = await buildResumeIndex(env, padded(LONG_RESUME));
    const context = await retrieveContext(env, index, ["reduced latency checkout users optimization"], {
      perQuery: 1,
    });

    expect(context).toContain("latency");
    expect(context).not.toContain("raffle stall");
  });

  it("works the same way in keyword mode", async () => {
    const env = vectorEnv({ failEmbedding: true });
    const index = await buildResumeIndex(env, padded(LONG_RESUME));
    const context = await retrieveContext(env, index, ["latency"], { perQuery: 1 });

    expect(context).toContain("Reduced latency by 40%");
  });

  it("returns the whole resume when nothing matches", async () => {
    const env = vectorEnv({ failEmbedding: true });
    const index = await buildResumeIndex(env, padded(LONG_RESUME));
    const context = await retrieveContext(env, index, ["zzzzz"], { perQuery: 1 });

    expect(context).toContain("VOLUNTEERING");
  });

  it("passes a raw index straight through", async () => {
    const env = vectorEnv();
    const index = await buildResumeIndex(env, "Android dev, 3 years, Kotlin.");
    const context = await retrieveContext(env, index, ["kotlin"]);

    expect(context).toBe("Android dev, 3 years, Kotlin.");
  });
});

describe("extractQuantifiedLines", () => {
  it("picks up percentages, scale and team size", () => {
    const lines = extractQuantifiedLines(LONG_RESUME);
    expect(lines.some((l) => l.includes("40%"))).toBe(true);
    expect(lines.some((l) => l.includes("2M+ users"))).toBe(true);
    expect(lines.some((l) => l.includes("gardening"))).toBe(false);
  });

  it("returns nothing when the resume has no numbers", () => {
    expect(extractQuantifiedLines("Worked on things. Helped the team improve.")).toEqual([]);
  });
});

describe("extractMetric", () => {
  it("pulls the number out of a sentence", () => {
    expect(extractMetric("Reduced latency by 40% through API optimization")).toBe("40%");
    expect(extractMetric("Served 2M+ users")).toBe("2M");
    expect(extractMetric("Refactored the payment module")).toBe("");
  });
});
