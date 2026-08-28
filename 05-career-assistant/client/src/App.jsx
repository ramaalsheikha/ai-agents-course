import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { LogPanel } from "./LogPanel";
import { useActivityLog } from "./logs";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

function AgentCard({ name, label, status, detail, startTime }) {
  const icons = { resume: "document", market: "briefcase", gap: "chart" };
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== "working" || !startTime) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, startTime]);

  const statusLabel =
    status === "pending" ? "Pending" :
    status === "working" ? `Working... ${elapsed}s` :
    "Done";

  return (
    <div className={`agentCard agentCard--${status}`}>
      <div className="agentIcon"><Icon name={icons[name]} size={22} /></div>
      <div className="agentName">{label}</div>
      <div className={`agentStatus agentStatus--${status}`}>{statusLabel}</div>
      {detail && status === "working" && (
        <div className="agentDetail">{detail}</div>
      )}
    </div>
  );
}

function ScoreRing({ score }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#15803d" : score >= 40 ? "#b45309" : "#dc2626";

  return (
    <div className="scoreRing">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(16, 16, 20, 0.08)" strokeWidth="10" />
        <circle
          cx="65" cy="65" r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 65 65)"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="scoreValue" style={{ color }}>{score}%</div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const colors = { high: "#dc2626", medium: "#b45309", low: "#15803d" };
  return (
    <span className="badge" style={{ background: `${colors[severity]}22`, color: colors[severity], borderColor: `${colors[severity]}44` }}>
      {severity}
    </span>
  );
}

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="sectionHeader" onClick={() => setOpen(!open)}>
        <span className="sectionTitle">{title}</span>
        <span className="sectionChevron">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="sectionBody">{children}</div>}
    </div>
  );
}

function parseJSON(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const cleaned = value.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function EmptyNote({ children }) {
  return <div className="emptyNote">{children}</div>;
}

function ResultView({ data }) {
  const resume = parseJSON(data.resumeAnalysis);
  const market = parseJSON(data.marketResearch);
  const gap = parseJSON(data.gapAnalysis);

  if (!gap) {
    return <div className="errorBanner">Failed to parse analysis results. Please try again.</div>;
  }

  const skillGaps = list(gap.skillGaps);
  const actions = list(gap.actions).filter((a) => list(a.items).length > 0);
  const resources = list(gap.resources);
  const resumeTips = list(gap.resumeTips);
  const achievements = list(resume?.achievements);
  const score = Number.isFinite(gap.readinessScore) ? gap.readinessScore : 0;

  return (
    <div className="resultView">
      <div className="scoreCard">
        <ScoreRing score={score} />
        <div className="scoreInfo">
          <div className="scoreLabel">Readiness Score</div>
          <div className="scoreDescription">
            {gap.readinessLabel || `Scored ${score}% against the sampled postings.`}
          </div>
        </div>
      </div>

      <Section title="Skill Gaps" defaultOpen={true}>
        {skillGaps.length === 0 ? (
          <EmptyNote>
            No skill gap was found against the postings we sampled. Focus on evidence and positioning
            rather than new skills.
          </EmptyNote>
        ) : (
          <div className="gapList">
            {skillGaps.map((g, i) => (
              <div key={i} className="gapItem">
                <div className="gapItemHeader">
                  <span className="gapSkill">{g.skill}</span>
                  <SeverityBadge severity={g.severity} />
                </div>
                {g.note && <div className="gapNote">{g.note}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Action Plan" defaultOpen={true}>
        {actions.length === 0 ? (
          <EmptyNote>No action plan was produced for this run.</EmptyNote>
        ) : (
          actions.map((a, i) => (
            <div key={i} className="actionGroup">
              <div className="actionTimeframe">{a.timeframe}</div>
              <ul className="actionList">
                {list(a.items).map((item, j) => <li key={j}>{item}</li>)}
              </ul>
            </div>
          ))
        )}
      </Section>

      <Section title="Recommended Resources">
        {resources.length === 0 ? (
          <EmptyNote>No resources — nothing to close, since no skill gap was flagged.</EmptyNote>
        ) : (
          <div className="resourceGrid">
            {resources.map((r, i) => (
              <div key={i} className="resourceItem">
                <span className="resourceType">
                  <Icon name={r.type === "course" ? "book" : r.type === "cert" ? "award" : "tool"} size={20} />
                </span>
                <div>
                  <div className="resourceLabel">{r.type}</div>
                  <div className="resourceName">{r.name}</div>
                  {r.skill && <div className="resourceSkill">closes: {r.skill}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Resume Tips">
        {resumeTips.length === 0 ? (
          <EmptyNote>No resume tips were produced for this run.</EmptyNote>
        ) : (
          <ul className="tipList">
            {resumeTips.map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        )}
      </Section>

      {resume && (
        <Section title="Your Profile Summary">
          <div className="profileMeta">
            <span className="profileBadge">{resume.level}</span>
            <span className="profileBadge">{resume.yearsExperience} yrs exp</span>
            <span className="profileBadge">{resume.domain}</span>
          </div>

          {resume.summary && <p className="profileSummary">{resume.summary}</p>}

          <div className="tagSection">
            <div className="tagLabel">Quantified Achievements</div>
            {achievements.length === 0 ? (
              <EmptyNote>
                No measurable results found in the resume. Add numbers — impact, scale, latency,
                revenue.
              </EmptyNote>
            ) : (
              <ul className="achievementList">
                {achievements.map((a, i) => (
                  <li key={i}>
                    {a.metric && <span className="metricChip">{a.metric}</span>}
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="tagSection">
            <div className="tagLabel">Skills</div>
            {list(resume.skills).length === 0 ? (
              <EmptyNote>No skills were extracted from the resume.</EmptyNote>
            ) : (
              <div className="tagCloud">
                {list(resume.skills).map((s, i) => <span key={i} className="tag">{s}</span>)}
              </div>
            )}
          </div>

          {list(resume.strengths).length > 0 && (
            <div className="tagSection">
              <div className="tagLabel">Strengths</div>
              <ul className="tipList">
                {list(resume.strengths).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </Section>
      )}

      {market && (
        <Section title="Market Snapshot">
          <div className="marketRow">
            <div className="marketStat">
              <div className="marketStatLabel">Experience</div>
              <div className="marketStatValue">{market.experienceRange || "N/A"}</div>
            </div>
            <div className="marketStat">
              <div className="marketStatLabel">Salary Range</div>
              <div className="marketStatValue">{market.salaryRange || "N/A"}</div>
            </div>
          </div>

          <div className="marketSource">
            {market.postingsAnalyzed
              ? `Based on ${market.postingsAnalyzed} live posting${market.postingsAnalyzed === 1 ? "" : "s"} matched to your domain.`
              : "No live posting matched this search, so the market figures below are limited."}
          </div>

          <div className="tagSection">
            <div className="tagLabel">Top Required Skills</div>
            {list(market.topSkills).length === 0 ? (
              <EmptyNote>The sampled postings named no repeated skill.</EmptyNote>
            ) : (
              <div className="tagCloud">
                {list(market.topSkills).map((s, i) => (
                  <span key={i} className="tag tag--market">{s}</span>
                ))}
              </div>
            )}
          </div>

          <div className="tagSection">
            <div className="tagLabel">Hiring Companies</div>
            {list(market.topCompanies).length === 0 ? (
              <EmptyNote>
                No employer is listed because none appeared in the postings we fetched.
              </EmptyNote>
            ) : (
              <div className="tagCloud">
                {list(market.topCompanies).map((c, i) => (
                  <span key={i} className="tag tag--company">{c}</span>
                ))}
              </div>
            )}
          </div>

          {list(market.keyTrends).length > 0 && (
            <div className="tagSection">
              <div className="tagLabel">Key Trends</div>
              <ul className="tipList">
                {list(market.keyTrends).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function App() {
  const [resume, setResume] = useState("");
  const [targetMarket, setTargetMarket] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [agentStatuses, setAgentStatuses] = useState({
    resume: { status: "pending", detail: "", startTime: null },
    market: { status: "pending", detail: "", startTime: null },
    gap: { status: "pending", detail: "", startTime: null },
  });
  const { entries: logEntries, append: appendLog, clear: clearLog } = useActivityLog();

  const analyzingRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const initialStatuses = {
    resume: { status: "pending", detail: "", startTime: null },
    market: { status: "pending", detail: "", startTime: null },
    gap: { status: "pending", detail: "", startTime: null },
  };

  const startAnalysis = async () => {
    if (!resume.trim() || !targetMarket.trim() || !targetRole.trim() || analyzing) return;

    setAnalyzing(true);
    analyzingRef.current = true;
    setResult(null);
    setError(null);
    setAgentStatuses(initialStatuses);
    clearLog();

    try {
      const startRes = await fetch(`${API_URL}/api/career/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: resume.trim(),
          targetMarket: targetMarket.trim(),
          targetRole: targetRole.trim(),
        }),
      });
      const { sessionId } = await startRes.json();

      appendLog({
        component: "client",
        message: `Session ${String(sessionId).slice(0, 8)}… opened, streaming pipeline events`,
        status: "info",
      });

      const es = new EventSource(`${API_URL}/api/career/stream?sessionId=${sessionId}`);
      abortRef.current = { abort: () => es.close() };

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "log") {
          appendLog(data);
        } else if (data.type === "agent_status") {
          setAgentStatuses((prev) => ({
            ...prev,
            [data.agent]: {
              status:
                data.status === "start" ? "working" :
                data.status === "working" ? "working" :
                "done",
              detail: data.detail || "",
              startTime:
                data.status === "start" ? Date.now() :
                data.status === "done" ? null :
                prev[data.agent]?.startTime,
            },
          }));
        } else if (data.type === "result") {
          setResult({
            resumeAnalysis: data.resumeAnalysis,
            marketResearch: data.marketResearch,
            gapAnalysis: data.gapAnalysis,
          });
          setAnalyzing(false);
          analyzingRef.current = false;
          es.close();
        } else if (data.type === "error") {
          setError(data.message);
          setAnalyzing(false);
          analyzingRef.current = false;
          es.close();
        }
      };

      es.onerror = () => {
        if (analyzingRef.current) {
          setError("Connection lost. Please try again.");
          appendLog({
            component: "client",
            message: "SSE connection lost before the analysis finished",
            status: "error",
          });
          setAnalyzing(false);
          analyzingRef.current = false;
        }
        es.close();
      };
    } catch (err) {
      setError("Failed to start analysis. Please try again.");
      appendLog({
        component: "client",
        message: `Failed to start analysis: ${err.message}`,
        status: "error",
      });
      setAnalyzing(false);
      analyzingRef.current = false;
    }
  };

  const reset = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setAnalyzing(false);
    analyzingRef.current = false;
    setResult(null);
    setError(null);
    setAgentStatuses(initialStatuses);
    clearLog();
  };

  const anyActive = analyzing || result !== null || logEntries.length > 0;
  const canSubmit = resume.trim() && targetMarket.trim() && targetRole.trim() && !analyzing;

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appHeaderInner">
          <div className="appTitle">Career Assistant</div>
          <div className="appSubtitle">Multi-agent career analysis with LangGraph</div>
        </div>
      </header>

      <main className="appMain">
        <section className="formPanel">
          <div className="formGrid">
            <div className="formField formField--wide">
              <label className="formLabel">Paste Your Resume</label>
              <textarea
                className="formTextarea"
                value={resume}
                onChange={(e) => setResume(e.target.value)}
                placeholder="Paste your résumé text here"
                disabled={analyzing}
                rows={6}
              />
            </div>
            <div className="formField">
              <label className="formLabel">Target Market</label>
              <input
                className="formInput"
                type="text"
                value={targetMarket}
                onChange={(e) => setTargetMarket(e.target.value)}
                placeholder="e.g. UAE, United States"
                disabled={analyzing}
              />
            </div>
            <div className="formField">
              <label className="formLabel">Target Role</label>
              <input
                className="formInput"
                type="text"
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                placeholder="e.g. Senior Data Engineer"
                disabled={analyzing}
              />
            </div>
          </div>
          <div className="formActions">
            <button
              className="analyzeButton"
              onClick={startAnalysis}
              disabled={!canSubmit}
            >
              {analyzing ? "Analyzing..." : "Analyze Career"}
            </button>
            {anyActive && (
              <button className="resetButton" onClick={reset}>
                Reset
              </button>
            )}
          </div>
        </section>

        {anyActive && (
          <section className="agentPanel">
            <div className="agentPanelTitle">Agent Status</div>
            <div className="agentGrid">
              <AgentCard name="resume" label="Resume Analyzer" status={agentStatuses.resume.status} detail={agentStatuses.resume.detail} startTime={agentStatuses.resume.startTime} />
              <AgentCard name="market" label="Market Researcher" status={agentStatuses.market.status} detail={agentStatuses.market.detail} startTime={agentStatuses.market.startTime} />
              <AgentCard name="gap" label="Gap Analyst" status={agentStatuses.gap.status} detail={agentStatuses.gap.detail} startTime={agentStatuses.gap.startTime} />
            </div>
          </section>
        )}

        {anyActive && (
          <LogPanel title="Pipeline Log" entries={logEntries} onClear={clearLog} />
        )}

        {error && (
          <div className="errorBanner">
            <strong>Error:</strong> {error}
          </div>
        )}

        {result && <ResultView data={result} />}
      </main>
    </div>
  );
}

export default App;
