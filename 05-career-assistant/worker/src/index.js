import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { runCareerAssistant } from "./career-agent.js";
import { isAllowedOrigin } from "./cors.js";

const app = new Hono();

app.use("/api/*", (c, next) =>
  cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })(c, next),
);

const SESSION_TTL_SECONDS = 600;

app.post("/api/career/start", async (c) => {
  const { resume, targetMarket, targetRole } = await c.req.json();
  if (!resume || !targetMarket || !targetRole) {
    return c.json({ error: "resume, targetMarket, and targetRole are required" }, 400);
  }
  const sessionId = crypto.randomUUID();
  await c.env.SESSIONS.put(
    sessionId,
    JSON.stringify({ resume, targetMarket, targetRole }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );
  return c.json({ sessionId });
});

app.get("/api/career/stream", async (c) => {
  const sessionId = c.req.query("sessionId");
  const session = sessionId
    ? await c.env.SESSIONS.get(sessionId, { type: "json" })
    : null;

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  await c.env.SESSIONS.delete(sessionId);

  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const send = (data) => stream.writeSSE({ data: JSON.stringify(data) });

    try {
      const result = await runCareerAssistant({
        ...session,
        env: c.env,
        onProgress: ({ agent, status, detail }) =>
          send({ type: "agent_status", agent, status, detail }),
      });

      await send({ type: "result", ...result });
    } catch (err) {
      console.error("[career] Error:", err);
      await send({ type: "error", message: err.message });
    }
  });
});

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
