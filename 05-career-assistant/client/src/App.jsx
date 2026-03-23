import { useEffect, useRef, useState } from "react";
import "./App.css";

function AgentCard({ name, label, status, detail, startTime }) {
  const icons = { resume: "📄", market: "🔍", gap: "🎯" };
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
      <div className="agentIcon">{icons[name]}</div>
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
  const color = score >= 70 ? "#07DCA6" : score >= 40 ? "#F9E663" : "#ef4444";

  return (
    <div className="scoreRing">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
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
  const colors = { high: "#ef4444", medium: "#F9E663", low: "#07DCA6" };
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

function parseJSON(str) {
  try {
    const cleaned = str.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function ResultView({ data }) {
  const resume = parseJSON(data.resumeAnalysis);
  const market = parseJSON(data.marketResearch);
  const gap = parseJSON(data.gapAnalysis);

  if (!gap) {
    return <div className="errorBanner">Failed to parse analysis results. Please try again.</div>;
  }

  return (
    <div className="resultView">
      {/* Hero: Score */}
      <div className="scoreCard">
        <ScoreRing score={gap.readinessScore} />
        <div className="scoreInfo">
          <div className="scoreLabel">Readiness Score</div>
          <div className="scoreDescription">{gap.readinessLabel}</div>
        </div>
      </div>

      {/* Skill Gaps */}
      <Section title="Skill Gaps" defaultOpen={true}>
        <div className="gapList">
          {gap.skillGaps.map((g, i) => (
            <div key={i} className="gapItem">
              <div className="gapItemHeader">
                <span className="gapSkill">{g.skill}</span>
                <SeverityBadge severity={g.severity} />
              </div>
              <div className="gapNote">{g.note}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Action Plan */}
      <Section title="Action Plan" defaultOpen={true}>
        {gap.actions.map((a, i) => (
          <div key={i} className="actionGroup">
            <div className="actionTimeframe">{a.timeframe}</div>
            <ul className="actionList">
              {a.items.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          </div>
        ))}
      </Section>

      {/* Resources */}
      <Section title="Recommended Resources">
        <div className="resourceGrid">
          {gap.resources.map((r, i) => (
            <div key={i} className="resourceItem">
              <span className="resourceType">{r.type === "course" ? "📚" : r.type === "cert" ? "🏆" : "🛠️"}</span>
              <div>
                <div className="resourceLabel">{r.type}</div>
                <div className="resourceName">{r.name}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Resume Tips */}
      <Section title="Resume Tips">
        <ul className="tipList">
          {gap.resumeTips.map((tip, i) => <li key={i}>{tip}</li>)}
        </ul>
      </Section>

      {/* Your Profile (from resume analyzer) */}
      {resume && (
        <Section title="Your Profile Summary">
          <div className="profileMeta">
            <span className="profileBadge">{resume.level}</span>
            <span className="profileBadge">{resume.yearsExperience} yrs exp</span>
            <span className="profileBadge">{resume.domain}</span>
          </div>
          <div className="tagSection">
            <div className="tagLabel">Skills</div>
            <div className="tagCloud">
              {resume.skills.map((s, i) => <span key={i} className="tag">{s}</span>)}
            </div>
          </div>
          <div className="tagSection">
            <div className="tagLabel">Strengths</div>
            <ul className="tipList">{resume.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        </Section>
      )}

      {/* Market Snapshot */}
      {market && (
        <Section title="Market Snapshot">
          <div className="marketRow">
            <div className="marketStat">
              <div className="marketStatLabel">Experience</div>
              <div className="marketStatValue">{market.experienceRange}</div>
            </div>
            <div className="marketStat">
              <div className="marketStatLabel">Salary Range</div>
              <div className="marketStatValue">{market.salaryRange}</div>
            </div>
          </div>
          <div className="tagSection">
            <div className="tagLabel">Top Required Skills</div>
            <div className="tagCloud">
              {market.topSkills.map((s, i) => <span key={i} className="tag tag--market">{s}</span>)}
            </div>
          </div>
          <div className="tagSection">
            <div className="tagLabel">Hiring Companies</div>
            <div className="tagCloud">
              {market.topCompanies.map((c, i) => <span key={i} className="tag tag--company">{c}</span>)}
            </div>
          </div>
          <div className="tagSection">
            <div className="tagLabel">Key Trends</div>
            <ul className="tipList">{market.keyTrends.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
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

    try {
      const startRes = await fetch("http://localhost:3001/api/career/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: resume.trim(),
          targetMarket: targetMarket.trim(),
          targetRole: targetRole.trim(),
        }),
      });
      const { sessionId } = await startRes.json();

      const es = new EventSource(`http://localhost:3001/api/career/stream?sessionId=${sessionId}`);
      abortRef.current = { abort: () => es.close() };

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "agent_status") {
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
          setAnalyzing(false);
          analyzingRef.current = false;
        }
        es.close();
      };
    } catch (err) {
      setError("Failed to start analysis. Please try again.");
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
  };

  const anyActive = analyzing || result !== null;
  const canSubmit = resume.trim() && targetMarket.trim() && targetRole.trim() && !analyzing;

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appHeaderInner">
          <div className="appTitle">AI Career Assistant</div>
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
                placeholder="Paste your resume text here..."
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
