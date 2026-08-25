import { Hono } from "hono";
import { cors } from "hono/cors";
import { runAgent } from "./agent.js";
import { ingestPdf } from "./ingest.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const app = new Hono();

const allowedOrigins = (env) =>
  (env.CLIENT_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use("/api/*", (c, next) => {
  const allowed = allowedOrigins(c.env);

  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })(c, next);
});

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
      return c.json({
        answer:
          "I apologize, but I couldn't generate a proper response. Could you please rephrase your question?",
        mode: answer.mode,
      });
    }

    return c.json({ answer: answer.output, mode: answer.mode });
  } catch (error) {
    console.error("chat failed", error);
    return c.json({ error: error.message }, 500);
  }
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

    const { chunks } = await ingestPdf(c.env, {
      arrayBuffer,
      source: file.name ?? "document.pdf",
      objectKey,
    });

    return c.json({ ok: true, chunks, objectKey });
  } catch (error) {
    console.error("ingest failed", error);
    return c.json({ error: error.message }, 500);
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
