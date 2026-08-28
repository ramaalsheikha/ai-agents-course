import { ApiError, extractErrorCode } from "./errors";
import { stripToolCalls } from "./sanitize";

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const SESSION_KEY = "assistant-session-id";

const EMPTY_ANSWER_FALLBACK =
  "I couldn't put together an answer for that. Could you rephrase the question?";

export const getSessionId = () => {
  let sessionId = localStorage.getItem(SESSION_KEY);

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }

  return sessionId;
};

const logFailure = (path, error) =>
  console.error(`[api] ${path} failed`, {
    status: error.status,
    code: error.code,
    detail: error.detail,
  });

const request = async (path, init) => {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    const apiError = new ApiError({
      message: "Network request failed",
      status: 0,
      detail: error?.message,
    });

    logFailure(path, apiError);
    throw apiError;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error || `Request failed (${response.status})`;

    const apiError = new ApiError({
      message: detail,
      status: response.status,
      code: extractErrorCode(detail),
      detail,
    });

    logFailure(path, apiError);
    throw apiError;
  }

  return data;
};

export const sendChat = async ({ message, mode }) => {
  const data = await request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode, sessionId: getSessionId() }),
  });

  return {
    ...data,
    answer: stripToolCalls(data.answer) || EMPTY_ANSWER_FALLBACK,
  };
};

const parseSseEvents = (buffer, onEvent) => {
  const chunks = buffer.split("\n\n");
  const remainder = chunks.pop() ?? "";

  for (const chunk of chunks) {
    const payload = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");

    if (!payload) continue;

    try {
      onEvent(JSON.parse(payload));
    } catch {
      console.warn("[api] Skipped an unparseable SSE frame");
    }
  }

  return remainder;
};

export const streamChat = async ({ message, mode, onLog }) => {
  const path = "/api/chat/stream";
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, mode, sessionId: getSessionId() }),
    });
  } catch (error) {
    const apiError = new ApiError({
      message: "Network request failed",
      status: 0,
      detail: error?.message,
    });

    logFailure(path, apiError);
    throw apiError;
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data?.error || `Request failed (${response.status})`;

    const apiError = new ApiError({
      message: detail,
      status: response.status,
      code: extractErrorCode(detail),
      detail,
    });

    logFailure(path, apiError);
    throw apiError;
  }

  if (!response.body) {
    return sendChat({ message, mode });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let result = null;
  let failure = null;

  const handleEvent = (event) => {
    if (event.type === "log") {
      onLog?.(event);
    } else if (event.type === "result") {
      result = event;
    } else if (event.type === "error") {
      failure = event.message;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseEvents(buffer, handleEvent);
  }

  parseSseEvents(`${buffer}\n\n`, handleEvent);

  if (failure) {
    const apiError = new ApiError({
      message: failure,
      status: 500,
      code: extractErrorCode(failure),
      detail: failure,
    });

    logFailure(path, apiError);
    throw apiError;
  }

  if (!result) {
    const apiError = new ApiError({
      message: "The response stream ended before an answer arrived",
      status: 0,
    });

    logFailure(path, apiError);
    throw apiError;
  }

  return {
    ...result,
    answer: stripToolCalls(result.answer) || EMPTY_ANSWER_FALLBACK,
  };
};

export const ingestDocument = (file) => {
  const formData = new FormData();
  formData.append("file", file);

  return request("/api/ingest", { method: "POST", body: formData });
};
