import { Hono } from "hono";

const INVALID_REQUEST = -32600;
const INTERNAL_ERROR = -32603;

export const textOf = (params) =>
  params?.message?.parts?.find((part) => part.type === "text")?.text ?? "";

export const createAgentApp = ({ card, label, run }) => {
  const app = new Hono();

  app.get("/.well-known/agent.json", (c) =>
    c.json({ ...card, url: c.env?.AGENT_URL || new URL(c.req.url).origin }),
  );

  app.get("/health", (c) => c.json({ ok: true, agent: card.name }));

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { jsonrpc, method, params } = body;
    const id = body.id ?? null;

    if (jsonrpc !== "2.0" || method !== "tasks/send") {
      return c.json(
        { jsonrpc: "2.0", error: { code: INVALID_REQUEST, message: "Invalid Request" }, id },
        400,
      );
    }

    const taskId = params?.id ?? `task-${crypto.randomUUID()}`;
    const text = textOf(params);

    console.log(`[${label}] Task ${taskId}: ${text.slice(0, 80)}`);

    try {
      const result = await run({ env: c.env, text, taskId });

      return c.json({
        jsonrpc: "2.0",
        result: {
          id: taskId,
          status: { state: "completed" },
          artifacts: [{ name: "result", parts: [{ type: "text", text: result }] }],
        },
        id,
      });
    } catch (err) {
      console.error(`[${label}] Task ${taskId} failed:`, err);
      return c.json(
        { jsonrpc: "2.0", error: { code: INTERNAL_ERROR, message: err.message }, id },
        500,
      );
    }
  });

  return app;
};
