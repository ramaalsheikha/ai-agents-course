import "dotenv/config";
import express from "express";
import cors from "cors";
import { runCareerAssistant } from "./career-agent.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Store pending analysis requests by session ID
const sessions = new Map();

// Step 1: Client POSTs data, gets a session ID back
app.post("/api/career/start", (req, res) => {
  const { resume, targetMarket, targetRole } = req.body;
  if (!resume || !targetMarket || !targetRole) {
    return res.status(400).json({ error: "resume, targetMarket, and targetRole are required" });
  }
  const sessionId = Math.random().toString(36).slice(2);
  sessions.set(sessionId, { resume, targetMarket, targetRole });
  res.json({ sessionId });
});

// Step 2: Client connects via GET EventSource to stream results
app.get("/api/career/stream", async (req, res) => {
  const { sessionId } = req.query;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  sessions.delete(sessionId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  req.on("close", () => { closed = true; });
  const sendEvent = (data) => {
    if (!closed) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const onProgress = ({ agent, status, detail }) => {
      sendEvent({ type: "agent_status", agent, status, detail });
    };

    const result = await runCareerAssistant({
      ...session,
      onProgress,
    });

    sendEvent({ type: "result", ...result });
  } catch (err) {
    console.error("[career] Error:", err);
    sendEvent({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

app.listen(3001, () => console.log("[career] Server running on port 3001"));
