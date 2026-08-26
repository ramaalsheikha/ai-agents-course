import { describe, expect, it, vi } from "vitest";
import orchestrator from "../orchestrator/src/index.js";

const ITINERARY = {
  title: "Trip to Lisbon",
  days: [{ day: 1, title: "Alfama" }],
};

const card = (name) => ({ name, version: "2.0.0", capabilities: { streaming: false } });

const agentStub = (name, reply) => {
  const tasks = [];
  return {
    tasks,
    service: {
      fetch: vi.fn(async (request) => {
        if (request.url.endsWith("/.well-known/agent.json")) {
          return Response.json(card(name));
        }

        const body = await request.json();
        tasks.push(body);

        const result = typeof reply === "function" ? await reply(body) : reply;

        if (result instanceof Response) return result;

        return Response.json({
          jsonrpc: "2.0",
          result: {
            id: body.params.id,
            status: { state: "completed" },
            artifacts: [{ name: "result", parts: [{ type: "text", text: result }] }],
          },
          id: body.id,
        });
      }),
    },
  };
};

const makeEnv = ({ search, budget, itinerary } = {}) => {
  const agents = {
    SEARCH: agentStub("Search Agent", search ?? "Belém Tower. Hotel Alegria $120/night."),
    BUDGET: agentStub("Budget Agent", budget ?? "Total $1080 of $2000. Sufficient."),
    ITINERARY: agentStub("Itinerary Agent", itinerary ?? JSON.stringify(ITINERARY)),
  };

  return {
    agents,
    env: {
      CLIENT_ORIGIN: "https://trip-planner-a2a.pages.dev",
      CLIENT_ORIGIN_SUFFIXES: ".trip-planner-a2a.pages.dev",
      SEARCH: agents.SEARCH.service,
      BUDGET: agents.BUDGET.service,
      ITINERARY: agents.ITINERARY.service,
    },
  };
};

const streamUrl = (query = "destination=Lisbon&days=3&budget=2000&people=2") =>
  `https://a2a-orchestrator.example.workers.dev/api/a2a/stream?${query}`;

const frames = async (res) => {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
};

const run = async (env, url = streamUrl()) =>
  frames(await orchestrator.fetch(new Request(url), env));

describe("orchestrator", () => {
  it("rejects a request with no destination", async () => {
    const { env } = makeEnv();
    const res = await orchestrator.fetch(new Request(streamUrl("days=3")), env);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "destination is required" });
  });

  it("discovers all three agents by their cards before sending any task", async () => {
    const { env, agents } = makeEnv();
    const emitted = await run(env);

    const discovered = emitted.filter((f) => f.type === "agent_discovered");
    expect(discovered.map((f) => f.agentName)).toEqual(["search", "budget", "itinerary"]);
    expect(discovered[0].card.name).toBe("Search Agent");

    const firstCall = agents.SEARCH.service.fetch.mock.calls[0][0];
    expect(firstCall.url).toContain("/.well-known/agent.json");
  });

  it("sends a2a tasks/send envelopes and returns the parsed itinerary", async () => {
    const { env, agents } = makeEnv();
    const emitted = await run(env);

    const searchTask = agents.SEARCH.tasks[0];
    expect(searchTask.jsonrpc).toBe("2.0");
    expect(searchTask.method).toBe("tasks/send");
    expect(searchTask.params.message.parts[0].text).toContain("Lisbon");

    expect(agents.ITINERARY.tasks[0].params.message.parts[0].text).toContain("Duration: 3 days");
    expect(emitted.at(-1)).toEqual({ type: "result", itinerary: ITINERARY });
  });

  it("feeds both parallel results into the itinerary prompt", async () => {
    const { env, agents } = makeEnv();
    await run(env);

    const prompt = agents.ITINERARY.tasks[0].params.message.parts[0].text;
    expect(prompt).toContain("Belém Tower");
    expect(prompt).toContain("Total $1080 of $2000");
  });

  it("emits task_sent and task_done for every agent", async () => {
    const { env } = makeEnv();
    const emitted = await run(env);

    for (const agentName of ["search", "budget", "itinerary"]) {
      expect(emitted.some((f) => f.type === "task_sent" && f.agentName === agentName)).toBe(true);
      expect(emitted.some((f) => f.type === "task_done" && f.agentName === agentName)).toBe(true);
    }
  });

  it("reports both parallel failures in one error frame", async () => {
    const { env } = makeEnv({
      search: () =>
        Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "MCP 401" }, id: "rpc" }),
      budget: () =>
        Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "no neurons" }, id: "rpc" }),
    });

    const emitted = await run(env);
    const error = emitted.at(-1);

    expect(error.type).toBe("error");
    expect(error.message).toContain("MCP 401");
    expect(error.message).toContain("no neurons");
  });

  it("does not dispatch the itinerary task when a parallel agent fails", async () => {
    const { env, agents } = makeEnv({
      search: () => new Response("boom", { status: 500 }),
    });

    await run(env);

    expect(agents.ITINERARY.tasks).toHaveLength(0);
  });

  it("passes unparseable itinerary text through instead of throwing", async () => {
    const { env } = makeEnv({ itinerary: "sorry, no JSON today" });
    const emitted = await run(env);

    expect(emitted.at(-1)).toEqual({ type: "result", itinerary: "sorry, no JSON today" });
  });

  it("fails loudly when a service binding is missing", async () => {
    const { env } = makeEnv();
    delete env.ITINERARY;

    const emitted = await run(env);

    expect(emitted.at(-1).type).toBe("error");
    expect(emitted.at(-1).message).toContain("ITINERARY");
  });

  it("echoes an allowed origin and withholds the header from anyone else", async () => {
    const { env } = makeEnv();

    const allowed = await orchestrator.fetch(
      new Request(streamUrl(), { headers: { Origin: "https://trip-planner-a2a.pages.dev" } }),
      env,
    );
    const denied = await orchestrator.fetch(
      new Request(streamUrl(), { headers: { Origin: "https://evil.example.com" } }),
      env,
    );

    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://trip-planner-a2a.pages.dev",
    );
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
