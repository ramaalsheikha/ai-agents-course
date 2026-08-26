import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJobQuery, filterJobsByDomain, runCareerAssistant } from "./career-agent.js";

const RESUME_JSON = {
  level: "senior",
  yearsExperience: 7,
  domain: "e-commerce",
  summary: "Senior full-stack engineer on a microservices e-commerce platform.",
  skills: ["Python", "Java", "React", "AWS"],
  strengths: ["team leadership"],
  achievements: [{ text: "Reduced latency by 40% through API optimization", metric: "40%" }],
  gaps: ["no formal AI work"],
};

const MARKET_JSON = {
  topSkills: ["Python", "Kubernetes", "AI"],
  experienceRange: "5-10 years",
  salaryRange: "$100K-$150K",
  topCompanies: ["Shopfront", "Genentech"],
  keyTrends: ["platform teams"],
};

const GAP_JSON = {
  readinessScore: 72,
  readinessLabel: "Close, with gaps in orchestration.",
  skillGaps: [{ skill: "Kubernetes", severity: "medium", note: "asked for in most postings" }],
  actions: [{ timeframe: "now", items: ["Run a cluster locally"] }],
  resources: [{ type: "course", name: "Kubernetes for developers", skill: "Kubernetes" }],
  resumeTips: ["Quantify platform impact"],
};

const ECOM_JOB = {
  title: "Senior Software Engineer, E-commerce Platform",
  company_name: "Shopfront",
  location: "Austin, TX",
  extensions: ["Full-time"],
  description: "Python, AWS, React, Kubernetes on a high-traffic commerce checkout.",
};

const PHARMA_JOB = {
  title: "Scientist II, Molecular Biology",
  company_name: "Genentech",
  location: "South San Francisco, CA",
  extensions: ["Full-time"],
  description: "Assay development and wet-lab pipetting for oncology research programs.",
};

const RESUME_TEXT = [
  "Senior Software Engineer with 7 years of experience in full-stack development.",
  "Proficient in Python, Java, React, and AWS. Led a team of 6 engineers building",
  "a microservices-based e-commerce platform serving 2M+ users. Reduced latency",
  "by 40% through API optimization. Bachelor's in Computer Science from UT Austin.",
  "Certified AWS Solutions Architect.",
].join("\n");

function jobsResponse(jobs) {
  return { google_jobs_results: jobs };
}

function stubFetchOk(jobs = [ECOM_JOB]) {
  return vi.fn(async () => new Response(JSON.stringify(jobsResponse(jobs)), { status: 200 }));
}

function laneOf(options) {
  if (options.text) return "embed";
  const text = options.messages[0].content;
  if (text.includes("expert resume analyst")) return "resume";
  if (text.includes("job market analyst")) return "market";
  return "gap";
}

function fakeVector(text, dims = 512) {
  const vector = new Array(dims).fill(0);
  for (const token of String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) hash = (hash * 31 + token.charCodeAt(i)) % dims;
    vector[hash] += 1;
  }
  return vector;
}

function makeEnv({ payloads = {}, serpApiKey = "serp-test-key", model, onCall } = {}) {
  const calls = [];
  const defaults = { resume: RESUME_JSON, market: MARKET_JSON, gap: GAP_JSON };

  return {
    calls,
    chatCalls: () => calls.filter((c) => c.lane !== "embed"),
    promptFor: (lane) => calls.find((c) => c.lane === lane)?.options.messages[0].content,
    env: {
      SERPAPI_API_KEY: serpApiKey,
      ...(model ? { AI_MODEL: model } : {}),
      AI: {
        run: vi.fn(async (modelId, options) => {
          const lane = laneOf(options);
          calls.push({ lane, modelId, options });

          if (lane === "embed") {
            const texts = Array.isArray(options.text) ? options.text : [options.text];
            return { data: texts.map((t) => fakeVector(t)) };
          }

          const override = onCall?.({ lane, options, calls });
          if (override !== undefined) return override;

          const payload = lane in payloads ? payloads[lane] : defaults[lane];
          return { response: typeof payload === "string" ? payload : JSON.stringify(payload) };
        }),
      },
    },
  };
}

const run = (env, onProgress = () => {}, overrides = {}) =>
  runCareerAssistant({
    resume: RESUME_TEXT,
    targetMarket: "United States",
    targetRole: "Senior Software Engineer",
    env,
    onProgress,
    ...overrides,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildJobQuery", () => {
  it("adds the resume domain to the search query", () => {
    expect(
      buildJobQuery({
        targetRole: "Senior Software Engineer",
        targetMarket: "United States",
        domain: "e-commerce",
      }),
    ).toBe("Senior Software Engineer commerce in United States");
  });

  it("does not repeat a domain term already present in the role", () => {
    expect(
      buildJobQuery({ targetRole: "Data Engineer", targetMarket: "UAE", domain: "data" }),
    ).toBe("Data Engineer in UAE");
  });

  it("falls back to role and market when the domain is unknown", () => {
    expect(
      buildJobQuery({ targetRole: "Data Engineer", targetMarket: "UAE", domain: "" }),
    ).toBe("Data Engineer in UAE");
  });
});

describe("filterJobsByDomain", () => {
  it("drops postings from an unrelated industry", () => {
    const { jobs, relaxed } = filterJobsByDomain([ECOM_JOB, PHARMA_JOB], {
      targetRole: "Senior Software Engineer",
      domain: "e-commerce",
      skills: ["Python", "AWS"],
    });

    expect(jobs).toEqual([ECOM_JOB]);
    expect(relaxed).toBe(false);
  });

  it("relaxes rather than returning nothing when no posting matches", () => {
    const { jobs, relaxed } = filterJobsByDomain([PHARMA_JOB], {
      targetRole: "Android Engineer",
      domain: "mobile",
      skills: ["Kotlin"],
    });

    expect(jobs).toEqual([PHARMA_JOB]);
    expect(relaxed).toBe(true);
  });
});

describe("runCareerAssistant", () => {
  it("constrains every node with the json_schema for its own payload", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, calls } = makeEnv();

    await run(env);

    const schemaFor = (lane) => calls.find((c) => c.lane === lane).options.response_format;

    expect(schemaFor("resume").json_schema.required).toContain("achievements");
    expect(schemaFor("market").json_schema.required).toContain("topSkills");
    expect(schemaFor("gap").json_schema.required).toContain("readinessScore");
  });

  it("runs the resume analyzer before the market researcher so the domain is known", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, chatCalls } = makeEnv();

    await run(env);

    expect(chatCalls().map((c) => c.lane)).toEqual(["resume", "market", "gap"]);
  });

  it("indexes the resume and retrieves passages instead of pasting the whole document", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const longResume = `${RESUME_TEXT}\n\n${"Unrelated volunteering history. ".repeat(120)}`;
    const { env, calls, promptFor } = makeEnv();

    await run(env, () => {}, { resume: longResume });

    const excerpts = promptFor("resume").split("Resume excerpts:\n")[1].split('\n\nWrite "summary"')[0];

    expect(calls.some((c) => c.lane === "embed")).toBe(true);
    expect(excerpts.length).toBeLessThan(longResume.length);
  });

  it("scopes the SerpAPI query to the domain the resume evidences", async () => {
    const fetchMock = stubFetchOk();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = makeEnv();

    await run(env);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("engine")).toBe("google_jobs");
    expect(url.searchParams.get("q")).toBe("Senior Software Engineer commerce in United States");
    expect(url.searchParams.get("api_key")).toBe("serp-test-key");
  });

  it("keeps only companies that appear in the fetched postings", async () => {
    vi.stubGlobal("fetch", stubFetchOk([ECOM_JOB, PHARMA_JOB]));
    const { env } = makeEnv();

    const result = await run(env);
    const market = JSON.parse(result.marketResearch);

    expect(market.topCompanies).toEqual(["Shopfront"]);
    expect(market.topCompanies).not.toContain("Genentech");
  });

  it("passes the structured resume and market objects into the gap prompt", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, promptFor } = makeEnv();

    await run(env);

    const gapPrompt = promptFor("gap");
    expect(gapPrompt).toContain('"domain": "e-commerce"');
    expect(gapPrompt).toContain('"Reduced latency by 40% through API optimization"');
    expect(gapPrompt).toContain('"Kubernetes"');
  });

  it("keeps the quantified achievements the resume analyzer extracted", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv();

    const result = await run(env);
    const resume = JSON.parse(result.resumeAnalysis);

    expect(resume.summary).toContain("e-commerce");
    expect(resume.achievements).toContainEqual({
      text: "Reduced latency by 40% through API optimization",
      metric: "40%",
    });
  });

  it("recovers quantified achievements from the resume when the model omits them", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({ payloads: { resume: { ...RESUME_JSON, achievements: [] } } });

    const result = await run(env);
    const resume = JSON.parse(result.resumeAnalysis);

    expect(resume.achievements.length).toBeGreaterThan(0);
    expect(resume.achievements.some((a) => a.metric === "40%")).toBe(true);
  });

  it("drops a recommended resource that maps to no identified gap", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      payloads: {
        gap: {
          ...GAP_JSON,
          resources: [
            { type: "cert", name: "Certified Scrum Master", skill: "Agile" },
            { type: "course", name: "Kubernetes deep dive", skill: "Kubernetes" },
          ],
        },
      },
    });

    const result = await run(env);
    const gap = JSON.parse(result.gapAnalysis);

    expect(gap.resources.map((r) => r.name)).not.toContain("Certified Scrum Master");
    expect(gap.resources.every((r) => gap.skillGaps.some((g) => g.skill === r.skill))).toBe(true);
  });

  it("generates a resource for every gap the model left uncovered", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      payloads: {
        gap: {
          ...GAP_JSON,
          skillGaps: [
            { skill: "AI", severity: "high", note: "named in most postings" },
            { skill: "Kubernetes", severity: "medium", note: "orchestration" },
          ],
          resources: [],
        },
      },
    });

    const result = await run(env);
    const gap = JSON.parse(result.gapAnalysis);

    expect(gap.resources.map((r) => r.skill).sort()).toEqual(["AI", "Kubernetes"]);
  });

  it("never emits an empty section, even when the gap analyst returns nothing usable", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({ payloads: { gap: "not json at all" } });

    const result = await run(env);
    const gap = JSON.parse(result.gapAnalysis);

    expect(gap.skillGaps.length).toBeGreaterThan(0);
    expect(gap.actions.length).toBeGreaterThan(0);
    expect(gap.actions.every((a) => a.items.length > 0)).toBe(true);
    expect(gap.resources.length).toBeGreaterThan(0);
    expect(gap.resumeTips.length).toBeGreaterThan(0);
    expect(gap.readinessScore).toBeGreaterThanOrEqual(0);
    expect(gap.readinessLabel).not.toBe("");
  });

  it("retries a lane once when the model replies with unparseable JSON", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    let gapAttempts = 0;
    const { env, chatCalls } = makeEnv({
      onCall: ({ lane }) => {
        if (lane !== "gap") return undefined;
        gapAttempts += 1;
        return gapAttempts === 1 ? { response: "sorry, here is my advice:" } : undefined;
      },
    });

    const result = await run(env);

    expect(gapAttempts).toBe(2);
    expect(JSON.parse(result.gapAnalysis).readinessScore).toBe(72);
    expect(chatCalls().filter((c) => c.lane === "gap")).toHaveLength(2);
  });

  it("retries a node unconstrained when the model rejects its schema", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, chatCalls } = makeEnv({
      onCall: ({ lane, options }) => {
        if (lane === "resume" && options.response_format) {
          throw new Error("json_schema not supported for this model");
        }
        return undefined;
      },
    });

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis).domain).toBe("e-commerce");
    const resumeCalls = chatCalls().filter((c) => c.lane === "resume");
    expect(resumeCalls).toHaveLength(2);
    expect(resumeCalls[1].options.response_format).toBeUndefined();
  });

  it("survives fenced JSON from every lane", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      payloads: {
        resume: "```json\n" + JSON.stringify(RESUME_JSON) + "\n```",
        market: "```json\n" + JSON.stringify(MARKET_JSON) + "\n```",
        gap: "```\n" + JSON.stringify(GAP_JSON) + "\n```",
      },
    });

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis).level).toBe("senior");
    expect(JSON.parse(result.marketResearch).topSkills).toContain("Kubernetes");
    expect(JSON.parse(result.gapAnalysis).readinessScore).toBe(72);
  });

  it("accepts a plain string response as well as { response }", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({
      onCall: ({ lane }) =>
        lane === "resume" ? JSON.stringify(RESUME_JSON) : undefined,
    });

    const result = await run(env);

    expect(JSON.parse(result.resumeAnalysis).yearsExperience).toBe(7);
  });

  it("uses AI_MODEL when set and keeps the per-node temperatures", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, chatCalls } = makeEnv({ model: "@cf/meta/llama-4-scout-17b-16e-instruct" });

    await run(env);

    const chats = chatCalls();
    expect(chats.every((c) => c.modelId === "@cf/meta/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(chats.find((c) => c.lane === "gap").options.temperature).toBe(0.3);
    expect(chats.filter((c) => c.lane !== "gap").every((c) => c.options.temperature === 0)).toBe(true);
  });

  it("falls back to the default model when AI_MODEL is unset", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env, chatCalls } = makeEnv();

    await run(env);

    expect(chatCalls()[0].modelId).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("emits start and done for each of the three agents", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv();

    const events = [];
    await run(env, (e) => events.push(e));

    for (const agent of ["resume", "market", "gap"]) {
      expect(events).toContainEqual({ agent, status: "start", detail: "" });
      expect(events).toContainEqual({ agent, status: "done", detail: "" });
    }
    expect(events.some((e) => e.agent === "market" && e.status === "working")).toBe(true);
  });

  it("fails when SERPAPI_API_KEY is missing", async () => {
    vi.stubGlobal("fetch", stubFetchOk());
    const { env } = makeEnv({ serpApiKey: "" });

    await expect(run(env)).rejects.toThrow("SERPAPI_API_KEY is not set");
  });

  it("fails when SerpAPI returns a non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })),
    );
    const { env } = makeEnv();

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

  it("retries without the domain qualifier when the narrow query returns nothing", async () => {
    const urls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        urls.push(url);
        const body = urls.length === 1 ? {} : jobsResponse([ECOM_JOB]);
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    const { env } = makeEnv();

    const result = await run(env);

    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[0])).toContain("Senior Software Engineer commerce in United States");
    expect(decodeURIComponent(urls[1])).toContain("Senior Software Engineer in United States");
    expect(JSON.parse(result.marketResearch).postingsAnalyzed).toBe(1);
  });

  it("does not retry when the narrow query already carries no qualifier", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = makeEnv({
      onCall: ({ lane }) =>
        lane === "resume" ? JSON.stringify({ ...RESUME_JSON, domain: "software" }) : undefined,
    });

    await run(env);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tolerates a job search that returns no postings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const { env } = makeEnv();

    const result = await run(env);
    const market = JSON.parse(result.marketResearch);

    expect(market.postingsAnalyzed).toBe(0);
    expect(market.topCompanies).toEqual([]);
    expect(JSON.parse(result.gapAnalysis).skillGaps.length).toBeGreaterThan(0);
  });
});
