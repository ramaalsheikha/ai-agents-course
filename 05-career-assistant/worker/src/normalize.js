import { extractMetric, extractQuantifiedLines, tokenize } from "./resume-rag.js";

const LEVELS = ["junior", "mid", "senior"];
const SEVERITIES = ["high", "medium", "low"];
const RESOURCE_TYPES = ["course", "cert", "project"];
const TIMEFRAMES = ["now", "3-6 months", "6-12 months"];

export function parseModelJson(text) {
  if (!text) return null;
  if (typeof text === "object") return text;

  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const attempts = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) attempts.push(cleaned.slice(first, last + 1));

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

function cleanString(value, fallback = "") {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function cleanStringArray(value, { max = 8, fallback = [] } = {}) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];

  for (const item of source) {
    const text = cleanString(typeof item === "object" && item ? item.name || item.skill || item.text : item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }

  if (out.length === 0) {
    for (const item of fallback) {
      const text = cleanString(item);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= max) break;
    }
  }

  return out;
}

function oneOf(value, allowed, fallback) {
  const text = cleanString(value).toLowerCase();
  return allowed.includes(text) ? text : fallback;
}

function clampNumber(value, min, max, fallback) {
  const num = typeof value === "string" ? Number(value.replace(/[^0-9.\-]/g, "")) : value;
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function levelFromYears(years) {
  if (years >= 8) return "senior";
  if (years >= 3) return "mid";
  return "junior";
}

export function normalizeAchievements(value, { resume = "", max = 6 } = {}) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];

  for (const item of source) {
    const text = cleanString(typeof item === "object" && item ? item.text || item.achievement : item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const metric = cleanString(typeof item === "object" && item ? item.metric : "") || extractMetric(text);
    out.push({ text, metric });
    if (out.length >= max) break;
  }

  if (out.length === 0) {
    for (const line of extractQuantifiedLines(resume, max)) {
      out.push({ text: line, metric: extractMetric(line) });
    }
  }

  return out.filter((a) => a.text);
}

export function normalizeResumeAnalysis(raw, { resume = "", targetRole = "" } = {}) {
  const data = parseModelJson(raw) || {};

  const yearsExperience = clampNumber(data.yearsExperience, 0, 60, 0);
  const skills = cleanStringArray(data.skills, { max: 12 });
  const strengths = cleanStringArray(data.strengths, {
    max: 6,
    fallback: skills.slice(0, 3).map((s) => `Hands-on experience with ${s}`),
  });
  const achievements = normalizeAchievements(data.achievements, { resume });
  const domain = cleanString(data.domain, "general software");
  const level = oneOf(data.level, LEVELS, levelFromYears(yearsExperience));

  const summary =
    cleanString(data.summary) ||
    [
      `${level.charAt(0).toUpperCase()}${level.slice(1)}-level candidate`,
      yearsExperience ? `with ${yearsExperience} years in ${domain}` : `in ${domain}`,
      skills.length ? `working mainly with ${skills.slice(0, 4).join(", ")}.` : ".",
      targetRole ? `Evaluated against a ${targetRole} target.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  return {
    level,
    yearsExperience,
    domain,
    summary,
    skills,
    strengths,
    achievements,
    gaps: cleanStringArray(data.gaps, { max: 6 }),
  };
}

export function normalizeMarketResearch(
  raw,
  { observedCompanies = [], resumeSkills = [], postingsAnalyzed = 0 } = {},
) {
  const data = parseModelJson(raw) || {};

  const observed = cleanStringArray(observedCompanies, { max: 12 });
  const observedKeys = new Set(observed.map((c) => c.toLowerCase()));
  const claimed = cleanStringArray(data.topCompanies, { max: 12 });

  const grounded = claimed.filter((c) => observedKeys.has(c.toLowerCase()));
  for (const company of observed) {
    if (grounded.length >= 6) break;
    if (!grounded.some((c) => c.toLowerCase() === company.toLowerCase())) grounded.push(company);
  }

  return {
    topSkills: cleanStringArray(data.topSkills, { max: 8, fallback: resumeSkills.slice(0, 5) }),
    experienceRange: cleanString(data.experienceRange, "Not stated in the sampled postings"),
    salaryRange: cleanString(data.salaryRange, "Not stated in the sampled postings"),
    topCompanies: grounded,
    keyTrends: cleanStringArray(data.keyTrends, { max: 6 }),
    postingsAnalyzed: clampNumber(postingsAnalyzed, 0, 500, 0),
  };
}

function deriveSkillGaps(resumeAnalysis, marketResearch) {
  const have = new Set(resumeAnalysis.skills.flatMap((s) => tokenize(s)));
  return marketResearch.topSkills
    .filter((skill) => !tokenize(skill).some((t) => have.has(t)))
    .slice(0, 6)
    .map((skill) => ({
      skill,
      severity: "medium",
      note: `Required across the sampled ${marketResearch.postingsAnalyzed || 0} postings but absent from the resume.`,
    }));
}

function normalizeSkillGaps(value, resumeAnalysis, marketResearch) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];

  for (const item of source) {
    const skill = cleanString(typeof item === "object" && item ? item.skill : item);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      skill,
      severity: oneOf(item?.severity, SEVERITIES, "medium"),
      note: cleanString(item?.note, `Named in the market data, not evidenced in the resume.`),
    });
    if (out.length >= 6) break;
  }

  return out.length ? out : deriveSkillGaps(resumeAnalysis, marketResearch);
}

function normalizeActions(value, skillGaps) {
  const source = Array.isArray(value) ? value : [];
  const byTimeframe = new Map();

  for (const group of source) {
    const timeframe = cleanString(group?.timeframe).toLowerCase();
    if (!timeframe) continue;
    const items = cleanStringArray(group?.items, { max: 4 });
    if (!items.length) continue;
    const bucket = TIMEFRAMES.find((t) => timeframe.includes(t.split("-")[0])) || timeframe;
    const existing = byTimeframe.get(bucket) || [];
    byTimeframe.set(bucket, [...existing, ...items].slice(0, 4));
  }

  const gapNames = skillGaps.map((g) => g.skill);
  const defaults = gapNames.length
    ? {
        now: gapNames.slice(0, 2).map((skill) => `Start a focused study block on ${skill}`),
        "3-6 months": gapNames.slice(0, 2).map((skill) => `Ship something non-trivial that uses ${skill}`),
        "6-12 months": gapNames.slice(0, 1).map((skill) => `Take ownership of ${skill} work in a real team setting`),
      }
    : {
        now: ["No blocking skill gap was found — start applying and tune the resume per posting"],
        "3-6 months": ["Deepen one of your existing strengths until it is interview-proof"],
        "6-12 months": ["Move toward scope: lead a project end to end and write up the outcome"],
      };

  return TIMEFRAMES.map((timeframe) => ({
    timeframe,
    items: byTimeframe.get(timeframe)?.length ? byTimeframe.get(timeframe) : defaults[timeframe],
  })).filter((group) => group.items.length > 0);
}

function normalizeResources(value, skillGaps) {
  const gapNames = skillGaps.map((g) => g.skill);
  const gapTokens = new Map(gapNames.map((skill) => [skill, new Set(tokenize(skill))]));

  const matchGap = (text) => {
    const terms = tokenize(text);
    let best = "";
    let bestScore = 0;
    for (const [skill, tokens] of gapTokens) {
      const score = terms.reduce((acc, t) => (tokens.has(t) ? acc + 1 : acc), 0);
      if (score > bestScore) {
        bestScore = score;
        best = skill;
      }
    }
    return best;
  };

  const source = Array.isArray(value) ? value : [];
  const out = [];
  const covered = new Set();

  for (const item of source) {
    const name = cleanString(typeof item === "object" && item ? item.name : item);
    if (!name) continue;
    const declared = cleanString(item?.skill);
    const skill = gapNames.includes(declared) ? declared : matchGap(`${name} ${declared}`);
    if (!skill) continue;
    out.push({ type: oneOf(item?.type, RESOURCE_TYPES, "course"), name, skill });
    covered.add(skill);
    if (out.length >= 6) break;
  }

  for (const skill of gapNames) {
    if (out.length >= 6) break;
    if (covered.has(skill)) continue;
    out.push({ type: "project", name: `Build and publish a project that exercises ${skill}`, skill });
    covered.add(skill);
  }

  if (out.length === 0) {
    return [
      {
        type: "project",
        name: "No gap-linked resource needed — build a portfolio piece in your strongest area",
        skill: "",
      },
    ];
  }

  return out;
}

function normalizeResumeTips(value, resumeAnalysis) {
  const fallback = [];
  if (!resumeAnalysis.achievements.length) {
    fallback.push("Add numbers to your bullets — impact, scale, latency, revenue, users.");
  } else {
    fallback.push(`Lead with your strongest measured result: "${resumeAnalysis.achievements[0].text}".`);
  }
  fallback.push(`Put ${resumeAnalysis.domain} keywords in the top third of page one.`);
  fallback.push("Cut responsibilities-only bullets that carry no outcome.");

  return cleanStringArray(value, { max: 4, fallback });
}

function deriveReadiness(resumeAnalysis, marketResearch) {
  const required = marketResearch.topSkills;
  if (!required.length || !marketResearch.postingsAnalyzed) return 50;
  const have = new Set(resumeAnalysis.skills.flatMap((s) => tokenize(s)));
  const matched = required.filter((skill) => tokenize(skill).some((t) => have.has(t))).length;
  return clampNumber((matched / required.length) * 100, 0, 100, 50);
}

export function normalizeGapAnalysis(raw, { resumeAnalysis, marketResearch }) {
  const data = parseModelJson(raw) || {};

  const skillGaps = normalizeSkillGaps(data.skillGaps, resumeAnalysis, marketResearch);
  const readinessScore = clampNumber(
    data.readinessScore,
    0,
    100,
    deriveReadiness(resumeAnalysis, marketResearch),
  );

  return {
    readinessScore,
    readinessLabel: cleanString(
      data.readinessLabel,
      `Scored ${readinessScore}% against the ${marketResearch.topSkills.length} skill${
        marketResearch.topSkills.length === 1 ? "" : "s"
      } most repeated across the sampled postings.`,
    ),
    skillGaps,
    actions: normalizeActions(data.actions, skillGaps),
    resources: normalizeResources(data.resources, skillGaps),
    resumeTips: normalizeResumeTips(data.resumeTips, resumeAnalysis),
  };
}
