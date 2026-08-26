import { afterEach, describe, expect, it, vi } from "vitest";
import { runCareerAssistant } from "./career-agent.js";

const RESUME_JSON = {
  level: "mid",
  yearsExperience: 4,
  domain: "mobile",
  skills: ["Kotlin", "Jetpack Compose"],
  strengths: ["ships production apps"],
  gaps: ["no team lead experience"],
};

const MARKET_JSON = {
  topSkills: ["Kotlin", "Coroutines"],
  experienceRange: "3-7 years",
  salaryRange: "€65K-€90K",
  topCompanies: ["Zalando"],
  keyTrends: ["Compose adoption"],
};

const GAP_JSON = {
  readinessScore: 72,
  readinessLabel: "Close, with gaps in system design.",
  skillGaps: [{ skill: "System design", severity: "medium", note: "asked for at senior level" }],
  actions: [{ timeframe: "now", items: ["Study Android architecture"] }],
  resources: [{ type: "course", name: "Android Architecture" }],
  resumeTips: ["Quantify app impact"],
};

const jobsResponse = {
  google_jobs_results: [
    {
      title: "Senior Android Engineer",
      company_name: "Zalando",
      location: "Berlin",
      extensions: ["Full-time"],
      description: "Kotlin, Compose, Coroutines.",
    },
  ],
};

function stubFetchOk() {
  return vi.fn(async () => new Response(JSON.stringify(jobsResponse), { status: 200 }));
}

function makeEnv({ replies, serpApiKey = "serp-test-key", model } = {}) {
  const calls = [];
  return {
    calls,
    env: {
      SERPAPI_API_KEY: serpApiKey,
      ...(model ? { AI_MODEL: model } : {}),
      AI: {
        run: vi.fn(async (modelId, options) => {
          calls.push({ modelId, options });
          return replies[calls.length - 1];
        }),
      },
    },
  };
}

const run = (env, onProgress = () => {}) =>
  runCareerAssistant({
    resume: "4 years Android. Kotlin, Compose.",
    targetMarket: "Germany",
    targetRole: "Senior Android Engineer",
    env,
    onProgress,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function laneOf(options) {
  const text = options.messages[0].content;
  if (text.includes("expert resume analyst")) return "resume";
  if (text.includes("job market analyst")) return "market";
  return "gap";
}

describe("runCareerAssistant", () => {
  it("constrains every node with the json_schema for its own payload", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, calls } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    await run(env);

    const schemaFor = (lane) =>
      calls.find((c) => laneOf(c.options) === lane).options.response_format;

    expect(schemaFor("resume").type).toBe("json_schema");
    expect(schemaFor("resume").json_schema.required).toContain("yearsExperience");
    expect(schemaFor("market").json_schema.required).toContain("topSkills");
    expect(schemaFor("gap").json_schema.required).toContain("readinessScore");
  });

  it("serializes a schema-enforced object response back to JSON text", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      replies: [
        { response: RESUME_JSON },
        { response: MARKET_JSON },
        { response: GAP_JSON },
      ],
    });

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis)).toEqual(RESUME_JSON);
    expect(JSON.parse(result.marketResearch)).toEqual(MARKET_JSON);
    expect(JSON.parse(result.gapAnalysis)).toEqual(GAP_JSON);
  });

  it("retries a node unconstrained when the model rejects its schema", async () => {
    vi.stubGlobal("fetch", stubFetchOk());

    const payloads = { resume: RESUME_JSON, market: MARKET_JSON, gap: GAP_JSON };
    const calls = [];
    const env = {
      SERPAPI_API_KEY: "serp-test-key",
      AI: {
        run: vi.fn(async (modelId, options) => {
          const lane = laneOf(options);
          calls.push({ lane, options });

          if (lane === "resume" && options.response_format) {
            throw new Error("json_schema not supported for this model");
          }

          return { response: JSON.stringify(payloads[lane]) };
        }),
      },
    };

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis)).toEqual(RESUME_JSON);

    const resumeCalls = calls.filter((c) => c.lane === "resume");
    expect(resumeCalls).toHaveLength(2);
    expect(resumeCalls[1].options.response_format).toBeUndefined();
    expect(calls.filter((c) => c.lane === "gap")).toHaveLength(1);
  });

  it("returns all three payloads parseable as JSON when the model fences them", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      replies: [
        { response: "```json\n" + JSON.stringify(RESUME_JSON) + "\n```" },
        { response: "```json\n" + JSON.stringify(MARKET_JSON) + "\n```" },
        { response: "```\n" + JSON.stringify(GAP_JSON) + "\n```" },
      ],
    });

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis)).toEqual(RESUME_JSON);
    expect(JSON.parse(result.marketResearch)).toEqual(MARKET_JSON);
    expect(JSON.parse(result.gapAnalysis)).toEqual(GAP_JSON);
  });

  it("passes bare JSON through untouched", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    const result = await run(env);

    expect(JSON.parse(result.gapAnalysis)).toEqual(GAP_JSON);
  });

  it("accepts a plain string response as well as { response }", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      replies: [
        JSON.stringify(RESUME_JSON),
        JSON.stringify(MARKET_JSON),
        JSON.stringify(GAP_JSON),
      ],
    });

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis)).toEqual(RESUME_JSON);
  });

  it("feeds both branch outputs into the gap analyst prompt", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, calls } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    await run(env);

    const gapPrompt = calls.at(-1).options.messages[0].content;
    expect(gapPrompt).toContain(JSON.stringify(RESUME_JSON));
    expect(gapPrompt).toContain(JSON.stringify(MARKET_JSON));
  });

  it("uses AI_MODEL when set and keeps the per-node temperatures", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, calls } = makeEnv({
      model: "@cf/meta/llama-4-scout-17b-16e-instruct",
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    await run(env);

    expect(calls.every((c) => c.modelId === "@cf/meta/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(calls.at(-1).options.temperature).toBe(0.3);
    expect(calls.slice(0, 2).every((c) => c.options.temperature === 0)).toBe(true);
  });

  it("falls back to the default model when AI_MODEL is unset", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, calls } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    await run(env);

    expect(calls[0].modelId).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("emits start and done for each of the three agents", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    const events = [];
    await run(env, (e) => events.push(e));

    for (const agent of ["resume", "market", "gap"]) {
      expect(events).toContainEqual({ agent, status: "start", detail: "" });
      expect(events).toContainEqual({ agent, status: "done", detail: "" });
    }
    expect(events.some((e) => e.agent === "market" && e.status === "working")).toBe(true);
  });

  it("queries SerpAPI with the role and market", async () => {
    const fetchMock = stubFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    await run(env);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("engine")).toBe("google_jobs");
    expect(url.searchParams.get("q")).toBe("Senior Android Engineer in Germany");
    expect(url.searchParams.get("api_key")).toBe("serp-test-key");
  });

  it("fails when SERPAPI_API_KEY is missing", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      serpApiKey: "",
      replies: [{ response: JSON.stringify(RESUME_JSON) }, { response: JSON.stringify(GAP_JSON) }],
    });

    await expect(run(env)).rejects.toThrow("SERPAPI_API_KEY is not set");
  });

  it("fails when SerpAPI returns a non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })),
    );
    const { env } = makeEnv({
      replies: [{ response: JSON.stringify(RESUME_JSON) }, { response: JSON.stringify(GAP_JSON) }],
    });

    await expect(run(env)).rejects.toThrow("SerpAPI request failed: 401");
  });

  it("surfaces a Workers AI quota error rather than swallowing it", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const env = {
      SERPAPI_API_KEY: "serp-test-key",
      AI: {
        run: vi.fn(async () => {
          throw new Error("4006: you have used up your daily free allocation of 10,000 neurons");
        }),
      },
    };

    await expect(run(env)).rejects.toThrow("4006");
  });

  it("tolerates a job search that returns no postings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const { env, calls } = makeEnv({
      replies: [
        { response: JSON.stringify(RESUME_JSON) },
        { response: JSON.stringify(MARKET_JSON) },
        { response: JSON.stringify(GAP_JSON) },
      ],
    });

    const result = await run(env);

    expect(JSON.parse(result.marketResearch)).toEqual(MARKET_JSON);
    expect(calls).toHaveLength(3);
  });
});
