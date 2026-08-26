const PROTOCOL_VERSION = "2025-06-18";

let toolCache = null;

export const resetToolCache = () => {
  toolCache = null;
};

const rpc = async (env, method, params) => {
  if (!env.MCP_SERVER_URL) throw new Error("MCP_SERVER_URL is not set");

  const headers = { "Content-Type": "application/json" };
  if (env.MCP_AUTH_TOKEN) headers.Authorization = `Bearer ${env.MCP_AUTH_TOKEN}`;

  const init = {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
  };

  const res = env.MCP
    ? await env.MCP.fetch(new Request(env.MCP_SERVER_URL, init))
    : await fetch(env.MCP_SERVER_URL, init);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MCP ${method} failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const payload = await res.json();
  if (payload.error) throw new Error(`MCP ${method}: ${payload.error.message}`);

  return payload.result;
};

const callTool = async (env, name, args) => {
  const result = await rpc(env, "tools/call", { name, arguments: args });

  const text = (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  return text || "Tool returned no content.";
};

export const loadMcpTools = async (env) => {
  if (toolCache) return toolCache;

  await rpc(env, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "trip-planner", version: "1.0.0" },
  });

  const { tools = [] } = await rpc(env, "tools/list", {});

  toolCache = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    handler: (runtimeEnv, args) => callTool(runtimeEnv, tool.name, args),
  }));

  return toolCache;
};
