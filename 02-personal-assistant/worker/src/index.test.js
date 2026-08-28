import { describe, expect, it, vi, beforeEach } from "vitest";

const { runAgent } = vi.hoisted(() => ({ runAgent: vi.fn() }));

vi.mock("./agent.js", () => ({ runAgent }));
vi.mock("./ingest.js", () => ({ ingestPdf: vi.fn() }));

const app = (await import("./index.js")).default;

const chatRequest = (body) =>
  new Request("https://worker.test/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const framesOf = (text) =>
  text
    .split("\n\n")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join(""),
    )
    .filter(Boolean)
    .map((payload) => JSON.parse(payload));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/chat/stream", () => {
  it("streams log events ahead of the result", async () => {
    runAgent.mockImplementation(async ({ onLog }) => {
      onLog({ ts: 1, component: "rag", message: 'Searching Pinecone for "atlas"...', status: "pending" });
      onLog({ ts: 2, component: "rag", message: "Pinecone returned 4 matches", status: "success" });
      return { output: "Atlas is a multi-platform app.", mode: "rag" };
    });

    const res = await app.fetch(chatRequest({ message: "What is Atlas?", mode: "rag" }), {});
    const frames = framesOf(await res.text());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(frames).toEqual([
      { type: "log", ts: 1, component: "rag", message: 'Searching Pinecone for "atlas"...', status: "pending" },
      { type: "log", ts: 2, component: "rag", message: "Pinecone returned 4 matches", status: "success" },
      { type: "result", answer: "Atlas is a multi-platform app.", mode: "rag" },
    ]);
  });

  it("falls back to a friendly answer when the agent returns nothing", async () => {
    runAgent.mockResolvedValue({ output: "", mode: "api" });

    const res = await app.fetch(chatRequest({ message: "hi", mode: "api" }), {});
    const [result] = framesOf(await res.text());

    expect(result.type).toBe("result");
    expect(result.answer).toContain("couldn't generate a proper response");
  });

  it("emits an error log and an error frame when the agent throws", async () => {
    runAgent.mockRejectedValue(new Error("Pinecone unreachable"));

    const res = await app.fetch(chatRequest({ message: "What is Atlas?" }), {});
    const frames = framesOf(await res.text());

    expect(frames.at(-2)).toMatchObject({ type: "log", component: "agent", status: "error" });
    expect(frames.at(-1)).toEqual({ type: "error", message: "Pinecone unreachable" });
  });

  it("rejects a request with no message", async () => {
    const res = await app.fetch(chatRequest({ mode: "rag" }), {});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Message required" });
    expect(runAgent).not.toHaveBeenCalled();
  });
});
