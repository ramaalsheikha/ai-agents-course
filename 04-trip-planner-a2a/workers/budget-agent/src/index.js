import { createAgentApp } from "../../shared/a2a.js";
import { describeTokens, textModel, toText } from "../../shared/ai.js";

const MAX_TOKENS = 768;

const CARD = {
  name: "Budget Agent",
  description:
    "Creates detailed travel budget breakdowns given destination, duration, and total budget.",
  version: "2.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    {
      id: "travel-budget",
      name: "Travel Budget Planning",
      inputModes: ["text"],
      outputModes: ["text"],
    },
  ],
};

const run = async ({ env, text, log }) => {
  log("agent", "Budget agent received task", "info");
  log("llm", `Calculating budget breakdown with ${textModel(env)}...`, "pending");

  const response = await env.AI.run(textModel(env), {
    messages: [{ role: "user", content: text }],
    max_tokens: MAX_TOKENS,
  });

  const breakdown = toText(response).trim();

  log("llm", `Breakdown generated${describeTokens(response)}`, "success");
  log("agent", `Breakdown ready (${breakdown.length} chars)`, "success");

  return breakdown;
};

export default createAgentApp({ card: CARD, label: "budget-agent", run });
