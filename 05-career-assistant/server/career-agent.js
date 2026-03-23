import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";

const CareerState = Annotation.Root({
  resume: Annotation({ reducer: (_, v) => v }),
  targetMarket: Annotation({ reducer: (_, v) => v }),
  targetRole: Annotation({ reducer: (_, v) => v }),
  resumeAnalysis: Annotation({ reducer: (_, v) => v }),
  marketResearch: Annotation({ reducer: (_, v) => v }),
  gapAnalysis: Annotation({ reducer: (_, v) => v }),
});

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
  const { resume, targetRole } = state;
  onDetail("Parsing resume content...");
  const model = new ChatAnthropic({ model: "claude-sonnet-4-20250514", temperature: 0 });

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
  const response = await model.invoke(prompt);
  const resumeAnalysis = typeof response.content === "string" ? response.content : response.content[0]?.text || "";
  console.log(`[career] Resume analysis obtained (${resumeAnalysis.length} chars)`);

  return { resumeAnalysis };
}

async function marketResearcherNode(state, onDetail) {
  const { targetMarket, targetRole } = state;
  const serpApiKey = process.env.SERPAPI_API_KEY;

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

  const model = new ChatAnthropic({ model: "claude-sonnet-4-20250514", temperature: 0 });

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
  const response = await model.invoke(prompt);
  const marketResearch = typeof response.content === "string" ? response.content : response.content[0]?.text || "";
  console.log(`[career] Market research obtained (${marketResearch.length} chars)`);

  return { marketResearch };
}

async function gapAnalystNode(state, onDetail) {
  const { targetRole, targetMarket, resumeAnalysis, marketResearch } = state;
  onDetail("Comparing resume with market...");
  const model = new ChatAnthropic({ model: "claude-sonnet-4-20250514", temperature: 0.3 });

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
  const response = await model.invoke(prompt);
  const gapAnalysis = typeof response.content === "string" ? response.content : response.content[0]?.text || "";
  console.log(`[career] Gap analysis generated (${gapAnalysis.length} chars)`);

  return { gapAnalysis };
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

export async function runCareerAssistant({ resume, targetMarket, targetRole, onProgress }) {
  console.log(`[career] Starting career assistant for: ${targetRole} in ${targetMarket}`);

  const graph = buildGraph(onProgress);

  const finalState = await graph.invoke({
    resume,
    targetMarket,
    targetRole,
    resumeAnalysis: "",
    marketResearch: "",
    gapAnalysis: "",
  });

  return {
    resumeAnalysis: finalState.resumeAnalysis,
    marketResearch: finalState.marketResearch,
    gapAnalysis: finalState.gapAnalysis,
  };
}
