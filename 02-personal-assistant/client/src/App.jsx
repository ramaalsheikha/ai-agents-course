import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ingestDocument, sendChat } from "./api";
import { toFriendlyMessage } from "./errors";
import "./App.css";

const MODES = ["rag", "api", "mcp"];

const MODE_LABELS = {
  rag: "RAG",
  api: "API",
  mcp: "MCP",
};

const MODE_DESCRIPTIONS = {
  rag: "Searches your uploaded PDFs via the Pinecone knowledge base.",
  api: "Calls SerpAPI directly from the Worker for live web and image results.",
  mcp: "Discovers tools at runtime from the MCP server Worker over JSON-RPC.",
};

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [mode, setMode] = useState("rag");

  const endOfMessagesRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

    try {
      const data = await sendChat({ message: trimmed, mode });

      setMessages((prev) => [
        ...prev,
        { role: "ai", text: data.answer, mode: data.mode ?? mode },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", text: toFriendlyMessage(err), isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const uploadDocument = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadStatus(null);

    try {
      const data = await ingestDocument(selectedFile);

      setUploadStatus({
        text: data.chunks
          ? `Ingested ${data.chunks} chunks from ${selectedFile.name}.`
          : "Uploaded and ingested successfully.",
        isError: false,
      });
      setSelectedFile(null);
    } catch (err) {
      setUploadStatus({ text: toFriendlyMessage(err), isError: true });
    } finally {
      setUploading(false);
    }
  };

  const onComposerKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appHeaderInner">
          <div className="appTitle">Agentic Personal Assistant</div>
          <div className="appSubtitle">Upload PDFs, then chat with your knowledge base.</div>
          <div className="modeToggle">
            {MODES.map((m) => (
              <button
                key={m}
                className={`modeButton modeButton--${m}${mode === m ? " isActive" : ""}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="modeDescription">{MODE_DESCRIPTIONS[mode]}</div>
        </div>
      </header>

      <main className="appMain">
        <section className="uploadPanel">
          <div className="uploadRow">
            <label className="uploadButton" htmlFor="pdf-upload">
              Choose PDF
            </label>
            <input
              id="pdf-upload"
              className="uploadInput"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
            <button
              className="primaryButton"
              onClick={uploadDocument}
              disabled={!selectedFile || uploading}
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <div className="uploadMeta">
              {selectedFile ? selectedFile.name : "No file selected"}
            </div>
          </div>
          {uploadStatus && (
            <div className={`uploadStatus${uploadStatus.isError ? " isError" : ""}`}>
              {uploadStatus.isError && <span className="warningIcon">⚠️</span>}
              {uploadStatus.text}
            </div>
          )}
        </section>

        <section className="chatPanel">
          <div className="messages">
            {messages.length === 0 && (
              <div className="emptyState">
                Upload a PDF to ingest it, then ask a question below.
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "messageRow isUser" : "messageRow isAi"}>
                <div className={`messageBubble${m.isError ? " isError" : ""}`}>
                  {m.role === "ai" && m.mode && !m.isError && (
                    <span className={`modeBadge modeBadge--${m.mode}`}>
                      {MODE_LABELS[m.mode] ?? m.mode}
                    </span>
                  )}
                  {m.isError ? (
                    <div className="errorContent">
                      <span className="warningIcon" role="img" aria-label="Warning">
                        ⚠️
                      </span>
                      <span>{m.text}</span>
                    </div>
                  ) : m.role === "ai" ? (
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="messageRow isAi">
                <div className="messageBubble isTyping">Thinking…</div>
              </div>
            )}
            <div ref={endOfMessagesRef} />
          </div>

          <div className="composer">
            <div className="composerInner">
              <textarea
                className="composerInput"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Message your assistant…"
                rows={1}
              />
              <button
                className="sendButton"
                onClick={sendMessage}
                disabled={loading || !input.trim()}
              >
                Send
              </button>
            </div>
            <div className="composerHint">Enter to send · Shift+Enter for a new line</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
