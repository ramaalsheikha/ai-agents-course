import { createAgentApp } from "../../shared/a2a.js";
import { describeTokens, jsonModel, toStructured, toText } from "../../shared/ai.js";

const MAX_TOKENS = 4096;
const DEFAULT_DAYS = 7;

const CARD = {
  name: "Itinerary Agent",
  description:
    "Synthesizes search results and budget breakdowns into a detailed day-by-day travel itinerary.",
  version: "2.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    {
      id: "travel-itinerary",
      name: "Itinerary Synthesis",
      inputModes: ["text"],
      outputModes: ["text"],
    },
  ],
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

export const dayCountOf = (text) => {
  const match = /Duration:\s*(\d+)\s*days?/i.exec(text ?? "");
  const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAYS;
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

const run = async ({ env, text, log }) => {
  const days = dayCountOf(text);

  log("agent", "Itinerary agent received task", "info");
  log("synthesis", `Combining search and budget results into a ${days}-day itinerary...`, "pending");

  const runModel = (extra) =>
    env.AI.run(jsonModel(env), {
      messages: [{ role: "user", content: text }],
      temperature: 0,
      max_tokens: MAX_TOKENS,
      ...extra,
    });

  let response;

  try {
    response = await runModel({
      response_format: { type: "json_schema", json_schema: itinerarySchema(days) },
    });
  } catch (error) {
    console.error(`[itinerary-agent] Structured output rejected, retrying unconstrained: ${error.message}`);
    log("llm", `Structured output rejected, retrying unconstrained: ${error.message}`, "error");
    response = await runModel({});
  }

  log("llm", `Itinerary model returned${describeTokens(response)}`, "success");

  const structured = toStructured(response);
  if (structured) {
    log(
      "synthesis",
      `Itinerary ready (schema-enforced, ${structured.days?.length ?? days} days)`,
      "success",
    );
    return JSON.stringify(structured);
  }

  const itinerary = toText(response)
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  log("synthesis", `Itinerary ready (${itinerary.length} chars, unstructured)`, "success");
  return itinerary;
};

export default createAgentApp({ card: CARD, label: "itinerary-agent", run });
