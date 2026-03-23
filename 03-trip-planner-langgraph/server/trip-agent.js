import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
//import { ChatOllama } from "@langchain/ollama";
import { ChatAnthropic } from "@langchain/anthropic";
import { createAgent } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const TripState = Annotation.Root({
  destination: Annotation({ reducer: (_, v) => v }),
  days: Annotation({ reducer: (_, v) => v }),
  budget: Annotation({ reducer: (_, v) => v }),
  people: Annotation({ reducer: (_, v) => v }),
  searchResults: Annotation({ reducer: (_, v) => v }),
  budgetBreakdown: Annotation({ reducer: (_, v) => v }),
  itinerary: Annotation({ reducer: (_, v) => v }),
});

function wrapWithProgress(name, nodeFn, onProgress) {
  return async (state) => {
    onProgress({ agent: name, status: "start" });
    const result = await nodeFn(state);
    onProgress({ agent: name, status: "done" });
    return result;
  };
}

async function searchNode(state) {
  const { destination } = state;
  // const model = new ChatOllama({
  //   model: "qwen3.5:2b",
  //   temperature: 0,
  //   think: false,
  // });
  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });

  let mcpClient = null;
  try {
    mcpClient = new MultiServerMCPClient({
      mcpServers: {
        "serp-search": {
          transport: "http",
          url: "http://localhost:3002/mcp",
        },
      },
    });

    const tools = await mcpClient.getTools();
    console.log(
      `[trip] Search agent MCP tools: ${tools.map((t) => t.name).join(", ")}`,
    );

    const agent = createAgent({
      model,
      tools,
      systemPrompt: `You are a travel research agent. Use the web_search tool to find travel information. Always call the tool to get current information.`,
    });

    const query = `Find top tourist attractions, recommended hotels, and flight options for ${destination}. Include estimated prices.`;
    const response = await agent.invoke({
      messages: [{ role: "user", content: query }],
    });

    const lastMessage = response.messages[response.messages.length - 1];
    const searchResults = lastMessage?.content || "";
    console.log(
      `[trip] Search results obtained (${searchResults.length} chars)`,
    );

    return { searchResults };
  } finally {
    if (mcpClient) {
      await mcpClient.close().catch(() => undefined);
    }
  }
}

async function budgetNode(state) {
  const { destination, days, budget, people } = state;
  // const model = new ChatOllama({
  //   model: "qwen3.5:2b",
  //   temperature: 0,
  //   think: false,
  // });
  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });

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

  const response = await model.invoke(prompt);
  const budgetBreakdown = response.content || "";
  console.log(
    `[trip] Budget breakdown obtained (${budgetBreakdown.length} chars)`,
  );

  return { budgetBreakdown };
}

async function itineraryNode(state) {
  const { destination, days, budget, people, searchResults, budgetBreakdown } =
    state;
  // const model = new ChatOllama({
  //   model: "qwen3.5:2b",
  //   temperature: 0.3,
  //   think: false,
  // });
  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
  });

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

  const response = await model.invoke(prompt);
  const raw = typeof response.content === "string"
    ? response.content
    : response.content[0]?.text || "";
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let itinerary;
  try {
    itinerary = JSON.parse(cleaned);
  } catch {
    console.error("[trip] Failed to parse itinerary JSON, raw:", cleaned.slice(0, 200));
    itinerary = cleaned;
  }
  console.log(`[trip] Itinerary generated (structured: ${typeof itinerary === "object"})`);

  return { itinerary };
}

function buildGraph(onProgress) {
  const graph = new StateGraph(TripState)
    .addNode("searchAgent", wrapWithProgress("search", searchNode, onProgress))
    .addNode("budgetAgent", wrapWithProgress("budget", budgetNode, onProgress))
    .addNode(
      "itineraryAgent",
      wrapWithProgress("itinerary", itineraryNode, onProgress),
    )
    .addEdge(START, "searchAgent")
    .addEdge(START, "budgetAgent")
    .addEdge("searchAgent", "itineraryAgent")
    .addEdge("budgetAgent", "itineraryAgent")
    .addEdge("itineraryAgent", END);

  return graph.compile();
}

export async function runTripPlanner({
  destination,
  days,
  budget,
  people,
  onProgress,
}) {
  console.log(
    `[trip] Starting trip planner for: ${destination}, ${days} days, $${budget}, ${people} people`,
  );

  const graph = buildGraph(onProgress);

  const finalState = await graph.invoke({
    destination,
    days,
    budget,
    people,
    searchResults: "",
    budgetBreakdown: "",
    itinerary: "",
  });

  return finalState.itinerary;
}
