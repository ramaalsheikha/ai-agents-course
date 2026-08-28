import { createAgentApp } from "../../shared/a2a.js";
import { loadMcpTools } from "../../shared/mcp.js";
import { describeTokens, textModel, toText } from "../../shared/ai.js";

const MAX_TOOL_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 2;
const MAX_TOOL_RESULT_CHARS = 2500;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `You are a travel research agent. Use the web_search tool to find current travel information — you must call it before answering, and you may call it more than once for different aspects of the trip.

Report only what the tool returned. Never fill gaps from memory. Write a plain-text briefing covering attractions, hotels with nightly prices, and flight options with prices.`;

const CARD = {
  name: "Search Agent",
  description:
    "Searches the web for travel information including attractions, hotels, and flight options using real-time data.",
  version: "2.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    {
      id: "travel-search",
      name: "Travel Research",
      inputModes: ["text"],
      outputModes: ["text"],
    },
  ],
};

const parseArgs = (raw) => {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const rawToolCalls = (output) =>
  output?.tool_calls ?? output?.choices?.[0]?.message?.tool_calls ?? [];

const normalizeToolCalls = (output) =>
  rawToolCalls(output)
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name ?? call.function?.name,
      args: parseArgs(call.arguments ?? call.function?.arguments),
    }))
    .filter((call) => Boolean(call.name));

const runTool = async (env, tools, call, log) => {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    log("mcp", `Unknown tool requested: ${call.name}`, "error");
    return `Unknown tool: ${call.name}`;
  }

  try {
    return await tool.handler(env, call.args, log);
  } catch (error) {
    return `Tool "${call.name}" failed: ${error.message}`;
  }
};

const run = async ({ env, text, log }) => {
  log("agent", "Search agent received task", "info");

  const tools = await loadMcpTools(env, log);

  const toolSchemas = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: text },
  ];

  let output;
  let searchCalls = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    log("llm", `Generating with ${textModel(env)} (round ${round + 1})...`, "pending");

    output = await env.AI.run(textModel(env), {
      messages,
      tools: toolSchemas,
      max_tokens: MAX_TOKENS,
    });

    const calls = normalizeToolCalls(output).slice(0, MAX_CALLS_PER_ROUND);

    log(
      "llm",
      `Round ${round + 1} returned ${calls.length} tool call${calls.length === 1 ? "" : "s"}${describeTokens(output)}`,
      "success",
    );

    if (calls.length === 0) break;

    searchCalls += calls.length;

    messages.push({
      role: "assistant",
      content: toText(output),
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    });

    const results = await Promise.all(
      calls.map(async (call) => ({ call, content: await runTool(env, tools, call, log) })),
    );

    for (const { call, content } of results) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: String(content).slice(0, MAX_TOOL_RESULT_CHARS),
      });
    }
  }

  let briefing = toText(output).trim();

  if (!briefing) {
    log("llm", "Empty draft, forcing a final briefing pass...", "pending");

    const synthesis = await env.AI.run(textModel(env), {
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Write the travel briefing now, using the tool results above. Do not call any more tools.",
        },
      ],
      max_tokens: MAX_TOKENS,
    });

    briefing = toText(synthesis).trim();
  }

  log(
    "agent",
    `Briefing ready — ${searchCalls} search${searchCalls === 1 ? "" : "es"} run, ${briefing.length} chars`,
    "success",
  );
  return briefing;
};

export default createAgentApp({ card: CARD, label: "search-agent", run });
