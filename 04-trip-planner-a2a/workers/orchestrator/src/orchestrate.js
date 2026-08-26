import { fetchAgentCard, sendTask } from "./a2a-client.js";
import { buildBudgetPrompt, buildItineraryPrompt, buildSearchPrompt } from "./prompts.js";

const AGENTS = [
  { name: "search", binding: "SEARCH" },
  { name: "budget", binding: "BUDGET" },
  { name: "itinerary", binding: "ITINERARY" },
];

const serviceFor = (env, binding) => {
  const service = env[binding];
  if (!service) throw new Error(`Service binding ${binding} is not configured`);
  return service;
};

const parseItinerary = (raw) => {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("[orchestrator] Failed to parse itinerary JSON, raw:", cleaned.slice(0, 200));
    return cleaned;
  }
};

const discoverAgents = async (env, send) => {
  await send({
    type: "phase",
    phase: "discovery",
    message: "Discovering agents via agent cards...",
  });

  const cards = await Promise.all(
    AGENTS.map(({ binding }) => fetchAgentCard(serviceFor(env, binding), binding)),
  );

  for (const [index, card] of cards.entries()) {
    await send({ type: "agent_discovered", agentName: AGENTS[index].name, card });
  }
};

const runTask = async ({ env, send, agentName, binding, prompt }) => {
  const taskId = `task-${crypto.randomUUID()}`;
  await send({ type: "task_sent", agentName, taskId, status: "working" });

  const result = await sendTask(serviceFor(env, binding), agentName, taskId, prompt);

  await send({ type: "task_done", agentName, taskId, status: "completed" });
  return result;
};

const runParallelTasks = async (env, params, send) => {
  await send({
    type: "phase",
    phase: "parallel",
    message: "Dispatching parallel tasks to search and budget agents...",
  });

  const settled = await Promise.allSettled([
    runTask({
      env,
      send,
      agentName: "search",
      binding: "SEARCH",
      prompt: buildSearchPrompt(params),
    }),
    runTask({
      env,
      send,
      agentName: "budget",
      binding: "BUDGET",
      prompt: buildBudgetPrompt(params),
    }),
  ]);

  const failures = settled.filter((outcome) => outcome.status === "rejected");
  if (failures.length > 0) {
    const error = new Error(
      failures.map((f) => f.reason?.message || String(f.reason)).join("; "),
    );
    error.cause = failures[0].reason;
    throw error;
  }

  const [searchResults, budgetBreakdown] = settled.map((outcome) => outcome.value);
  return { searchResults, budgetBreakdown };
};

const runSynthesis = async (env, params, send) => {
  await send({
    type: "phase",
    phase: "synthesis",
    message: "Synthesizing itinerary from search and budget data...",
  });

  const raw = await runTask({
    env,
    send,
    agentName: "itinerary",
    binding: "ITINERARY",
    prompt: buildItineraryPrompt(params),
  });

  return parseItinerary(raw);
};

export const runOrchestration = async ({ env, send, ...params }) => {
  await discoverAgents(env, send);

  const { searchResults, budgetBreakdown } = await runParallelTasks(env, params, send);

  return runSynthesis(env, { ...params, searchResults, budgetBreakdown }, send);
};
