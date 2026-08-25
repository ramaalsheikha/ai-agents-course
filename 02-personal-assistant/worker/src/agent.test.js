import { describe, expect, it, vi, beforeEach } from "vitest";

const { searchHandler, webHandler, mcpHandler, loadMcpTools } = vi.hoisted(() => ({
  searchHandler: vi.fn(),
  webHandler: vi.fn(),
  mcpHandler: vi.fn(),
  loadMcpTools: vi.fn(),
}));

vi.mock("./tools.js", () => ({
  TOOLS_BY_MODE: {
    rag: [
      {
        name: "search_knowledge_base",
        description: "Search the uploaded documents",
        parameters: { type: "object", properties: { query: { type: "string" } } },
        handler: searchHandler,
      },
    ],
    api: [
      {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object", properties: { query: { type: "string" } } },
        handler: webHandler,
      },
    ],
  },
}));

vi.mock("./mcp.js", () => ({ loadMcpTools }));

const { runAgent } = await import("./agent.js");

const text = (response) => ({ response });

const toolCall = (name, args, id = "call_1") => ({
  response: "",
  tool_calls: [{ id, name, arguments: JSON.stringify(args) }],
});

const contextError = () =>
  new Error('8007: {"error":{"message":"This model\'s maximum context length is 24000 tokens."}}');

const makeEnv = (replies) => {
  const store = new Map();
  const queue = [...replies];

  const AI = {
    run: vi.fn(async (model, options) => {
      const reply = queue.length > 1 ? queue.shift() : queue[0];
      const resolved = typeof reply === "function" ? reply(model, options) : reply;
      if (resolved instanceof Error) throw resolved;
      return resolved;
    }),
  };

  return {
    AI,
    store,
    CHAT_HISTORY: {
      get: vi.fn(async (key) => store.get(key) ?? null),
      put: vi.fn(async (key, value) => store.set(key, JSON.parse(value))),
    },
  };
};

const messagesOf = (env, index) => env.AI.run.mock.calls[index][1].messages;
const systemOf = (env, index) => messagesOf(env, index)[0].content;

beforeEach(() => {
  vi.clearAllMocks();
  loadMcpTools.mockResolvedValue([
    {
      name: "mcp_search",
      description: "Search via MCP",
      parameters: { type: "object", properties: {} },
      handler: mcpHandler,
    },
  ]);
});

describe("small talk", () => {
  it("answers a greeting without calling any tool", async () => {
    const env = makeEnv([text("Hello! How can I help you today?")]);

    const result = await runAgent({ env, message: "Hello", mode: "rag" });

    expect(result.output).toBe("Hello! How can I help you today?");
    expect(searchHandler).not.toHaveBeenCalled();
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    expect(env.AI.run.mock.calls[0][1].tools).toBeUndefined();
    expect(systemOf(env, 0)).toContain("small talk");
  });

  it("answers an Arabic greeting without calling any tool", async () => {
    const env = makeEnv([text("مرحبا، كيف يمكنني مساعدتك اليوم؟")]);

    const result = await runAgent({ env, message: "مرحبا", mode: "rag" });

    expect(result.output).toBe("مرحبا، كيف يمكنني مساعدتك اليوم؟");
    expect(searchHandler).not.toHaveBeenCalled();
  });

  it("short-circuits before MCP tools are loaded", async () => {
    const env = makeEnv([text("Hi there!")]);

    await runAgent({ env, message: "hi", mode: "mcp" });

    expect(loadMcpTools).not.toHaveBeenCalled();
  });

  it("falls back to a default reply when the model returns nothing", async () => {
    const env = makeEnv([text("   ")]);

    const result = await runAgent({ env, message: "thanks", mode: "rag" });

    expect(result.output).toBe("Hello! How can I help you today?");
  });

  it("saves the greeting turn to history", async () => {
    const env = makeEnv([text("Hey!")]);

    await runAgent({ env, message: "hello", sessionId: "s1", mode: "rag" });

    expect(env.store.get("chat:rag:s1")).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hey!" },
    ]);
  });
});

describe("rag retrieval", () => {
  it("calls search_knowledge_base for a document question", async () => {
    searchHandler.mockResolvedValue("[Atlas.pdf, p.1]\nAtlas is a multi-platform app.");

    const env = makeEnv([
      toolCall("search_knowledge_base", { query: "What is Atlas?" }),
      text("Atlas is a multi-platform app [Atlas.pdf]."),
    ]);

    const result = await runAgent({ env, message: "What is Atlas?", mode: "rag" });

    expect(searchHandler).toHaveBeenCalledWith(env, { query: "What is Atlas?" });
    expect(result.output).toBe("Atlas is a multi-platform app [Atlas.pdf].");
  });

  it("instructs the model to search first, every time", async () => {
    searchHandler.mockResolvedValue("passage");
    const env = makeEnv([toolCall("search_knowledge_base", { query: "x" }), text("done")]);

    await runAgent({ env, message: "What is Atlas?", mode: "rag" });

    expect(systemOf(env, 0)).toContain("Call search_knowledge_base first, every time");
  });

  it("feeds the tool result back as a tool message", async () => {
    searchHandler.mockResolvedValue("Training lasted eight weeks.");

    const env = makeEnv([
      toolCall("search_knowledge_base", { query: "training" }, "abc"),
      text("Eight weeks."),
    ]);

    await runAgent({ env, message: "How long was the training?", mode: "rag" });

    const second = messagesOf(env, 1);
    expect(second.at(-2)).toMatchObject({ role: "assistant" });
    expect(second.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "abc",
      name: "search_knowledge_base",
      content: "Training lasted eight weeks.",
    });
  });

  it("truncates a long tool result", async () => {
    searchHandler.mockResolvedValue("x".repeat(9000));

    const env = makeEnv([toolCall("search_knowledge_base", { query: "q" }), text("ok")]);

    await runAgent({ env, message: "What is Atlas?", mode: "rag" });

    expect(messagesOf(env, 1).at(-1).content).toHaveLength(2500);
  });

  it("reports a failing tool instead of throwing", async () => {
    searchHandler.mockRejectedValue(new Error("Pinecone unreachable"));

    const env = makeEnv([toolCall("search_knowledge_base", { query: "q" }), text("I could not search.")]);

    const result = await runAgent({ env, message: "What is Atlas?", mode: "rag" });

    expect(messagesOf(env, 1).at(-1).content).toContain("Pinecone unreachable");
    expect(result.output).toBe("I could not search.");
  });

  it("runs at most two tool calls per round", async () => {
    searchHandler.mockResolvedValue("passage");

    const env = makeEnv([
      {
        response: "",
        tool_calls: [
          { id: "a", name: "search_knowledge_base", arguments: '{"query":"one"}' },
          { id: "b", name: "search_knowledge_base", arguments: '{"query":"two"}' },
          { id: "c", name: "search_knowledge_base", arguments: '{"query":"three"}' },
        ],
      },
      text("done"),
    ]);

    await runAgent({ env, message: "What is Atlas?", mode: "rag" });

    expect(searchHandler).toHaveBeenCalledTimes(2);
  });

  it("stops after three tool rounds and synthesises an answer", async () => {
    searchHandler.mockResolvedValue("passage");

    const env = makeEnv([
      (model, options) =>
        options.tools
          ? toolCall("search_knowledge_base", { query: "again" })
          : text("Final synthesised answer."),
    ]);

    const result = await runAgent({ env, message: "What is Atlas?", mode: "rag" });

    expect(searchHandler).toHaveBeenCalledTimes(3);
    expect(result.output).toBe("Final synthesised answer.");
  });

  it("does not save history when no answer is produced", async () => {
    const env = makeEnv([text("")]);

    const result = await runAgent({ env, message: "What is Atlas?", sessionId: "s2", mode: "rag" });

    expect(result.output).toBe("");
    expect(env.CHAT_HISTORY.put).not.toHaveBeenCalled();
  });

  it("includes prior history in the prompt", async () => {
    const env = makeEnv([text("Yes.")]);
    env.store.set("chat:rag:s3", [
      { role: "user", content: "What is Atlas?" },
      { role: "assistant", content: "A multi-platform app." },
    ]);

    await runAgent({ env, message: "Is it on Android?", sessionId: "s3", mode: "rag" });

    expect(messagesOf(env, 0).map((m) => m.content)).toContain("A multi-platform app.");
  });
});

describe("modes", () => {
  it("rejects an unknown mode before answering small talk", async () => {
    const env = makeEnv([text("Hello!")]);

    await expect(runAgent({ env, message: "hello", mode: "nope" })).rejects.toThrow(
      "Unknown or unavailable mode: nope",
    );
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("throws when the MCP server exposes no tools", async () => {
    loadMcpTools.mockResolvedValue([]);
    const env = makeEnv([text("hi")]);

    await expect(runAgent({ env, message: "What is Atlas?", mode: "mcp" })).rejects.toThrow(
      "Unknown or unavailable mode: mcp",
    );
  });

  it("uses MCP tools for a real question", async () => {
    mcpHandler.mockResolvedValue("mcp result");
    const env = makeEnv([toolCall("mcp_search", { query: "q" }), text("Answered via MCP.")]);

    const result = await runAgent({ env, message: "What is Atlas?", mode: "mcp" });

    expect(mcpHandler).toHaveBeenCalled();
    expect(result.output).toBe("Answered via MCP.");
    expect(result.mode).toBe("mcp");
  });

  it("gives each mode its own system prompt", async () => {
    const ragEnv = makeEnv([text("a")]);
    const apiEnv = makeEnv([text("b")]);

    await runAgent({ env: ragEnv, message: "What is Atlas?", mode: "rag" });
    await runAgent({ env: apiEnv, message: "What is Atlas?", mode: "api" });

    expect(systemOf(ragEnv, 0)).toContain("document assistant");
    expect(systemOf(apiEnv, 0)).toContain("web and image search tools");
  });
});

describe("context overflow", () => {
  it("retries with a smaller budget on an 8007 error", async () => {
    const long = "y".repeat(12000);
    const env = makeEnv([contextError(), text("Answer after retry.")]);
    env.store.set(
      "chat:rag:s4",
      Array.from({ length: 6 }, (_, i) => ({ role: "user", content: `${long}${i}` })),
    );

    const result = await runAgent({ env, message: "What is Atlas?", sessionId: "s4", mode: "rag" });

    expect(result.output).toBe("Answer after retry.");
    expect(env.AI.run).toHaveBeenCalledTimes(2);
    expect(messagesOf(env, 1).length).toBeLessThan(messagesOf(env, 0).length);
  });

  it("always keeps the system prompt when trimming", async () => {
    const long = "z".repeat(40000);
    const env = makeEnv([contextError(), contextError(), text("ok")]);
    env.store.set(
      "chat:rag:s5",
      Array.from({ length: 8 }, (_, i) => ({ role: "user", content: `${long}${i}` })),
    );

    await runAgent({ env, message: "What is Atlas?", sessionId: "s5", mode: "rag" });

    for (const call of env.AI.run.mock.calls) {
      expect(call[1].messages[0].role).toBe("system");
      expect(call[1].messages[0].content).toContain("document assistant");
    }
  });

  it("gives up after three attempts", async () => {
    const env = makeEnv([contextError()]);

    await expect(runAgent({ env, message: "What is Atlas?", mode: "rag" })).rejects.toThrow("8007");
    expect(env.AI.run).toHaveBeenCalledTimes(3);
  });

  it("does not retry an unrelated error", async () => {
    const env = makeEnv([new Error("3040: usage limit reached")]);

    await expect(runAgent({ env, message: "What is Atlas?", mode: "rag" })).rejects.toThrow("3040");
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });
});
