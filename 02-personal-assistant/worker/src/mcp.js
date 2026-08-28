const PROTOCOL_VERSION = "2025-06-18";

const summarizeArgs = (args) => {
  const text = JSON.stringify(args ?? {});
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

const noop = () => {};

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

const callTool = async (env, name, args, log = noop) => {
  log("mcp", `Calling tool: ${name} with ${summarizeArgs(args)}`, "pending");

  const started = Date.now();

  try {
    const result = await rpc(env, "tools/call", { name, arguments: args });

    const text = (result?.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    log(
      "mcp",
      `Tool ${name} returned ${text.length} chars in ${Date.now() - started}ms`,
      "success",
    );

    return text || "Tool returned no content.";
  } catch (error) {
    log("mcp", `Tool ${name} failed: ${error.message}`, "error");
    throw error;
  }
};

export const loadMcpTools = async (env, log = noop) => {
  if (toolCache) {
    log("mcp", `Reusing ${toolCache.length} cached tools from MCP server`, "info");
    return toolCache;
  }

  log("mcp", "Discovering tools from MCP server...", "pending");

  try {
    await rpc(env, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "personal-assistant", version: "1.0.0" },
    });

    const { tools = [] } = await rpc(env, "tools/list", {});

    toolCache = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      handler: (runtimeEnv, args, toolLog) => callTool(runtimeEnv, tool.name, args, toolLog),
    }));

    log(
      "mcp",
      `Discovered ${toolCache.length} tool${toolCache.length === 1 ? "" : "s"}: ${toolCache
        .map((tool) => tool.name)
        .join(", ")}`,
      "success",
    );

    return toolCache;
  } catch (error) {
    log("mcp", `Tool discovery failed: ${error.message}`, "error");
    throw error;
  }
};
