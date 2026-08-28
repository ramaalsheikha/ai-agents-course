import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { runAgent } from "./agent.js";
import { ingestPdf } from "./ingest.js";
import { isAllowedOrigin } from "./cors.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const app = new Hono();

app.use("/api/*", (c, next) =>
  cors({
    origin: (origin) => (isAllowedOrigin(origin, c.env) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })(c, next),
);

app.use("/api/*", async (c, next) => {
  if (!c.env.RATE_LIMITER) return next();

  const ip = c.req.header("cf-connecting-ip") ?? "anonymous";
  const { success } = await c.env.RATE_LIMITER.limit({ key: ip });

  if (!success) return c.json({ error: "Too many requests" }, 429);
  return next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/chat", async (c) => {
  try {
    const { message, sessionId, mode = "rag" } = await c.req.json();

    if (!message) return c.json({ error: "Message required" }, 400);

    const answer = await runAgent({ env: c.env, message, sessionId, mode });

    if (!answer.output) {
      return c.json({ answer: EMPTY_ANSWER, mode: answer.mode });
    }

    return c.json({ answer: answer.output, mode: answer.mode });
  } catch (error) {
    console.error("chat failed", error);
    return c.json({ error: error.message }, 500);
  }
});

const EMPTY_ANSWER =
  "I apologize, but I couldn't generate a proper response. Could you please rephrase your question?";

app.post("/api/chat/stream", async (c) => {
  const { message, sessionId, mode = "rag" } = await c.req.json().catch(() => ({}));

  if (!message) return c.json({ error: "Message required" }, 400);

  c.header("Cache-Control", "no-cache");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    let queue = Promise.resolve();

    const send = (data) => {
      queue = queue
        .catch(() => {})
        .then(() => stream.writeSSE({ data: JSON.stringify(data) }));
      return queue;
    };

    try {
      const answer = await runAgent({
        env: c.env,
        message,
        sessionId,
        mode,
        onLog: (entry) => send({ type: "log", ...entry }),
      });

      await send({
        type: "result",
        answer: answer.output || EMPTY_ANSWER,
        mode: answer.mode,
      });
    } catch (error) {
      console.error("chat stream failed", error);
      await send({
        type: "log",
        ts: Date.now(),
        component: "agent",
        message: `Request failed: ${error.message}`,
        status: "error",
      });
      await send({ type: "error", message: error.message });
    }
  });
});

app.post("/api/ingest", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return c.json({ error: "Missing PDF file" }, 400);
    }

    const isPdf =
      file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
    if (!isPdf) return c.json({ error: "Only PDF files are allowed" }, 400);

    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "File exceeds 25MB limit" }, 413);
    }

    const objectKey = `uploads/${Date.now()}-${crypto.randomUUID()}.pdf`;
    const arrayBuffer = await file.arrayBuffer();

    if (c.env.DOCUMENTS) {
      await c.env.DOCUMENTS.put(objectKey, arrayBuffer, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { originalName: file.name ?? "document.pdf" },
      });
    }

    const result = await ingestPdf(c.env, {
      arrayBuffer,
      source: file.name ?? "document.pdf",
      objectKey,
      force: form.get("force") === "true",
    });

    return c.json({ ok: true, objectKey, ...result });
  } catch (error) {
    console.error("ingest failed", error);
    return c.json({ error: error.message }, 500);
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
