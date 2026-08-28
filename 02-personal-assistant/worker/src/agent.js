import { TOOLS_BY_MODE } from "./tools.js";
import { loadMcpTools } from "./mcp.js";
import { loadHistory, saveHistory } from "./memory.js";
import { isSmallTalk } from "./intent.js";
import { hasArabic } from "../../shared/arabic.js";

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

const noop = () => {};

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

const SHARED_RULES = `If a tool returns nothing relevant, say so plainly instead of reporting unrelated results. Never fill the gap from memory.

When a tool returns markdown image syntax like ![alt](url), you MUST include those exact markdown image tags in your response so the images render for the user. Do not describe or summarize images — pass the markdown through verbatim.`;

const MODE_RULES = {
  rag: `You are a document assistant. The only knowledge you have about the user's documents comes from the search_knowledge_base tool.

Call search_knowledge_base first, every time, before you answer. Do this even when the subject sounds familiar — names in these documents refer to the user's own material, not to anything you may recognise from training. Answering a document question from memory is always wrong.

Each passage is prefixed with its source as [filename, p.N]. Ground every claim in the returned passages and cite the filename you used.`,
  api: `Use the web and image search tools for anything about current events, live data, or images. Answer from the tool output, not from memory.`,
  mcp: `Use the tools discovered from the MCP server for anything about current events, live data, or images. Answer from the tool output, not from memory.`,
};

const LANGUAGE_RULE = `Last rule, and it outranks the others: write your final answer in the language the user asked in. Tool results and documents are often in a different language from the question — translate what you take from them. An Arabic question gets an answer written entirely in Arabic. Only file names and verbatim quotations keep their original script.`;

const buildSystemPrompt = (mode) =>
  `${MODE_RULES[mode] ?? MODE_RULES.api}\n\n${SHARED_RULES}\n\n${LANGUAGE_RULE}`;

const languageDirective = (message) =>
  hasArabic(message)
    ? `The user asked: "${message}" — that question is in Arabic, so write your entire answer in Arabic. The tool results above may be in another language; translate what you take from them. Do not answer in English.`
    : `The user asked: "${message}" — write your entire answer in the language of that question. The tool results above may be in another language; translate what you take from them and do not switch to their language.`;

const withLanguageDirective = (messages, message) => [
  ...messages,
  { role: "user", content: languageDirective(message) },
];

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

const TOOL_CALL_RESIDUE = /<\/?tool_call>|<\/?function_call>|<\/?function>|```(?:json|tool_code)?/gi;

const objectSpans = (text) => {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) spans.push({ start, end: i + 1, body: text.slice(start, i + 1) });
    }
  }

  return spans;
};

const INVALID_ESCAPE = /\\(?!["\\/bfnrtu])/g;

const parseLoose = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse(body.replace(INVALID_ESCAPE, ""));
    } catch {
      return undefined;
    }
  }
};

const asToolCall = (value, id) => {
  if (!value || typeof value !== "object") return null;

  const name = value.name ?? value.function?.name ?? value.tool_name ?? value.tool;
  if (typeof name !== "string") return null;

  const rawArgs =
    value.parameters ?? value.arguments ?? value.args ?? value.input ?? value.function?.arguments;
  if (rawArgs === undefined && value.type !== "function") return null;

  return { id, name, args: parseArgs(rawArgs) };
};

const extractTextToolCalls = (raw, knownNames) => {
  const text = String(raw ?? "");
  const calls = [];
  let cleaned = "";
  let cursor = 0;

  objectSpans(text).forEach((span, index) => {
    const parsed = parseLoose(span.body);
    if (parsed === undefined) return;

    const call = asToolCall(parsed, `text_call_${index}`);
    if (!call || !knownNames.has(call.name)) return;

    calls.push(call);
    cleaned += text.slice(cursor, span.start);
    cursor = span.end;
  });

  cleaned += text.slice(cursor);

  if (calls.length > 0) cleaned = cleaned.replace(TOOL_CALL_RESIDUE, "");

  return { calls, text: cleaned.trim() };
};

const dedupeCalls = (calls) => {
  const seen = new Set();

  return calls.filter((call) => {
    const key = `${call.name}:${JSON.stringify(call.args)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeToolCalls = (output, knownNames) => {
  const structured = (output?.tool_calls ?? [])
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name ?? call.function?.name,
      args: parseArgs(call.arguments ?? call.function?.arguments),
    }))
    .filter((call) => Boolean(call.name));

  const fromText = extractTextToolCalls(toText(output?.response), knownNames);

  return {
    calls: dedupeCalls([...structured, ...fromText.calls]),
    text: fromText.text,
  };
};

const isContextLengthError = (error) => {
  const text = String(error?.message ?? error ?? "");
  return text.includes("8007") || /maximum context length/i.test(text);
};

const tokensOf = (value) => {
  const usage = value?.usage ?? value?.response?.usage;
  const total = usage?.total_tokens ?? usage?.totalTokens;
  return Number.isFinite(total) ? total : null;
};

const describeTokens = (value, messages) => {
  const total = tokensOf(value);
  return total === null ? ` (~${totalTokens(messages)} prompt tokens)` : ` (${total} tokens)`;
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

const RESULT_SEPARATOR = "\n\n---\n\n";

const clampToolResult = (value) => {
  const text = String(value);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;

  const head = text.slice(0, MAX_TOOL_RESULT_CHARS);
  const boundary = head.lastIndexOf(RESULT_SEPARATOR);
  if (boundary > 0) return head.slice(0, boundary);

  const lineBreak = head.lastIndexOf("\n");
  return lineBreak > 0 ? head.slice(0, lineBreak) : head;
};

const runTool = async (env, tools, call, log) => {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    log("agent", `Unknown tool requested: ${call.name}`, "error");
    return `Unknown tool: ${call.name}`;
  }

  try {
    return await tool.handler(env, call.args, log);
  } catch (error) {
    log("agent", `Tool "${call.name}" failed: ${error.message}`, "error");
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

export const runAgent = async ({
  env,
  message,
  sessionId = "default",
  mode = "rag",
  onLog,
}) => {
  if (mode !== "mcp" && !TOOLS_BY_MODE[mode]) throw new Error(`Unknown or unavailable mode: ${mode}`);

  const log = onLog
    ? (component, text, status = "info") => {
        console.log(`[assistant] [${component}] ${text}`);
        onLog({ ts: Date.now(), component, message: text, status });
      }
    : noop;

  const model = env.AI_MODEL || DEFAULT_MODEL;

  log("agent", `Handling message in ${mode.toUpperCase()} mode`, "info");

  const history = await loadHistory(env, sessionId, mode);
  log("memory", `Loaded ${history.length} prior message${history.length === 1 ? "" : "s"}`, "info");

  if (isSmallTalk(message)) {
    log("llm", "Small talk detected, answering without tools...", "pending");

    const smallTalkAnswer =
      (await answerSmallTalk({ env, model, message, history })) ||
      "Hello! How can I help you today?";

    log("llm", `Reply generated (${smallTalkAnswer.length} chars)`, "success");

    await saveHistory(env, sessionId, mode, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: smallTalkAnswer },
    ]);

    return { output: smallTalkAnswer, mode };
  }

  const tools = mode === "mcp" ? await loadMcpTools(env, log) : TOOLS_BY_MODE[mode];
  if (!tools || tools.length === 0) throw new Error(`Unknown or unavailable mode: ${mode}`);

  if (mode !== "mcp") {
    log("agent", `Loaded ${tools.length} local tools: ${tools.map((t) => t.name).join(", ")}`, "info");
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(mode) },
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

  const toolNames = new Set(tools.map((tool) => tool.name));

  let answerText = "";
  let usedTools = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    log("llm", `Generating response with ${model} (round ${round + 1})...`, "pending");

    const output = await runModel(env, model, {
      messages: usedTools ? withLanguageDirective(messages, message) : messages,
      tools: toolSchemas,
      maxTokens: MAX_TOKENS,
    });

    const parsed = normalizeToolCalls(output, toolNames);
    answerText = parsed.text;

    const calls = parsed.calls.slice(0, MAX_CALLS_PER_ROUND);

    log(
      "llm",
      `Round ${round + 1} returned ${calls.length} tool call${calls.length === 1 ? "" : "s"}${describeTokens(output, messages)}`,
      "success",
    );

    if (calls.length === 0) break;

    messages.push({
      role: "assistant",
      content: answerText,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
    });

    usedTools = true;

    const results = await Promise.all(
      calls.map(async (call) => ({ call, content: await runTool(env, tools, call, log) })),
    );

    for (const { call, content } of results) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: clampToolResult(content),
      });
    }
  }

  let answer = answerText.trim();

  if (!answer) {
    log("llm", "Empty draft, forcing a final answer pass...", "pending");

    const synthesis = await runModel(env, model, {
      messages: [
        ...messages,
        {
          role: "user",
          content: `Answer my original question now, using the tool results above. Reply with the final answer only. Do not call any more tools. ${languageDirective(message)}`,
        },
      ],
      maxTokens: MAX_TOKENS,
    });

    answer = extractTextToolCalls(toText(synthesis?.response), toolNames).text;
  }

  if (answer) {
    await saveHistory(env, sessionId, mode, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: answer },
    ]);
    log("agent", `Answer ready (${answer.length} chars)`, "success");
  } else {
    log("agent", "The model produced no answer text", "error");
  }

  return { output: answer, mode };
};
