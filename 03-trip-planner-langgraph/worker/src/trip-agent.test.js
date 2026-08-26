import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTripPlanner } from "./trip-agent.js";
import { resetToolCache } from "./mcp.js";

const ITINERARY = {
  title: "Trip to Lisbon",
  overview: "Three days of coast and custard tarts.",
  accommodation: { name: "Hotel Alegria", pricePerNight: "$120", notes: "Central" },
  days: [
    {
      day: 1,
      title: "Alfama",
      morning: { activity: "Castle", location: "São Jorge", cost: "$15" },
      afternoon: { activity: "Tram 28", location: "Alfama", cost: "$4" },
      evening: { activity: "Fado", location: "Bairro Alto", cost: "$40" },
    },
  ],
  budget: {
    accommodation: 360,
    food: 300,
    transport: 120,
    activities: 200,
    misc: 100,
    total: 1080,
    perPerson: 540,
    verdict: "Under budget",
  },
  transportTips: ["Buy a Viva Viagem card"],
  diningTips: ["Book dinner late"],
  travelTips: ["Wear grippy shoes"],
};

const TOOLS_LIST = {
  tools: [
    {
      name: "web_search",
      description: "Search the web using SerpAPI (Google).",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  ],
};

const mcpResponse = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result }));

function stubMcp({ toolText = "**Hotel Alegria**\nhttps://example.com\n$120/night" } = {}) {
  const calls = [];
  const fetchMock = vi.fn(async (request) => {
    const body = await request.json();
    calls.push(body);

    if (body.method === "initialize") return mcpResponse({ protocolVersion: "2025-06-18" });
    if (body.method === "tools/list") return mcpResponse(TOOLS_LIST);
    if (body.method === "tools/call") {
      return mcpResponse({ content: [{ type: "text", text: toolText }] });
    }
    return mcpResponse({});
  });

  return { calls, MCP: { fetch: fetchMock }, fetchMock };
}

const searchReplyWithToolCall = {
  response: "",
  tool_calls: [{ name: "web_search", arguments: { query: "Lisbon attractions" } }],
};

const searchReplyFinal = { response: "Attractions: Belém Tower. Hotels: Hotel Alegria $120/night." };
const budgetReply = { response: "Accommodation $60/pp/day. Total $1080 of $2000. Sufficient." };
const itineraryReply = { response: JSON.stringify(ITINERARY) };

const laneOf = (options) => {
  const text = JSON.stringify(options.messages ?? "");
  if (text.includes("travel research agent")) return "search";
  if (text.includes("travel budget planning expert")) return "budget";
  return "itinerary";
};

function makeEnv({ search, budget, itinerary, mcp = stubMcp(), vars = {} } = {}) {
  const queues = {
    search: [...(search ?? [searchReplyFinal])],
    budget: [...(budget ?? [budgetReply])],
    itinerary: [...(itinerary ?? [itineraryReply])],
  };

  const aiCalls = [];
  const env = {
    MCP_SERVER_URL: "https://mcp-search-server.example.workers.dev/mcp",
    MCP: mcp.MCP,
    ...vars,
    AI: {
      run: vi.fn(async (model, options) => {
        const lane = laneOf(options);
        aiCalls.push({ model, options, lane });

        const queue = queues[lane];
        const reply = queue.length > 1 ? queue.shift() : queue[0];
        return typeof reply === "function" ? reply() : reply;
      }),
    },
  };

  const callsFor = (lane) => aiCalls.filter((c) => c.lane === lane);

  return { env, aiCalls, callsFor, mcp };
}

const run = (env, onProgress = () => {}) =>
  runTripPlanner({
    destination: "Lisbon",
    days: 3,
    budget: 2000,
    people: 2,
    env,
    onProgress,
  });

beforeEach(() => {
  resetToolCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTripPlanner", () => {
  it("returns a parsed itinerary object", async () => {
    const { env } = makeEnv({ search: [searchReplyWithToolCall, searchReplyFinal] });

    await expect(run(env)).resolves.toEqual(ITINERARY);
  });

  it("strips code fences the JSON model wraps the itinerary in", async () => {
    const { env } = makeEnv({
      itinerary: [{ response: "```json\n" + JSON.stringify(ITINERARY) + "\n```" }],
    });

    await expect(run(env)).resolves.toEqual(ITINERARY);
  });

  it("falls back to the raw string when the itinerary is not valid JSON", async () => {
    const { env } = makeEnv({ itinerary: [{ response: "sorry, no JSON today" }] });

    await expect(run(env)).resolves.toBe("sorry, no JSON today");
  });

  it("reads gpt-oss Responses-style output and skips reasoning parts", async () => {
    const { env, callsFor } = makeEnv({
      search: [
        {
          output: [
            { type: "reasoning", content: [{ type: "text", text: "thinking out loud" }] },
            { type: "message", content: [{ type: "output_text", text: "Belém Tower is open daily." }] },
          ],
        },
      ],
    });

    await run(env);

    const itineraryPrompt = callsFor("itinerary")[0].options.messages[0].content;
    expect(itineraryPrompt).toContain("Belém Tower is open daily.");
    expect(itineraryPrompt).not.toContain("thinking out loud");
  });

  it("runs the MCP tool loop and feeds the result back to the model", async () => {
    const { env, mcp, callsFor } = makeEnv({
      search: [searchReplyWithToolCall, searchReplyFinal],
    });

    await run(env);

    const methods = mcp.calls.map((c) => c.method);
    expect(methods).toEqual(["initialize", "tools/list", "tools/call"]);
    expect(mcp.calls.at(-1).params).toEqual({
      name: "web_search",
      arguments: { query: "Lisbon attractions" },
    });

    const secondSearchMessages = callsFor("search")[1].options.messages;
    expect(secondSearchMessages.at(-1)).toMatchObject({
      role: "tool",
      name: "web_search",
      content: expect.stringContaining("Hotel Alegria"),
    });
  });

  it("reaches the MCP server over the service binding, not the public internet", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);

    const { env, mcp } = makeEnv({ search: [searchReplyWithToolCall, searchReplyFinal] });

    await run(env);

    expect(mcp.fetchMock).toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("sends the search and budget agents to the text model and the itinerary to the JSON model", async () => {
    const { env, aiCalls, callsFor } = makeEnv();

    await run(env);

    const textCalls = aiCalls.filter((c) => c.lane !== "itinerary");
    expect(textCalls.every((c) => c.model === "@cf/openai/gpt-oss-120b")).toBe(true);
    expect(callsFor("itinerary")[0].model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(callsFor("itinerary")[0].options.temperature).toBe(0);
  });

  it("honours TEXT_MODEL and JSON_MODEL overrides", async () => {
    const { env, aiCalls } = makeEnv({
      vars: { TEXT_MODEL: "@cf/openai/gpt-oss-20b", JSON_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct" },
    });

    await run(env);

    expect(aiCalls.find((c) => c.lane === "search").model).toBe("@cf/openai/gpt-oss-20b");
    expect(aiCalls.find((c) => c.lane === "itinerary").model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
  });

  it("runs search and budget concurrently, then the itinerary", async () => {
    let searchResolved = false;
    let budgetStartedBeforeSearchResolved = false;

    const { env } = makeEnv({
      search: [
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              searchResolved = true;
              resolve(searchReplyFinal);
            }, 20),
          ),
      ],
      budget: [
        () => {
          budgetStartedBeforeSearchResolved = !searchResolved;
          return budgetReply;
        },
      ],
    });

    await run(env);

    expect(budgetStartedBeforeSearchResolved).toBe(true);
  });

  it("feeds both branch outputs into the itinerary prompt", async () => {
    const { env, callsFor } = makeEnv();

    await run(env);

    const prompt = callsFor("itinerary")[0].options.messages[0].content;
    expect(prompt).toContain("Hotel Alegria $120/night");
    expect(prompt).toContain("Total $1080 of $2000");
    expect(prompt).toContain("Include exactly 3 days");
  });

  it("emits start and done for each of the three agents", async () => {
    const { env } = makeEnv();

    const events = [];
    await run(env, (e) => events.push(e));

    for (const agent of ["search", "budget", "itinerary"]) {
      expect(events).toContainEqual({ agent, status: "start" });
      expect(events).toContainEqual({ agent, status: "done" });
    }
  });

  it("reports both branch failures instead of only the first", async () => {
    const { env } = makeEnv({
      search: [() => Promise.reject(new Error("4006: daily free allocation"))],
      budget: [() => Promise.reject(new Error("budget model exploded"))],
    });

    await expect(run(env)).rejects.toThrow(/4006.*budget model exploded/);
  });

  it("keeps a failing tool call from killing the run", async () => {
    const mcp = stubMcp();
    mcp.MCP.fetch = vi.fn(async (request) => {
      const body = await request.json();
      if (body.method === "initialize") return mcpResponse({ protocolVersion: "2025-06-18" });
      if (body.method === "tools/list") return mcpResponse(TOOLS_LIST);
      return new Response("upstream is down", { status: 502 });
    });

    const { env, callsFor } = makeEnv({
      mcp,
      search: [searchReplyWithToolCall, searchReplyFinal],
    });

    await expect(run(env)).resolves.toEqual(ITINERARY);

    const toolMessage = callsFor("search")[1].options.messages.at(-1);
    expect(toolMessage.content).toContain("failed");
  });

  it("synthesizes an answer when the search model returns only tool calls", async () => {
    const { env, callsFor } = makeEnv({
      search: [
        searchReplyWithToolCall,
        searchReplyWithToolCall,
        searchReplyWithToolCall,
        { response: "Belém Tower, Hotel Alegria $120." },
      ],
    });

    await run(env);

    const synthesisMessages = callsFor("search")[3].options.messages;
    expect(synthesisMessages.at(-1).content).toContain("Do not call any more tools");
    expect(callsFor("itinerary")[0].options.messages[0].content).toContain(
      "Belém Tower, Hotel Alegria $120.",
    );
  });
});
