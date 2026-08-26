import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const CareerState = Annotation.Root({
  resume: Annotation({ reducer: (_, v) => v }),
  targetMarket: Annotation({ reducer: (_, v) => v }),
  targetRole: Annotation({ reducer: (_, v) => v }),
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
    skills: STRING_ARRAY,
    strengths: STRING_ARRAY,
    gaps: STRING_ARRAY,
  },
  required: ["level", "yearsExperience", "domain", "skills", "strengths", "gaps"],
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
        },
        required: ["type", "name"],
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
  onDetail("Parsing resume content...");

  const prompt = `You are an expert resume analyst. Analyze this resume for a "${targetRole}" role.

Resume:
${resume}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "level": "junior|mid|senior",
  "yearsExperience": number,
  "domain": "primary industry",
  "skills": ["skill1", "skill2", ...],
  "strengths": ["strength1", "strength2", "strength3"],
  "gaps": ["gap1", "gap2", "gap3"]
}

Keep each array to 5-8 items max. Be specific.`;

  onDetail("Analyzing skills and experience...");
  const resumeAnalysis = await invokeModel(env, prompt, 0, RESUME_SCHEMA);
  console.log(`[career] Resume analysis obtained (${resumeAnalysis.length} chars)`);

  return { resumeAnalysis };
}

async function marketResearcherNode(state, onDetail) {
  const { targetMarket, targetRole, env } = state;
  const serpApiKey = env.SERPAPI_API_KEY;

  if (!serpApiKey) {
    throw new Error("SERPAPI_API_KEY is not set in environment variables");
  }

  const query = `${targetRole} in ${targetMarket}`;
  const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&api_key=${serpApiKey}`;

  onDetail(`Searching jobs in ${targetMarket}...`);
  console.log(`[career] Fetching jobs: ${targetRole} in ${targetMarket}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpAPI request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const jobs = data.google_jobs_results || data.jobs_results || [];
  console.log(`[career] Found ${jobs.length} job postings`);
  onDetail(`Found ${jobs.length} jobs, analyzing...`);

  const jobSummaries = jobs.slice(0, 8).map((job, i) => {
    const extensions = (job.extensions || []).join(", ");
    return `Job ${i + 1}: ${job.title} at ${job.company_name} (${job.location}) - ${extensions}\nDescription: ${(job.description || "").slice(0, 400)}`;
  }).join("\n\n");

  const prompt = `You are a job market analyst. Based on these real job postings for "${targetRole}" in ${targetMarket}, extract market insights.

Job Postings:
${jobSummaries}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "topSkills": ["skill1", "skill2", ...],
  "experienceRange": "e.g. 3-7 years",
  "salaryRange": "e.g. $80K-$120K or N/A if unknown",
  "topCompanies": ["company1", "company2", ...],
  "keyTrends": ["trend1", "trend2", "trend3"]
}

Keep arrays to 5-8 items max. topSkills should be the most frequently mentioned technical skills across all postings.`;

  onDetail("Extracting market insights...");
  const marketResearch = await invokeModel(env, prompt, 0, MARKET_SCHEMA);
  console.log(`[career] Market research obtained (${marketResearch.length} chars)`);

  return { marketResearch };
}

async function gapAnalystNode(state, onDetail) {
  const { targetRole, targetMarket, resumeAnalysis, marketResearch, env } = state;
  onDetail("Comparing resume with market...");

  const prompt = `You are a career advisor. Compare this candidate's profile with market requirements and provide a concise gap analysis.

Target: ${targetRole} in ${targetMarket}

Candidate Profile:
${resumeAnalysis}

Market Requirements:
${marketResearch}

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
    { "type": "course", "name": "course name" },
    { "type": "cert", "name": "certification name" },
    { "type": "project", "name": "project idea" }
  ],
  "resumeTips": ["tip1", "tip2", "tip3"]
}

Keep it concise. Max 6 skill gaps, 3 items per timeframe, 4 resources, 3 resume tips.`;

  onDetail("Generating recommendations...");
  const gapAnalysis = await invokeModel(env, prompt, 0.3, GAP_SCHEMA);
  console.log(`[career] Gap analysis generated (${gapAnalysis.length} chars)`);

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
    .addEdge(START, "marketResearcher")
    .addEdge("resumeAnalyzer", "gapAnalyst")
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
      resumeAnalysis: "",
      marketResearch: "",
      gapAnalysis: "",
    });
  } catch (err) {
    throw flattenGraphError(err);
  }

  return {
    resumeAnalysis: finalState.resumeAnalysis,
    marketResearch: finalState.marketResearch,
    gapAnalysis: finalState.gapAnalysis,
  };
}
