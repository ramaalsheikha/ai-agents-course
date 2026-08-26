const AGENT_BASE_URL = "https://agent.internal";

export const fetchAgentCard = async (service, agentName) => {
  const res = await service.fetch(new Request(`${AGENT_BASE_URL}/.well-known/agent.json`));

  if (!res.ok) {
    throw new Error(`Failed to fetch agent card from ${agentName}: ${res.status}`);
  }

  return res.json();
};

export const sendTask = async (service, agentName, taskId, text) => {
  const res = await service.fetch(
    new Request(AGENT_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tasks/send",
        params: {
          id: taskId,
          message: { role: "user", parts: [{ type: "text", text }] },
        },
        id: `rpc-${crypto.randomUUID()}`,
      }),
    }),
  );

  const body = await res.json().catch(() => null);

  if (body?.error) throw new Error(`${agentName}: ${body.error.message}`);
  if (!res.ok) throw new Error(`${agentName} returned ${res.status}`);

  return body?.result?.artifacts?.[0]?.parts?.[0]?.text ?? "";
};
