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

const createEmitter = (send) => {
  const log = (component, message, status = "info") =>
    send({ type: "log", ts: Date.now(), component, message, status });

  const replay = (agentName, entries) =>
    entries.reduce(
      (chain, entry) =>
        chain.then(() =>
          send({
            type: "log",
            ts: entry.ts ?? Date.now(),
            component: entry.component ?? "agent",
            message: `${agentName} · ${entry.message}`,
            status: entry.status ?? "info",
          }),
        ),
      Promise.resolve(),
    );

  return { log, replay };
};

const discoverAgents = async (env, send, emit) => {
  await send({
    type: "phase",
    phase: "discovery",
    message: "Discovering agents via agent cards...",
  });
  await emit.log("phase", "Phase → discovery: Discovering agents via agent cards...", "info");

  const cards = await Promise.all(
    AGENTS.map(({ binding }) => fetchAgentCard(serviceFor(env, binding), binding)),
  );

  for (const [index, card] of cards.entries()) {
    const { name } = AGENTS[index];
    await send({ type: "agent_discovered", agentName: name, card });
    await emit.log(
      "discovery",
      `${name} agent card fetched from ${card.url} (${card.skills?.[0]?.name ?? "no skill listed"})`,
      "success",
    );
  }
};

const runTask = async ({ env, send, emit, agentName, binding, prompt }) => {
  const taskId = `task-${crypto.randomUUID()}`;
  const started = Date.now();

  await send({ type: "task_sent", agentName, taskId, status: "working" });
  await emit.log("agent", `Task ${taskId.slice(0, 13)}… sent to ${agentName} agent`, "pending");

  let result;

  try {
    result = await sendTask(serviceFor(env, binding), agentName, taskId, prompt);
  } catch (error) {
    await emit.replay(agentName, error.logs ?? []);
    await emit.log(
      "agent",
      `${agentName} agent failed after ${Date.now() - started}ms: ${error.message}`,
      "error",
    );
    throw error;
  }

  await emit.replay(agentName, result.logs);

  await send({ type: "task_done", agentName, taskId, status: "completed" });
  await emit.log(
    "agent",
    `${agentName} agent completed task ${taskId.slice(0, 13)}… in ${Date.now() - started}ms`,
    "success",
  );

  return result.text;
};

const runParallelTasks = async (env, params, send, emit) => {
  await send({
    type: "phase",
    phase: "parallel",
    message: "Dispatching parallel tasks to search and budget agents...",
  });
  await emit.log(
    "phase",
    "Phase → parallel: Dispatching parallel tasks to search and budget agents...",
    "info",
  );

  const settled = await Promise.allSettled([
    runTask({
      env,
      send,
      emit,
      agentName: "search",
      binding: "SEARCH",
      prompt: buildSearchPrompt(params),
    }),
    runTask({
      env,
      send,
      emit,
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

const runSynthesis = async (env, params, send, emit) => {
  await send({
    type: "phase",
    phase: "synthesis",
    message: "Synthesizing itinerary from search and budget data...",
  });
  await emit.log(
    "synthesis",
    "Phase → synthesis: Combining search and budget results into an itinerary...",
    "info",
  );

  const raw = await runTask({
    env,
    send,
    emit,
    agentName: "itinerary",
    binding: "ITINERARY",
    prompt: buildItineraryPrompt(params),
  });

  return parseItinerary(raw);
};

export const runOrchestration = async ({ env, send, ...params }) => {
  const emit = createEmitter(send);

  await emit.log(
    "orchestrator",
    `Planning ${params.days} days in ${params.destination} for ${params.people} traveler${params.people === 1 ? "" : "s"} on a $${params.budget} budget`,
    "info",
  );

  await discoverAgents(env, send, emit);

  const { searchResults, budgetBreakdown } = await runParallelTasks(env, params, send, emit);

  const itinerary = await runSynthesis(
    env,
    { ...params, searchResults, budgetBreakdown },
    send,
    emit,
  );

  await emit.log(
    "orchestrator",
    typeof itinerary === "string"
      ? "Itinerary received (unstructured text)"
      : `Itinerary received (${itinerary.days?.length ?? 0} days)`,
    "success",
  );

  return itinerary;
};
