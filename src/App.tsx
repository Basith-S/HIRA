import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AnomalyReport, BaselineResult, TrafficSpike, FailedLogins } from "./types/schemas";
import "./App.css";

// ─────────────────────────────────────────────────────────────
// Mock payloads for each session — these simulate the raw
// anomaly data that would arrive from a real detection pipeline
// ─────────────────────────────────────────────────────────────

const MOCK_SESSIONS: AnomalyReport[] = [
  {
    session_id: "Session 1",
    trigger_type: "traffic_spike",
    payload: {
      timestamp: new Date().toISOString(),
      source: "203.0.113.42",
      requests_per_second: 12500,
      baseline_rps: 800,
      severity: 0.87,
    } satisfies TrafficSpike,
  },
  {
    session_id: "Session 3",
    trigger_type: "failed_logins",
    payload: {
      timestamp: new Date().toISOString(),
      source: "198.51.100.17",
      attempt_count: 342,
      time_window_secs: 60,
      target_accounts: ["admin@acme.io", "cto@acme.io", "root"],
      severity: 0.93,
    } satisfies FailedLogins,
  },
  {
    session_id: "Session 5",
    trigger_type: "traffic_spike",
    payload: {
      timestamp: new Date().toISOString(),
      source: "10.0.0.0/8 (internal)",
      requests_per_second: 45000,
      baseline_rps: 2000,
      severity: 0.95,
    } satisfies TrafficSpike,
  },
];

// ─────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "success" | "error";

function App() {
  const [responses, setResponses] = useState<BaselineResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("Awaiting input…");
  const [activeSession, setActiveSession] = useState<string | null>(null);

  async function fireSession(report: AnomalyReport) {
    setActiveSession(report.session_id);
    setStatus("loading");
    setStatusMessage(`Analyzing ${report.session_id}…`);

    try {
      const result = await invoke<BaselineResult>("analyze_incident_baseline", {
        report,
      });

      setResponses((prev) => [result, ...prev]);
      setStatus("success");
      setStatusMessage(`${report.session_id} — baseline analysis complete`);
    } catch (err) {
      setStatus("error");
      setStatusMessage(`Error: ${String(err)}`);
    } finally {
      setActiveSession(null);
    }
  }

  const sessionMeta: Record<string, { indicator: string; tag: string }> = {
    "Session 1": { indicator: "session-btn__indicator--s1", tag: "traffic_spike" },
    "Session 3": { indicator: "session-btn__indicator--s3", tag: "failed_logins" },
    "Session 5": { indicator: "session-btn__indicator--s5", tag: "traffic_spike" },
  };

  return (
    <div className="app-wrapper">
      {/* ── Header ──────────────────────────────── */}
      <header className="header">
        <div className="header__badge">
          <span className="pulse-dot" />
          Phase 1 · Baseline
        </div>
        <h1 className="header__title">HIRA Control Panel</h1>
        <p className="header__subtitle">
          Hindsight-Informed Recursive Analyst — fire mock incident sessions
          and observe the naive baseline routing before memory and CascadeFlow
          are wired.
        </p>
      </header>

      {/* ── Grid ────────────────────────────────── */}
      <div className="panel-grid">
        {/* Trigger Card */}
        <section className="card">
          <div className="card__header">
            <div className="card__icon card__icon--indigo">⚡</div>
            <div>
              <div className="card__title">Incident Triggers</div>
              <div className="card__desc">Fire mock anomaly sessions</div>
            </div>
          </div>
          <div className="session-group">
            {MOCK_SESSIONS.map((session) => {
              const meta = sessionMeta[session.session_id];
              return (
                <button
                  key={session.session_id}
                  id={`btn-${session.session_id.replace(/\s/g, "-").toLowerCase()}`}
                  className="session-btn"
                  disabled={activeSession !== null}
                  onClick={() => fireSession(session)}
                >
                  <span className={`session-btn__indicator ${meta.indicator}`} />
                  <span className="session-btn__label">{session.session_id}</span>
                  <span className="session-btn__tag">{meta.tag}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Meta Card */}
        <section className="card">
          <div className="card__header">
            <div className="card__icon card__icon--cyan">📊</div>
            <div>
              <div className="card__title">System Status</div>
              <div className="card__desc">Phase 1 configuration</div>
            </div>
          </div>
          <div className="meta-grid">
            <div className="meta-item">
              <div className="meta-item__label">Phase</div>
              <div className="meta-item__value meta-item__value--accent">1 — Foundation</div>
            </div>
            <div className="meta-item">
              <div className="meta-item__label">Memory</div>
              <div className="meta-item__value">Disabled</div>
            </div>
            <div className="meta-item">
              <div className="meta-item__label">CascadeFlow</div>
              <div className="meta-item__value">Disabled</div>
            </div>
            <div className="meta-item">
              <div className="meta-item__label">Responses</div>
              <div className="meta-item__value meta-item__value--accent">{responses.length}</div>
            </div>
          </div>
        </section>

        {/* Response Card (full width) */}
        <section className="card card--full">
          <div className="card__header">
            <div className="card__icon card__icon--emerald">🛡️</div>
            <div>
              <div className="card__title">Baseline Responses</div>
              <div className="card__desc">Naive routing — no hindsight, no cascade</div>
            </div>
          </div>

          {/* Status Bar */}
          <div className="status-bar">
            <span className={`status-dot status-dot--${status}`} />
            <span className="status-text">{statusMessage}</span>
          </div>

          {/* Response List */}
          <div className="response-area">
            {responses.length === 0 ? (
              <div className="response-empty">
                <span className="response-empty__icon">📡</span>
                Fire an incident session above to see baseline analysis
              </div>
            ) : (
              responses.map((res, i) => (
                <div key={`${res.session_id}-${i}`} className="response-block">
                  <div className="response-block__header">
                    <span className="response-block__session">
                      {res.session_id} · {res.trigger_type}
                    </span>
                    <div className="response-block__flags">
                      <span className={`flag ${res.used_memory ? "flag--on" : "flag--off"}`}>
                        Memory {res.used_memory ? "ON" : "OFF"}
                      </span>
                      <span className={`flag ${res.used_cascade ? "flag--on" : "flag--off"}`}>
                        Cascade {res.used_cascade ? "ON" : "OFF"}
                      </span>
                    </div>
                  </div>
                  <p className="response-block__text">{res.recommendation}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
