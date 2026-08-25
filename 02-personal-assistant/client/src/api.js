import { ApiError, extractErrorCode } from "./errors";

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const SESSION_KEY = "assistant-session-id";

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

export const sendChat = ({ message, mode }) =>
  request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode, sessionId: getSessionId() }),
  });

export const ingestDocument = (file) => {
  const formData = new FormData();
  formData.append("file", file);

  return request("/api/ingest", { method: "POST", body: formData });
};
