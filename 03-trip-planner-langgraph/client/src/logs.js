import { useCallback, useState } from "react";

const STATUSES = new Set(["info", "pending", "success", "error"]);

const pad = (value, size = 2) => String(value).padStart(size, "0");

export const formatLogTime = (ts) => {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
};

export const formatLogEntry = (entry) =>
  `${formatLogTime(entry.ts)} [${entry.component}] ${entry.message}`;

export const normalizeLogEntry = (entry) => ({
  ts: Number.isFinite(entry?.ts) ? entry.ts : Date.now(),
  component: entry?.component || "system",
  message: entry?.message ?? "",
  status: STATUSES.has(entry?.status) ? entry.status : "info",
});

export function useActivityLog() {
  const [entries, setEntries] = useState([]);

  const append = useCallback((entry) => {
    setEntries((prev) => [...prev, normalizeLogEntry(entry)]);
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, append, clear };
}
