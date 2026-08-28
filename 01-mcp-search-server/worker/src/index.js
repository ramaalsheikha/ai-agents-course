const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "serp-search-mcp", version: "1.0.0" };
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

const searchSerpApi = async (env, engine, q, num = 5) => {
  if (!env.SERPAPI_API_KEY) throw new Error("SERPAPI_API_KEY is not set");

  const params = new URLSearchParams({
    q,
    engine,
    num: String(num),
    api_key: env.SERPAPI_API_KEY,
  });

  const res = await fetch(`${SERPAPI_ENDPOINT}?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SerpAPI error ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json();
};

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search the web using SerpAPI (Google). Use this to find current information on any topic.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"],
    },
    run: async (env, { query }) => {
      const data = await searchSerpApi(env, "google", query);

      return (
        (data.organic_results ?? [])
          .slice(0, 5)
          .map((r) => `**${r.title}**\n${r.link}\n${r.snippet ?? ""}`)
          .join("\n\n---\n\n") || "No results found."
      );
    },
  },
  {
    name: "image_search",
    description:
      "Search for images using SerpAPI (Google Images). Use this to find images on any topic.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "The image search query" } },
      required: ["query"],
    },
    run: async (env, { query }) => {
      const data = await searchSerpApi(env, "google_images", query);

      return (
        (data.images_results ?? [])
          .slice(0, 5)
          .map(
            (r) =>
              `![${r.title ?? "Image"}](${r.original})${r.source ? `\n_Source: ${r.source}_` : ""}`,
          )
          .join("\n\n---\n\n") || "No image results found."
      );
    },
  },
];

const jsonRpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

const jsonRpcError = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const handleMessage = async (env, message) => {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${params?.name}`);

      try {
        const text = await tool.run(env, params.arguments ?? {});
        return jsonRpcResult(id, { content: [{ type: "text", text }] });
      } catch (error) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `Tool failed: ${error.message}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
};

const isAuthorized = (request, env) => {
  if (!env.MCP_AUTH_TOKEN) {
    console.error("MCP_AUTH_TOKEN is not set — refusing every request");
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${env.MCP_AUTH_TOKEN}`;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, server: SERVER_INFO.name });
    }

    if (url.pathname !== "/mcp") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!isAuthorized(request, env)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
    }

    if (Array.isArray(body)) {
      const responses = (
        await Promise.all(body.map((msg) => (msg.id === undefined ? null : handleMessage(env, msg))))
      ).filter(Boolean);

      return responses.length === 0
        ? new Response(null, { status: 202 })
        : Response.json(responses);
    }

    if (body.id === undefined) return new Response(null, { status: 202 });

    return Response.json(await handleMessage(env, body));
  },
};
