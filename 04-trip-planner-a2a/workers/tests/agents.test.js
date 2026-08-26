import { beforeEach, describe, expect, it, vi } from "vitest";
import searchAgent from "../search-agent/src/index.js";
import budgetAgent from "../budget-agent/src/index.js";
import itineraryAgent, { dayCountOf } from "../itinerary-agent/src/index.js";
import { resetToolCache } from "../shared/mcp.js";

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

const stubMcp = () => {
  const calls = [];
  return {
    calls,
    MCP: {
      fetch: vi.fn(async (request) => {
        const body = await request.json();
        calls.push(body);

        if (body.method === "initialize") return mcpResponse({ protocolVersion: "2025-06-18" });
        if (body.method === "tools/list") return mcpResponse(TOOLS_LIST);
        if (body.method === "tools/call") {
          return mcpResponse({ content: [{ type: "text", text: "Hotel Alegria $120/night" }] });
        }
        return mcpResponse({});
      }),
    },
  };
};

const taskRequest = (text, overrides = {}) =>
  new Request("https://agent.internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tasks/send",
      params: { id: "task-1", message: { role: "user", parts: [{ type: "text", text }] } },
      id: "rpc-1",
      ...overrides,
    }),
  });

const cardRequest = () => new Request("https://a2a-budget-agent.example.workers.dev/.well-known/agent.json");

const artifactText = (body) => body.result?.artifacts?.[0]?.parts?.[0]?.text;

const aiEnv = (impl) => {
  const calls = [];
  return {
    calls,
    env: {
      AI: {
        run: vi.fn(async (model, options) => {
          calls.push({ model, options });
          return impl(calls.length - 1, options);
        }),
      },
    },
  };
};

beforeEach(() => {
  resetToolCache();
});

describe("agent card", () => {
  it("serves the card with the request origin as its url", async () => {
    const res = await budgetAgent.fetch(cardRequest(), {});
    const card = await res.json();

    expect(res.status).toBe(200);
    expect(card.name).toBe("Budget Agent");
    expect(card.url).toBe("https://a2a-budget-agent.example.workers.dev");
    expect(card.skills[0].id).toBe("travel-budget");
  });
});

describe("a2a envelope", () => {
  it("rejects anything that is not a 2.0 tasks/send call", async () => {
    const res = await budgetAgent.fetch(taskRequest("hi", { method: "tasks/get" }), {});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe(-32600);
    expect(body.id).toBe("rpc-1");
  });

  it("returns the model output as a completed task artifact", async () => {
    const { env } = aiEnv(() => ({ response: "Accommodation $60/pp/day. Total $1080." }));

    const res = await budgetAgent.fetch(taskRequest("Budget for Lisbon"), env);
    const body = await res.json();

    expect(body.result.status.state).toBe("completed");
    expect(body.result.id).toBe("task-1");
    expect(artifactText(body)).toContain("Total $1080");
  });

  it("maps a thrown agent error onto a -32603 response", async () => {
    const env = {
      AI: {
        run: vi.fn(async () => {
          throw new Error("model unavailable");
        }),
      },
    };

    const res = await budgetAgent.fetch(taskRequest("Budget for Lisbon"), env);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toEqual({ code: -32603, message: "model unavailable" });
  });
});

describe("itinerary agent", () => {
  it("reads the day count out of the prompt", () => {
    expect(dayCountOf("Duration: 5 days")).toBe(5);
    expect(dayCountOf("Duration: 1 day")).toBe(1);
    expect(dayCountOf("no duration here")).toBe(7);
  });

  it("constrains the model with a schema matching the requested day count", async () => {
    const { env, calls } = aiEnv(() => ({ response: ITINERARY }));

    await itineraryAgent.fetch(taskRequest("Duration: 3 days\nPlan it."), env);

    const { response_format: format } = calls[0].options;
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.properties.days.minItems).toBe(3);
    expect(format.json_schema.properties.days.maxItems).toBe(3);
  });

  it("serializes a schema-enforced object back to JSON text", async () => {
    const { env } = aiEnv(() => ({ response: ITINERARY }));

    const res = await itineraryAgent.fetch(taskRequest("Duration: 3 days"), env);
    const body = await res.json();

    expect(JSON.parse(artifactText(body))).toEqual(ITINERARY);
  });

  it("strips code fences when the model answers with text", async () => {
    const { env } = aiEnv(() => ({ response: "```json\n" + JSON.stringify(ITINERARY) + "\n```" }));

    const res = await itineraryAgent.fetch(taskRequest("Duration: 3 days"), env);
    const body = await res.json();

    expect(JSON.parse(artifactText(body))).toEqual(ITINERARY);
  });

  it("retries unconstrained when the model rejects the schema", async () => {
    const { env, calls } = aiEnv((index) => {
      if (index === 0) throw new Error("json_schema not supported");
      return { response: JSON.stringify(ITINERARY) };
    });

    const res = await itineraryAgent.fetch(taskRequest("Duration: 3 days"), env);
    const body = await res.json();

    expect(calls).toHaveLength(2);
    expect(calls[0].options.response_format).toBeDefined();
    expect(calls[1].options.response_format).toBeUndefined();
    expect(JSON.parse(artifactText(body))).toEqual(ITINERARY);
  });
});

describe("search agent", () => {
  it("drives the MCP tool loop over the service binding and never over global fetch", async () => {
    const mcp = stubMcp();
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);

    const { env, calls } = aiEnv((index) =>
      index === 0
        ? {
            response: "",
            tool_calls: [{ name: "web_search", arguments: { query: "Lisbon attractions" } }],
          }
        : { response: "Belém Tower. Hotel Alegria $120/night." },
    );

    const res = await searchAgent.fetch(taskRequest("Find attractions in Lisbon"), {
      ...env,
      MCP: mcp.MCP,
      MCP_SERVER_URL: "https://mcp-search-server.example.workers.dev/mcp",
    });
    const body = await res.json();

    expect(artifactText(body)).toContain("Belém Tower");
    expect(globalFetch).not.toHaveBeenCalled();

    const toolCall = mcp.calls.find((call) => call.method === "tools/call");
    expect(toolCall.params).toEqual({ name: "web_search", arguments: { query: "Lisbon attractions" } });

    const toolMessage = calls[1].options.messages.find((m) => m.role === "tool");
    expect(toolMessage.content).toContain("Hotel Alegria");

    vi.unstubAllGlobals();
  });

  it("synthesizes a briefing when the model finishes holding only tool calls", async () => {
    const mcp = stubMcp();
    const toolCallReply = {
      response: "",
      tool_calls: [{ name: "web_search", arguments: { query: "Lisbon" } }],
    };

    const { env, calls } = aiEnv((index) =>
      index < 3 ? toolCallReply : { response: "Belém Tower, Hotel Alegria $120." },
    );

    const res = await searchAgent.fetch(taskRequest("Find attractions in Lisbon"), {
      ...env,
      MCP: mcp.MCP,
      MCP_SERVER_URL: "https://mcp-search-server.example.workers.dev/mcp",
    });
    const body = await res.json();

    expect(calls).toHaveLength(4);
    expect(calls[3].options.messages.at(-1).content).toContain("Do not call any more tools");
    expect(artifactText(body)).toContain("Belém Tower");
  });
});
