import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

function AgentCard({ name, status }) {
  const labels = { pending: "Pending", working: "Working...", done: "Done" };
  const icons = { search: "🔍", budget: "💰", itinerary: "🗺️" };

  return (
    <div className={`agentCard agentCard--${status}`}>
      <div className="agentIcon">{icons[name]}</div>
      <div className="agentName">{name.charAt(0).toUpperCase() + name.slice(1)}</div>
      <div className={`agentStatus agentStatus--${status}`}>{labels[status]}</div>
    </div>
  );
}

function DayCard({ day }) {
  const [open, setOpen] = useState(false);
  const periods = [
    { key: "morning", label: "Morning", icon: "🌅" },
    { key: "afternoon", label: "Afternoon", icon: "☀️" },
    { key: "evening", label: "Evening", icon: "🌙" },
  ];

  return (
    <div className={`dayCard ${open ? "dayCard--open" : ""}`}>
      <button className="dayHeader" onClick={() => setOpen(!open)}>
        <span className="dayNumber">Day {day.day}</span>
        <span className="dayTitle">{day.title}</span>
        <span className="dayChevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="dayBody">
          {periods.map(({ key, label, icon }) => {
            const slot = day[key];
            if (!slot) return null;
            return (
              <div key={key} className={`timeSlot timeSlot--${key}`}>
                <div className="timeLabel">
                  <span className="timeIcon">{icon}</span> {label}
                </div>
                <div className="timeActivity">{slot.activity}</div>
                <div className="timeMeta">
                  {slot.location && <span className="timeLocation">{slot.location}</span>}
                  {slot.cost && <span className="timeCost">{slot.cost}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BudgetChart({ budget }) {
  const categories = [
    { key: "accommodation", label: "Accommodation", color: "#10a37f" },
    { key: "food", label: "Food", color: "#38bdf8" },
    { key: "transport", label: "Transport", color: "#a78bfa" },
    { key: "activities", label: "Activities", color: "#fb923c" },
    { key: "misc", label: "Misc", color: "#94a3b8" },
  ];

  const total = budget.total || categories.reduce((s, c) => s + (budget[c.key] || 0), 0);
  const max = Math.max(...categories.map((c) => budget[c.key] || 0), 1);

  return (
    <div className="budgetCard">
      <div className="budgetTitle">Budget Breakdown</div>
      <div className="budgetBars">
        {categories.map(({ key, label, color }) => {
          const val = budget[key] || 0;
          const pct = (val / max) * 100;
          return (
            <div key={key} className="budgetRow">
              <span className="budgetLabel">{label}</span>
              <div className="budgetBarTrack">
                <div className="budgetBarFill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="budgetAmount">${val.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
      <div className="budgetFooter">
        <div className="budgetTotal">
          <span>Total</span>
          <strong>${total.toLocaleString()}</strong>
        </div>
        {budget.perPerson > 0 && (
          <div className="budgetPerPerson">
            <span>Per person</span>
            <strong>${budget.perPerson.toLocaleString()}</strong>
          </div>
        )}
        {budget.verdict && <div className="budgetVerdict">{budget.verdict}</div>}
      </div>
    </div>
  );
}

function TipsList({ title, icon, tips }) {
  const [open, setOpen] = useState(false);
  if (!tips || tips.length === 0) return null;

  return (
    <div className="tipsSection">
      <button className="tipsHeader" onClick={() => setOpen(!open)}>
        <span>{icon} {title}</span>
        <span className="dayChevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="tipsList">
          {tips.map((tip, i) => (
            <li key={i} className="tipItem">{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultView({ data }) {
  if (typeof data === "string") {
    return <div className="resultFallback">{data}</div>;
  }

  return (
    <div className="resultView">
      {/* Overview */}
      <div className="overviewCard">
        <h2 className="overviewTitle">{data.title}</h2>
        <p className="overviewText">{data.overview}</p>
      </div>

      {/* Accommodation */}
      {data.accommodation && (
        <div className="accomCard">
          <div className="accomIcon">🏨</div>
          <div className="accomInfo">
            <div className="accomName">{data.accommodation.name}</div>
            <div className="accomPrice">{data.accommodation.pricePerNight}/night</div>
            {data.accommodation.notes && (
              <div className="accomNotes">{data.accommodation.notes}</div>
            )}
          </div>
        </div>
      )}

      {/* Days */}
      {data.days && data.days.length > 0 && (
        <div className="daysSection">
          <div className="sectionLabel">Itinerary</div>
          {data.days.map((day) => (
            <DayCard key={day.day} day={day} />
          ))}
        </div>
      )}

      {/* Budget */}
      {data.budget && <BudgetChart budget={data.budget} />}

      {/* Tips */}
      <div className="tipsGroup">
        <TipsList title="Transport Tips" icon="🚌" tips={data.transportTips} />
        <TipsList title="Dining Tips" icon="🍜" tips={data.diningTips} />
        <TipsList title="Travel Tips" icon="💡" tips={data.travelTips} />
      </div>
    </div>
  );
}

function App() {
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(7);
  const [budget, setBudget] = useState(2000);
  const [people, setPeople] = useState(2);
  const [planning, setPlanning] = useState(false);
  const [itinerary, setItinerary] = useState(null);
  const [error, setError] = useState(null);
  const [agentStatuses, setAgentStatuses] = useState({
    search: "pending",
    budget: "pending",
    itinerary: "pending",
  });

  const planningRef = useRef(false);
  const esRef = useRef(null);

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    };
  }, []);

  const startPlanning = () => {
    if (!destination.trim() || planning) return;

    setPlanning(true);
    planningRef.current = true;
    setItinerary(null);
    setError(null);
    setAgentStatuses({ search: "pending", budget: "pending", itinerary: "pending" });

    const params = new URLSearchParams({
      destination: destination.trim(),
      days: String(days),
      budget: String(budget),
      people: String(people),
    });

    const es = new EventSource(`${API_URL}/api/trip/stream?${params}`);
    esRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "agent_status") {
        setAgentStatuses((prev) => ({
          ...prev,
          [data.agent]: data.status === "start" ? "working" : "done",
        }));
      } else if (data.type === "result") {
        setItinerary(data.itinerary);
        setPlanning(false);
        planningRef.current = false;
        es.close();
        esRef.current = null;
      } else if (data.type === "error") {
        setError(data.message);
        setPlanning(false);
        planningRef.current = false;
        es.close();
        esRef.current = null;
      }
    };

    es.onerror = () => {
      if (planningRef.current) {
        setError("Connection lost. Please try again.");
        setPlanning(false);
        planningRef.current = false;
      }
      es.close();
      esRef.current = null;
    };
  };

  const reset = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setPlanning(false);
    planningRef.current = false;
    setItinerary(null);
    setError(null);
    setAgentStatuses({ search: "pending", budget: "pending", itinerary: "pending" });
  };

  const anyActive = planning || itinerary !== null;

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appHeaderInner">
          <div className="appTitle">Trip Planner</div>
          <div className="appSubtitle">Multi-agent itinerary planning with LangGraph + MCP</div>
        </div>
      </header>

      <main className="appMain">
        <section className="formPanel">
          <div className="formGrid">
            <div className="formField formField--wide">
              <label className="formLabel">Destination</label>
              <input
                className="formInput"
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Tokyo, Japan"
                disabled={planning}
              />
            </div>
            <div className="formField">
              <label className="formLabel">Days</label>
              <input
                className="formInput"
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                disabled={planning}
              />
            </div>
            <div className="formField">
              <label className="formLabel">Budget (USD)</label>
              <input
                className="formInput"
                type="number"
                min={100}
                step={100}
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                disabled={planning}
              />
            </div>
            <div className="formField">
              <label className="formLabel">Travelers</label>
              <input
                className="formInput"
                type="number"
                min={1}
                max={20}
                value={people}
                onChange={(e) => setPeople(Number(e.target.value))}
                disabled={planning}
              />
            </div>
          </div>
          <div className="formActions">
            <button
              className="planButton"
              onClick={startPlanning}
              disabled={planning || !destination.trim()}
            >
              {planning ? "Planning..." : "Plan Trip"}
            </button>
            {anyActive && (
              <button className="resetButton" onClick={reset} disabled={false}>
                Reset
              </button>
            )}
          </div>
        </section>

        {anyActive && (
          <section className="agentPanel">
            <div className="agentPanelTitle">Agent Status</div>
            <div className="agentGrid">
              <AgentCard name="search" status={agentStatuses.search} />
              <AgentCard name="budget" status={agentStatuses.budget} />
              <AgentCard name="itinerary" status={agentStatuses.itinerary} />
            </div>
          </section>
        )}

        {error && (
          <div className="errorBanner">
            <strong>Error:</strong> {error}
          </div>
        )}

        {itinerary && (
          <section className="resultPanel">
            <ResultView data={itinerary} />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
