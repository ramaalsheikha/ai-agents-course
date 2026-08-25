const MAX_TURNS = 8;
const TTL_SECONDS = 60 * 60 * 24 * 7;

const key = (sessionId, mode) => `chat:${mode}:${sessionId}`;

export const loadHistory = async (env, sessionId, mode) => {
  if (!env.CHAT_HISTORY) return [];

  const raw = await env.CHAT_HISTORY.get(key(sessionId, mode), "json");
  return Array.isArray(raw) ? raw : [];
};

export const saveHistory = async (env, sessionId, mode, messages) => {
  if (!env.CHAT_HISTORY) return;

  const trimmed = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_TURNS);

  await env.CHAT_HISTORY.put(key(sessionId, mode), JSON.stringify(trimmed), {
    expirationTtl: TTL_SECONDS,
  });
};
