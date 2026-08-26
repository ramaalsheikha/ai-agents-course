import { describe, expect, it } from "vitest";
import {
  normalizeGapAnalysis,
  normalizeMarketResearch,
  normalizeResumeAnalysis,
  parseModelJson,
} from "./normalize.js";

const RESUME_TEXT =
  "Senior Software Engineer, 7 years full-stack. Led a team of 6 engineers on a microservices e-commerce platform serving 2M+ users. Reduced latency by 40% through API optimization.";

describe("parseModelJson", () => {
  it("reads bare, fenced and prose-wrapped JSON", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
    expect(parseModelJson("no json here")).toBeNull();
    expect(parseModelJson("")).toBeNull();
  });
});

describe("normalizeResumeAnalysis", () => {
  it("fills every field when the model returns nothing usable", () => {
    const result = normalizeResumeAnalysis(null, { resume: RESUME_TEXT, targetRole: "Staff Engineer" });

    expect(result.level).toBe("junior");
    expect(result.domain).toBe("general software");
    expect(result.summary).not.toBe("");
    expect(Array.isArray(result.skills)).toBe(true);
  });

  it("recovers quantified achievements from the resume text", () => {
    const result = normalizeResumeAnalysis({ achievements: [] }, { resume: RESUME_TEXT });

    expect(result.achievements.some((a) => a.metric === "40%")).toBe(true);
    expect(result.achievements.some((a) => a.text.includes("2M+ users"))).toBe(true);
  });

  it("keeps the model's achievements and backfills a missing metric", () => {
    const result = normalizeResumeAnalysis(
      { achievements: [{ text: "Cut build time by 12 minutes" }] },
      { resume: RESUME_TEXT },
    );

    expect(result.achievements[0]).toEqual({
      text: "Cut build time by 12 minutes",
      metric: "12 minutes",
    });
  });

  it("coerces a dirty level, years and skill list", () => {
    const result = normalizeResumeAnalysis(
      { level: "Principal", yearsExperience: "about 9 years", skills: ["Kotlin", "kotlin", "  ", 42] },
      { resume: RESUME_TEXT },
    );

    expect(result.level).toBe("senior");
    expect(result.yearsExperience).toBe(9);
    expect(result.skills).toEqual(["Kotlin", "42"]);
  });
});

describe("normalizeMarketResearch", () => {
  it("drops companies that were not in the postings and backfills from the real ones", () => {
    const result = normalizeMarketResearch(
      { topCompanies: ["Genentech", "Shopfront"], topSkills: ["Python"] },
      { observedCompanies: ["Shopfront", "Noon"], postingsAnalyzed: 2 },
    );

    expect(result.topCompanies).toEqual(["Shopfront", "Noon"]);
  });

  it("labels missing salary and experience instead of leaving them blank", () => {
    const result = normalizeMarketResearch({}, { observedCompanies: [], resumeSkills: ["React"] });

    expect(result.salaryRange).toContain("Not stated");
    expect(result.experienceRange).toContain("Not stated");
    expect(result.topSkills).toEqual(["React"]);
    expect(result.postingsAnalyzed).toBe(0);
  });
});

describe("normalizeGapAnalysis", () => {
  const resumeAnalysis = normalizeResumeAnalysis(
    { skills: ["Python", "React", "AWS"], domain: "e-commerce", level: "senior", yearsExperience: 7 },
    { resume: RESUME_TEXT },
  );
  const marketResearch = normalizeMarketResearch(
    { topSkills: ["Python", "Kubernetes", "AI"], topCompanies: ["Shopfront"] },
    { observedCompanies: ["Shopfront"], postingsAnalyzed: 6 },
  );

  it("derives gaps from the market data when the model returns none", () => {
    const result = normalizeGapAnalysis({}, { resumeAnalysis, marketResearch });

    expect(result.skillGaps.map((g) => g.skill)).toEqual(["Kubernetes", "AI"]);
    expect(result.readinessScore).toBe(33);
  });

  it("links every resource to a listed gap and covers the uncovered ones", () => {
    const result = normalizeGapAnalysis(
      {
        skillGaps: [{ skill: "AI", severity: "critical", note: "" }],
        resources: [
          { type: "cert", name: "Certified Scrum Master" },
          { type: "course", name: "Applied AI for engineers" },
        ],
      },
      { resumeAnalysis, marketResearch },
    );

    expect(result.skillGaps[0].severity).toBe("medium");
    expect(result.resources).toEqual([
      { type: "course", name: "Applied AI for engineers", skill: "AI" },
    ]);
  });

  it("fills all three timeframes even when the model returns one", () => {
    const result = normalizeGapAnalysis(
      { actions: [{ timeframe: "NOW", items: ["Read the docs", "  "] }] },
      { resumeAnalysis, marketResearch },
    );

    expect(result.actions.map((a) => a.timeframe)).toEqual(["now", "3-6 months", "6-12 months"]);
    expect(result.actions.every((a) => a.items.length > 0)).toBe(true);
    expect(result.actions[0].items).toEqual(["Read the docs"]);
  });

  it("clamps a nonsense readiness score", () => {
    expect(normalizeGapAnalysis({ readinessScore: 240 }, { resumeAnalysis, marketResearch }).readinessScore).toBe(100);
    expect(normalizeGapAnalysis({ readinessScore: -5 }, { resumeAnalysis, marketResearch }).readinessScore).toBe(0);
  });

  it("leads the resume tips with the strongest measured result", () => {
    const result = normalizeGapAnalysis({ resumeTips: [] }, { resumeAnalysis, marketResearch });

    expect(result.resumeTips[0]).toContain("40%");
  });
});
