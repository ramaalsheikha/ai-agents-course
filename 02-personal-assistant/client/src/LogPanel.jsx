import { useEffect, useId, useRef, useState } from "react";
import { formatLogEntry, formatLogTime } from "./logs";

const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

export function LogPanel({ title = "Activity Log", entries, onClear }) {
  const [open, setOpen] = useState(true);
  const [copyState, setCopyState] = useState("idle");
  const bodyRef = useRef(null);
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [entries, open]);

  useEffect(() => {
    if (copyState === "idle") return undefined;
    const timer = setTimeout(() => setCopyState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [copyState]);

  const copyLogs = async () => {
    try {
      await copyToClipboard(entries.map(formatLogEntry).join("\n"));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const copyLabel =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy";

  return (
    <section className="logPanel">
      <div className="logPanelHeader">
        <button
          type="button"
          className="logPanelToggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          <span className="logPanelChevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="logPanelTitle">{title}</span>
          <span className="logPanelCount">{entries.length}</span>
        </button>
        <div className="logPanelActions">
          <button
            type="button"
            className="logPanelButton"
            onClick={copyLogs}
            disabled={entries.length === 0}
          >
            {copyLabel}
          </button>
          <button
            type="button"
            className="logPanelButton"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      {open && (
        <div className="logPanelBody" id={bodyId} ref={bodyRef} role="log" aria-live="polite">
          {entries.length === 0 ? (
            <div className="logPanelEmpty">No activity yet.</div>
          ) : (
            entries.map((entry, index) => (
              <div key={index} className={`logEntry logEntry--${entry.status}`}>
                <span className="logEntryDot" aria-hidden="true" />
                <span className="logEntryTime">{formatLogTime(entry.ts)}</span>
                <span className="logEntryComponent">[{entry.component}]</span>
                <span className="logEntryMessage">{entry.message}</span>
                <span className="logEntryStatus">{entry.status}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
