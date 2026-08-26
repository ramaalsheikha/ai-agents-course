import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { buildResumeIndex, retrieveContext, tokenize } from "./resume-rag.js";
import {
  normalizeGapAnalysis,
  normalizeMarketResearch,
  normalizeResumeAnalysis,
  parseModelJson,
} from "./normalize.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_JOBS_ANALYZED = 8;

const CareerState = Annotation.Root({
  resume: Annotation({ reducer: (_, v) => v }),
  targetMarket: Annotation({ reducer: (_, v) => v }),
  targetRole: Annotation({ reducer: (_, v) => v }),
  resumeIndex: Annotation({ reducer: (_, v) => v }),
  resumeAnalysis: Annotation({ reducer: (_, v) => v }),
  marketResearch: Annotation({ reducer: (_, v) => v }),
  gapAnalysis: Annotation({ reducer: (_, v) => v }),
  env: Annotation({ reducer: (_, v) => v }),
});

const STRING_ARRAY = { type: "array", items: { type: "string" } };

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    level: { type: "string" },
    yearsExperience: { type: "number" },
    domain: { type: "string" },
    summary: { type: "string" },
    skills: STRING_ARRAY,
    strengths: STRING_ARRAY,
    achievements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          metric: { type: "string" },
        },
        required: ["text", "metric"],
      },
    },
    gaps: STRING_ARRAY,
  },
  required: [
    "level",
    "yearsExperience",
    "domain",
    "summary",
    "skills",
    "strengths",
    "achievements",
    "gaps",
  ],
};

const MARKET_SCHEMA = {
  type: "object",
  properties: {
    topSkills: STRING_ARRAY,
    experienceRange: { type: "string" },
    salaryRange: { type: "string" },
    topCompanies: STRING_ARRAY,
    keyTrends: STRING_ARRAY,
  },
  required: ["topSkills", "experienceRange", "salaryRange", "topCompanies", "keyTrends"],
};

const GAP_SCHEMA = {
  type: "object",
  properties: {
    readinessScore: { type: "number" },
    readinessLabel: { type: "string" },
    skillGaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          severity: { type: "string" },
          note: { type: "string" },
        },
        required: ["skill", "severity", "note"],
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timeframe: { type: "string" },
          items: STRING_ARRAY,
        },
        required: ["timeframe", "items"],
      },
    },
    resources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          name: { type: "string" },
          skill: { type: "string" },
        },
        required: ["type", "name", "skill"],
      },
    },
    resumeTips: STRING_ARRAY,
  },
  required: [
    "readinessScore",
    "readinessLabel",
    "skillGaps",
    "actions",
    "resources",
    "resumeTips",
  ],
};

async function invokeModel(env, prompt, temperature, schema) {
  const model = env.AI_MODEL || DEFAULT_MODEL;
  const runModel = (extra) =>
    env.AI.run(model, {
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: 2048,
      ...extra,
    });

  let response;

  try {
    response = await runModel({ response_format: { type: "json_schema", json_schema: schema } });
  } catch (error) {
    console.error(`[career] Structured output rejected, retrying unconstrained: ${error.message}`);
    response = await runModel({});
  }

  const payload = typeof response === "string" ? response : response?.response ?? "";
  if (payload && typeof payload === "object") return JSON.stringify(payload);

  return String(payload).replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

async function invokeJson(env, { prompt, temperature, schema, label }) {
  const raw = await invokeModel(env, prompt, temperature, schema);
  const parsed = parseModelJson(raw);
  if (parsed) return parsed;

  console.error(`[career] ${label} returned unparseable JSON, retrying once`);
  const retryPrompt = `${prompt}\n\nYour previous reply was not valid JSON. Reply with the JSON object only.`;
  const retry = await invokeModel(env, retryPrompt, temperature, schema);
  const retryParsed = parseModelJson(retry);

  if (!retryParsed) {
    console.error(`[career] ${label} still unparseable after retry, falling back to derived values`);
  }
  return retryParsed;
}

function wrapWithProgress(name, nodeFn, onProgress) {
  return async (state) => {
    onProgress({ agent: name, status: "start", detail: "" });
    const result = await nodeFn(state, (detail) => {
      onProgress({ agent: name, status: "working", detail });
    });
    onProgress({ agent: name, status: "done", detail: "" });
    return result;
  };
}

async function resumeAnalyzerNode(state, onDetail) {
  const { resume, targetRole, env } = state;

  onDetail("Indexing resume...");
  const resumeIndex = await buildResumeIndex(env, resume);
  console.log(`[career] Resume indexed: ${resumeIndex.chunks.length} chunks, ${resumeIndex.mode} retrieval`);

  onDetail("Retrieving the passages that matter...");
  const context = await retrieveContext(
    env,
    resumeIndex,
    [
      `${targetRole} responsibilities, seniority and scope of ownership`,
      "technical skills, languages, frameworks, cloud and tooling",
      "quantified impact: percentages, latency, revenue, scale, users, team size",
      "industry, product domain and type of company worked for",
      "education, certifications and credentials",
    ],
    { perQuery: 2, maxChars: 6000 },
  );

  const prompt = `You are an expert resume analyst. Analyze the resume excerpts below for a "${targetRole}" role.

The excerpts are the passages retrieved from this candidate's resume. Use ONLY what they say. Never infer an industry, employer, technology or credential that does not appear in the text.

Resume excerpts:
${context}

Write "summary" as 2-3 sentences of prose: seniority, the domain they actually work in, what they own, and the scale they operate at. No keyword lists.

For "achievements", extract every statement carrying a number — percentage, latency, revenue, users, team size, throughput. Copy the wording from the resume and put the number itself in "metric". If the resume contains no quantified statement, return an empty array. Never invent one.

"domain" must be the industry the resume itself evidences (for example "e-commerce", "fintech", "healthcare"), not the industry the target role is usually found in.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "level": "junior|mid|senior",
  "yearsExperience": number,
  "domain": "primary industry evidenced by the resume",
  "summary": "2-3 sentence narrative summary",
  "skills": ["skill1", "skill2", ...],
  "strengths": ["strength1", "strength2", "strength3"],
  "achievements": [{ "text": "quantified achievement as written", "metric": "40%" }],
  "gaps": ["gap1", "gap2", "gap3"]
}

Keep each array to 5-8 items max. Be specific.`;

  onDetail("Summarizing experience and impact...");
  const raw = await invokeJson(env, {
    prompt,
    temperature: 0,
    schema: RESUME_SCHEMA,
    label: "Resume analyzer",
  });

  const resumeAnalysis = normalizeResumeAnalysis(raw, { resume, targetRole });
  console.log(
    `[career] Resume analysis: ${resumeAnalysis.domain}, ${resumeAnalysis.skills.length} skills, ${resumeAnalysis.achievements.length} quantified achievements`,
  );

  return { resumeAnalysis, resumeIndex };
}

export function buildJobQuery({ targetRole, targetMarket, domain }) {
  const roleTerms = new Set(tokenize(targetRole));
  const domainTerms = tokenize(domain).filter((t) => !roleTerms.has(t));
  const qualifier = domainTerms.length ? ` ${domainTerms.slice(0, 2).join(" ")}` : "";
  return `${targetRole}${qualifier} in ${targetMarket}`;
}

export function filterJobsByDomain(jobs, { targetRole, domain, skills = [] }) {
  const roleTerms = tokenize(targetRole);
  const domainTerms = tokenize(domain);
  const skillTerms = [...new Set(skills.flatMap((s) => tokenize(s)))].slice(0, 15);

  const scored = jobs.map((job) => {
    const haystack = [job.title, job.company_name, job.location, job.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const hits = (terms) => terms.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0);
    const score = hits(roleTerms) * 3 + hits(domainTerms) * 2 + hits(skillTerms);

    return { job, score };
  });

  const relevant = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_JOBS_ANALYZED);

  if (relevant.length) {
    return { jobs: relevant.map((entry) => entry.job), relaxed: false };
  }

  return { jobs: jobs.slice(0, MAX_JOBS_ANALYZED), relaxed: true };
}

async function searchJobs(query, serpApiKey) {
  const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&api_key=${serpApiKey}`;

  console.log(`[career] Fetching jobs: ${query}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpAPI request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) {
    console.log(`[career] SerpAPI returned no results for "${query}": ${data.error}`);
  }
  return data.google_jobs_results || data.jobs_results || [];
}

async function marketResearcherNode(state, onDetail) {
  const { targetMarket, targetRole, resumeAnalysis, env } = state;
  const serpApiKey = env.SERPAPI_API_KEY;

  if (!serpApiKey) {
    throw new Error("SERPAPI_API_KEY is not set in environment variables");
  }

  const domain = resumeAnalysis?.domain || "";
  const resumeSkills = resumeAnalysis?.skills || [];
  const query = buildJobQuery({ targetRole, targetMarket, domain });
  const broadQuery = buildJobQuery({ targetRole, targetMarket, domain: "" });

  onDetail(`Searching ${domain || targetRole} jobs in ${targetMarket}...`);

  let allJobs = await searchJobs(query, serpApiKey);

  if (!allJobs.length && broadQuery !== query) {
    onDetail(`No ${domain} postings; widening to all ${targetRole} roles...`);
    allJobs = await searchJobs(broadQuery, serpApiKey);
  }

  const { jobs, relaxed } = filterJobsByDomain(allJobs, {
    targetRole,
    domain,
    skills: resumeSkills,
  });

  if (relaxed && allJobs.length) {
    console.log(`[career] No posting matched the ${domain || targetRole} filter; using the unfiltered top ${jobs.length}`);
  }
  console.log(`[career] ${allJobs.length} postings fetched, ${jobs.length} kept after domain filtering`);
  onDetail(`Kept ${jobs.length} of ${allJobs.length} postings, analyzing...`);

  const observedCompanies = jobs.map((job) => job.company_name).filter(Boolean);

  const jobSummaries = jobs.map((job, i) => {
    const extensions = (job.extensions || []).join(", ");
    return `Job ${i + 1}: ${job.title} at ${job.company_name} (${job.location}) - ${extensions}\nDescription: ${(job.description || "").slice(0, 400)}`;
  }).join("\n\n");

  const prompt = `You are a job market analyst. Extract market insights for "${targetRole}" in ${targetMarket} from the real job postings below.

Candidate context (use it to judge which requirements are relevant, never to invent data):
- Domain: ${domain || "unspecified"}
- Known skills: ${resumeSkills.join(", ") || "unspecified"}

Job Postings (${jobs.length} of ${allJobs.length} fetched, filtered for relevance to this candidate):
${jobSummaries || "No postings were returned for this search."}

Hard rules:
- "topCompanies" may only contain company names that appear verbatim in the postings above. Do not add well-known employers from memory.
- "topSkills" must be skills actually named in the postings, ordered by how often they appear.
- If the postings do not state a salary or an experience range, return "N/A" rather than guessing.
- Do not introduce an industry that none of the postings mention.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "topSkills": ["skill1", "skill2", ...],
  "experienceRange": "e.g. 3-7 years",
  "salaryRange": "e.g. $80K-$120K or N/A if unknown",
  "topCompanies": ["company1", "company2", ...],
  "keyTrends": ["trend1", "trend2", "trend3"]
}

Keep arrays to 5-8 items max.`;

  onDetail("Extracting market insights...");
  const raw = await invokeJson(env, {
    prompt,
    temperature: 0,
    schema: MARKET_SCHEMA,
    label: "Market researcher",
  });

  const marketResearch = normalizeMarketResearch(raw, {
    observedCompanies,
    resumeSkills,
    postingsAnalyzed: jobs.length,
  });
  console.log(
    `[career] Market research: ${marketResearch.topSkills.length} skills, ${marketResearch.topCompanies.length} grounded companies`,
  );

  return { marketResearch };
}

async function gapAnalystNode(state, onDetail) {
  const { targetRole, targetMarket, resumeAnalysis, marketResearch, resumeIndex, env } = state;
  onDetail("Checking each market skill against the resume...");

  const evidence = marketResearch.topSkills.length
    ? await retrieveContext(
        env,
        resumeIndex,
        marketResearch.topSkills.map((skill) => `${skill} experience`),
        { perQuery: 1, maxChars: 3000 },
      )
    : "";

  const prompt = `You are a career advisor. Compare this candidate with the market data and produce a gap analysis.

Target: ${targetRole} in ${targetMarket}

Candidate profile (structured output of the resume analyzer):
${JSON.stringify(resumeAnalysis, null, 2)}

Market requirements (structured output of the market researcher, derived from ${marketResearch.postingsAnalyzed} real postings):
${JSON.stringify(marketResearch, null, 2)}

Resume passages retrieved for the market's top skills:
${evidence || "No resume passage matched the market skills."}

Hard rules:
- Every entry in "skillGaps" must be a skill that appears in the market data above and is not evidenced in the candidate profile or the retrieved passages. Never invent an industry-flavoured gap that the market data does not contain.
- Every entry in "resources" must carry a "skill" field whose value is exactly one of the skills you listed in "skillGaps". Cover the highest-severity gaps first. Do not recommend a resource that maps to no gap.
- Every action item must trace back to a listed gap or to a stated strength.
- "readinessScore" must reflect how many of the market's top skills the candidate already evidences.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "readinessScore": number between 0-100,
  "readinessLabel": "one sentence explaining the score",
  "skillGaps": [
    { "skill": "skill name", "severity": "high|medium|low", "note": "brief explanation" }
  ],
  "actions": [
    { "timeframe": "now", "items": ["action1", "action2", "action3"] },
    { "timeframe": "3-6 months", "items": ["action1", "action2", "action3"] },
    { "timeframe": "6-12 months", "items": ["action1", "action2"] }
  ],
  "resources": [
    { "type": "course|cert|project", "name": "resource name", "skill": "the gap it closes" }
  ],
  "resumeTips": ["tip1", "tip2", "tip3"]
}

Keep it concise. Max 6 skill gaps, 3 items per timeframe, 4 resources, 3 resume tips.`;

  onDetail("Generating recommendations...");
  const raw = await invokeJson(env, {
    prompt,
    temperature: 0.3,
    schema: GAP_SCHEMA,
    label: "Gap analyst",
  });

  const gapAnalysis = normalizeGapAnalysis(raw, { resumeAnalysis, marketResearch });
  console.log(
    `[career] Gap analysis: score ${gapAnalysis.readinessScore}, ${gapAnalysis.skillGaps.length} gaps, ${gapAnalysis.resources.length} linked resources`,
  );

  return { gapAnalysis };
}

function flattenGraphError(err) {
  const nested = Array.isArray(err?.errors) ? err.errors : [];
  if (nested.length === 0) return err;

  const message = nested.map((e) => e?.message || String(e)).join("; ");
  const flattened = new Error(message);
  flattened.cause = err;
  return flattened;
}

function buildGraph(onProgress) {
  const graph = new StateGraph(CareerState)
    .addNode("resumeAnalyzer", wrapWithProgress("resume", resumeAnalyzerNode, onProgress))
    .addNode("marketResearcher", wrapWithProgress("market", marketResearcherNode, onProgress))
    .addNode("gapAnalyst", wrapWithProgress("gap", gapAnalystNode, onProgress))
    .addEdge(START, "resumeAnalyzer")
    .addEdge("resumeAnalyzer", "marketResearcher")
    .addEdge("marketResearcher", "gapAnalyst")
    .addEdge("gapAnalyst", END);

  return graph.compile();
}

export async function runCareerAssistant({ resume, targetMarket, targetRole, env, onProgress }) {
  console.log(`[career] Starting career assistant for: ${targetRole} in ${targetMarket}`);

  const graph = buildGraph(onProgress);

  let finalState;
  try {
    finalState = await graph.invoke({
      resume,
      targetMarket,
      targetRole,
      env,
      resumeIndex: null,
      resumeAnalysis: null,
      marketResearch: null,
      gapAnalysis: null,
    });
  } catch (err) {
    throw flattenGraphError(err);
  }

  return {
    resumeAnalysis: JSON.stringify(finalState.resumeAnalysis),
    marketResearch: JSON.stringify(finalState.marketResearch),
    gapAnalysis: JSON.stringify(finalState.gapAnalysis),
  };
}
