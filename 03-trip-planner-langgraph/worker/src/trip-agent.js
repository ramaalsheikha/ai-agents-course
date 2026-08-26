import { loadMcpTools } from "./mcp.js";

const DEFAULT_TEXT_MODEL = "@cf/openai/gpt-oss-120b";
const DEFAULT_JSON_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const MAX_TOOL_ROUNDS = 3;
const MAX_CALLS_PER_ROUND = 2;
const MAX_TOOL_RESULT_CHARS = 2500;
const SEARCH_MAX_TOKENS = 1024;
const BUDGET_MAX_TOKENS = 768;
const ITINERARY_MAX_TOKENS = 4096;

const toText = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join("");

  if (value && typeof value === "object") {
    if (Array.isArray(value.output)) {
      return value.output
        .filter((part) => part.type !== "reasoning")
        .map((part) => toText(part.content ?? part.text ?? ""))
        .filter(Boolean)
        .join("");
    }
    return toText(value.response ?? value.text ?? value.content ?? "");
  }

  return "";
};

const SLOT_SCHEMA = {
  type: "object",
  properties: {
    activity: { type: "string" },
    location: { type: "string" },
    cost: { type: "string" },
  },
  required: ["activity", "location", "cost"],
};

const itinerarySchema = (days) => ({
  type: "object",
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    accommodation: {
      type: "object",
      properties: {
        name: { type: "string" },
        pricePerNight: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name", "pricePerNight", "notes"],
    },
    days: {
      type: "array",
      minItems: days,
      maxItems: days,
      items: {
        type: "object",
        properties: {
          day: { type: "number" },
          title: { type: "string" },
          morning: SLOT_SCHEMA,
          afternoon: SLOT_SCHEMA,
          evening: SLOT_SCHEMA,
        },
        required: ["day", "title", "morning", "afternoon", "evening"],
      },
    },
    budget: {
      type: "object",
      properties: {
        accommodation: { type: "number" },
        food: { type: "number" },
        transport: { type: "number" },
        activities: { type: "number" },
        misc: { type: "number" },
        total: { type: "number" },
        perPerson: { type: "number" },
        verdict: { type: "string" },
      },
      required: [
        "accommodation",
        "food",
        "transport",
        "activities",
        "misc",
        "total",
        "perPerson",
        "verdict",
      ],
    },
    transportTips: { type: "array", items: { type: "string" } },
    diningTips: { type: "array", items: { type: "string" } },
    travelTips: { type: "array", items: { type: "string" } },
  },
  required: [
    "title",
    "overview",
    "accommodation",
    "days",
    "budget",
    "transportTips",
    "diningTips",
    "travelTips",
  ],
});

const toStructured = (value) => {
  if (!value || typeof value !== "object") return null;
  const payload = value.response;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
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

const normalizeToolCalls = (output) =>
  (output?.tool_calls ?? [])
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.name ?? call.function?.name,
      args: parseArgs(call.arguments ?? call.function?.arguments),
    }))
    .filter((call) => Boolean(call.name));

const textModel = (env) => env.TEXT_MODEL || DEFAULT_TEXT_MODEL;
const jsonModel = (env) => env.JSON_MODEL || DEFAULT_JSON_MODEL;

const runTool = async (env, tools, call) => {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return `Unknown tool: ${call.name}`;

  try {
    return await tool.handler(env, call.args);
  } catch (error) {
    return `Tool "${call.name}" failed: ${error.message}`;
  }
};

const SEARCH_SYSTEM_PROMPT = `You are a travel research agent. Use the web_search tool to find current travel information — you must call it before answering, and you may call it more than once for different aspects of the trip.

Report only what the tool returned. Never fill gaps from memory. Write a plain-text briefing covering attractions, hotels with nightly prices, and flight options with prices.`;

async function searchAgent({ env, destination }) {
  const tools = await loadMcpTools(env);
  console.log(`[trip] Search agent MCP tools: ${tools.map((t) => t.name).join(", ")}`);

  const toolSchemas = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  const messages = [
    { role: "system", content: SEARCH_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Find top tourist attractions, recommended hotels, and flight options for ${destination}. Include estimated prices.`,
    },
  ];

  let output;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    output = await env.AI.run(textModel(env), {
      messages,
      tools: toolSchemas,
      max_tokens: SEARCH_MAX_TOKENS,
    });

    const calls = normalizeToolCalls(output).slice(0, MAX_CALLS_PER_ROUND);
    if (calls.length === 0) break;

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

  let searchResults = toText(output).trim();

  if (!searchResults) {
    const synthesis = await env.AI.run(textModel(env), {
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Write the travel briefing now, using the tool results above. Do not call any more tools.",
        },
      ],
      max_tokens: SEARCH_MAX_TOKENS,
    });

    searchResults = toText(synthesis).trim();
  }

  console.log(`[trip] Search results obtained (${searchResults.length} chars)`);
  return searchResults;
}

async function budgetAgent({ env, destination, days, budget, people }) {
  const prompt = `You are a travel budget planning expert. Create a detailed budget breakdown for the following trip:

Destination: ${destination}
Duration: ${days} days
Total Budget: $${budget}
Number of travelers: ${people}

Provide a clear breakdown of estimated costs per person per day for:
- Accommodation
- Food & dining
- Local transportation
- Activities & entrance fees
- Miscellaneous expenses

Then summarize the total estimated cost vs the budget, and note if the budget is sufficient or not.
Be specific with dollar amounts.`;

  const response = await env.AI.run(textModel(env), {
    messages: [{ role: "user", content: prompt }],
    max_tokens: BUDGET_MAX_TOKENS,
  });

  const budgetBreakdown = toText(response).trim();
  console.log(`[trip] Budget breakdown obtained (${budgetBreakdown.length} chars)`);
  return budgetBreakdown;
}

async function itineraryAgent({ env, destination, days, budget, people, searchResults, budgetBreakdown }) {
  const prompt = `You are an expert travel itinerary planner. Create a detailed day-by-day itinerary based on the following information:

**Trip Details:**
- Destination: ${destination}
- Duration: ${days} days
- Total Budget: $${budget}
- Number of travelers: ${people}

**Research Findings:**
${searchResults}

**Budget Breakdown:**
${budgetBreakdown}

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "title": "Trip to [Destination]",
  "overview": "1-2 sentence trip summary",
  "accommodation": {
    "name": "Recommended hotel/hostel name",
    "pricePerNight": "$XX",
    "notes": "Why this is recommended"
  },
  "days": [
    {
      "day": 1,
      "title": "Short theme for the day",
      "morning": { "activity": "What to do", "location": "Where", "cost": "$XX" },
      "afternoon": { "activity": "What to do", "location": "Where", "cost": "$XX" },
      "evening": { "activity": "What to do", "location": "Where", "cost": "$XX" }
    }
  ],
  "budget": {
    "accommodation": 0,
    "food": 0,
    "transport": 0,
    "activities": 0,
    "misc": 0,
    "total": 0,
    "perPerson": 0,
    "verdict": "Under budget / Over budget by $XX"
  },
  "transportTips": ["tip1", "tip2", "tip3"],
  "diningTips": ["tip1", "tip2", "tip3"],
  "travelTips": ["tip1", "tip2", "tip3"]
}

Budget values must be numbers (no $ sign). Include exactly ${days} days. Be specific with real place names and realistic costs.`;

  const runModel = (extra) =>
    env.AI.run(jsonModel(env), {
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: ITINERARY_MAX_TOKENS,
      ...extra,
    });

  let response;

  try {
    response = await runModel({
      response_format: { type: "json_schema", json_schema: itinerarySchema(days) },
    });
  } catch (error) {
    console.error(`[trip] Structured output rejected, retrying unconstrained: ${error.message}`);
    response = await runModel({});
  }

  const structured = toStructured(response);
  if (structured) {
    console.log("[trip] Itinerary generated (structured: true, schema-enforced)");
    return structured;
  }

  const cleaned = toText(response)
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    const itinerary = JSON.parse(cleaned);
    console.log("[trip] Itinerary generated (structured: true)");
    return itinerary;
  } catch {
    console.error("[trip] Failed to parse itinerary JSON, raw:", cleaned.slice(0, 200));
    return cleaned;
  }
}

export async function runTripPlanner({ destination, days, budget, people, env, onProgress }) {
  console.log(
    `[trip] Starting trip planner for: ${destination}, ${days} days, $${budget}, ${people} people`,
  );

  const track = async (agent, work) => {
    onProgress({ agent, status: "start" });
    const result = await work();
    onProgress({ agent, status: "done" });
    return result;
  };

  const settled = await Promise.allSettled([
    track("search", () => searchAgent({ env, destination })),
    track("budget", () => budgetAgent({ env, destination, days, budget, people })),
  ]);

  const failures = settled.filter((outcome) => outcome.status === "rejected");
  if (failures.length > 0) {
    const error = new Error(failures.map((f) => f.reason?.message || String(f.reason)).join("; "));
    error.cause = failures[0].reason;
    throw error;
  }

  const [searchResults, budgetBreakdown] = settled.map((outcome) => outcome.value);

  return track("itinerary", () =>
    itineraryAgent({ env, destination, days, budget, people, searchResults, budgetBreakdown }),
  );
}
