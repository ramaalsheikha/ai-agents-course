import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { isAllowedOrigin } from "../../shared/cors.js";
import { runOrchestration } from "./orchestrate.js";

const app = new Hono();

app.use("/api/*", (c, next) =>
  cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env) ? origin : null),
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })(c, next),
);

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/a2a/stream", async (c) => {
  const destination = c.req.query("destination")?.trim();

  if (!destination) {
    return c.json({ error: "destination is required" }, 400);
  }

  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const send = (data) => stream.writeSSE({ data: JSON.stringify(data) });

    try {
      const itinerary = await runOrchestration({
        env: c.env,
        send,
        destination,
        days: positiveInt(c.req.query("days"), 7),
        budget: positiveInt(c.req.query("budget"), 2000),
        people: positiveInt(c.req.query("people"), 2),
      });

      await send({ type: "result", itinerary });
    } catch (err) {
      console.error("[orchestrator] Error:", err);
      await send({ type: "error", message: err.message });
    }
  });
});

export default app;
