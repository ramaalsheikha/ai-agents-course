import { TOOLS_BY_MODE } from "./tools.js";
import { loadMcpTools } from "./mcp.js";
import { loadHistory, saveHistory } from "./memory.js";
import { isSmallTalk } from "./intent.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_TOOL_ROUNDS = 3;
const MAX_TOKENS = 1024;
const MAX_TOOL_RESULT_CHARS = 2500;
const MAX_CALLS_PER_ROUND = 2;
const MODEL_CONTEXT_TOKENS = 24000;
const CONTEXT_MARGIN_TOKENS = 1500;
const MAX_INPUT_TOKENS = MODEL_CONTEXT_TOKENS - MAX_TOKENS - CONTEXT_MARGIN_TOKENS;
const CONTEXT_RETRIES = 3;
const CONTEXT_BACKOFF = 0.6;
const SMALL_TALK_MAX_TOKENS = 160;
const SMALL_TALK_HISTORY_MESSAGES = 4;

const estimateTokens = (value) => Math.ceil(JSON.stringify(value ?? "").length / 3.5);

const totalTokens = (messages) =>
  messages.reduce((sum, message) => sum + estimateTokens(message), 0);

const trimToBudget = (messages, budget = MAX_INPUT_TOKENS) => {
  const [system, ...rest] = messages;
  const kept = [...rest];

  while (kept.length > 1 && estimateTokens(system) + totalTokens(kept) > budget) {
    kept.shift();
    while (kept.length > 1 && kept[0].role === "tool") kept.shift();
  }

  return [system, ...kept];
};

const SYSTEM_PROMPT = `You are a helpful AI assistant with access to tools.

Call a tool when the user asks for information you do not already have: facts from the uploaded documents, current events, web results, or images. Answer from the tool output, not from memory.

Do not call a tool for greetings, thanks, farewells, small talk, or questions about who you are and what you can do. Reply to those directly in one or two short sentences, in the same language the user wrote in, and never quote document or search content in them.

If a tool returns nothing relevant, say so plainly instead of reporting unrelated results.

When a tool returns markdown image syntax like ![alt](url), you MUST include those exact markdown image tags in your response so the images render for the user. Do not describe or summarize images — pass the markdown through verbatim.`;

const SMALL_TALK_PROMPT = `You are a helpful AI assistant. The user is greeting you or making small talk. Reply in one or two short, friendly sentences, in the same language they used. Do not mention documents, search results, or tool output. If they ask what you can do, briefly say you can answer questions about uploaded documents and search the web.`;

const toText = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("");
  if (value && typeof value === "object") {
    return toText(value.response ?? value.text ?? value.content ?? "");
  }
  return "";
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

const normalizeToolCalls = (output) => {
  const calls = output?.tool_calls ?? [];

  return calls
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name ?? call.function?.name,
      args: parseArgs(call.arguments ?? call.function?.arguments),
    }))
    .filter((call) => Boolean(call.name));
};

const isContextLengthError = (error) => {
  const text = String(error?.message ?? error ?? "");
  return text.includes("8007") || /maximum context length/i.test(text);
};

const runModel = async (env, model, { messages, tools, maxTokens }) => {
  let budget = MAX_INPUT_TOKENS;
  let lastError;

  for (let attempt = 0; attempt < CONTEXT_RETRIES; attempt += 1) {
    try {
      return await env.AI.run(model, {
        messages: trimToBudget(messages, budget),
        ...(tools ? { tools } : {}),
        max_tokens: maxTokens,
      });
    } catch (error) {
      if (!isContextLengthError(error)) throw error;

      lastError = error;
      budget = Math.floor(budget * CONTEXT_BACKOFF);
      console.warn(`context overflow, retrying with budget ${budget}`);
    }
  }

  throw lastError;
};

const runTool = async (env, tools, call) => {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `Unknown tool: ${call.name}`;

  try {
    return await tool.handler(env, call.args);
  } catch (error) {
    return `Tool "${call.name}" failed: ${error.message}`;
  }
};

const answerSmallTalk = async ({ env, model, message, history }) => {
  const reply = await runModel(env, model, {
    messages: [
      { role: "system", content: SMALL_TALK_PROMPT },
      ...history.slice(-SMALL_TALK_HISTORY_MESSAGES),
      { role: "user", content: message },
    ],
    maxTokens: SMALL_TALK_MAX_TOKENS,
  });

  return toText(reply?.response).trim();
};

export const runAgent = async ({ env, message, sessionId = "default", mode = "rag" }) => {
  if (mode !== "mcp" && !TOOLS_BY_MODE[mode]) throw new Error(`Unknown or unavailable mode: ${mode}`);

  const model = env.AI_MODEL || DEFAULT_MODEL;
  const history = await loadHistory(env, sessionId, mode);

  if (isSmallTalk(message)) {
    const smallTalkAnswer =
      (await answerSmallTalk({ env, model, message, history })) ||
      "Hello! How can I help you today?";

    await saveHistory(env, sessionId, mode, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: smallTalkAnswer },
    ]);

    return { output: smallTalkAnswer, mode };
  }

  const tools = mode === "mcp" ? await loadMcpTools(env) : TOOLS_BY_MODE[mode];
  if (!tools || tools.length === 0) throw new Error(`Unknown or unavailable mode: ${mode}`);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  const toolSchemas = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  let output;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    output = await runModel(env, model, {
      messages,
      tools: toolSchemas,
      maxTokens: MAX_TOKENS,
    });

    const calls = normalizeToolCalls(output).slice(0, MAX_CALLS_PER_ROUND);
    if (calls.length === 0) break;

    messages.push({
      role: "assistant",
      content: toText(output.response),
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    });

    const results = await Promise.all(
      calls.map(async (call) => ({ call, content: await runTool(env, tools, call) })),
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

  let answer = toText(output?.response).trim();

  if (!answer) {
    const synthesis = await runModel(env, model, {
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Answer my original question now, using the tool results above. Reply with the final answer only. Do not call any more tools.",
        },
      ],
      maxTokens: MAX_TOKENS,
    });

    answer = toText(synthesis?.response).trim();
  }

  if (answer) {
    await saveHistory(env, sessionId, mode, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: answer },
    ]);
  }

  return { output: answer, mode };
};
