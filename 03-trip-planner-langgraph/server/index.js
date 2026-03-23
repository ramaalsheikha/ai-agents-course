import "dotenv/config";
import express from "express";
import cors from "cors";
import { runTripPlanner } from "./trip-agent.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/trip/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let closed = false;
  req.on("close", () => { closed = true; });
  const sendEvent = (data) => { if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  const { destination, days, budget, people } = req.query;

  if (!destination) {
    sendEvent({ type: "error", message: "destination is required" });
    res.end();
    return;
  }

  try {
    const onProgress = ({ agent, status }) => {
      sendEvent({ type: "agent_status", agent, status });
    };

    const itinerary = await runTripPlanner({
      destination,
      days: parseInt(days, 10) || 7,
      budget: parseInt(budget, 10) || 2000,
      people: parseInt(people, 10) || 2,
      onProgress,
    });

    sendEvent({ type: "result", itinerary });
  } catch (err) {
    console.error("[langgraph] Error:", err);
    sendEvent({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

app.listen(3001, () => console.log("[langgraph] Server running on port 3001"));
