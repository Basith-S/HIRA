import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AnomalyReport,
  BaselineResult,
  HindsightResult,
  TrafficSpike,
  FailedLogins,
} from "./types/schemas";
import type { CascadeAuditBlock } from "./types/cascade";
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

const BACKEND_URL = "http://localhost:3001";

// ─────────────────────────────────────────────────────────────
// Unified response type — superset of baseline + hindsight + cascade
// ─────────────────────────────────────────────────────────────

type UnifiedResponse = BaselineResult & {
  context?: HindsightResult["context"] & {
    cascadeAudit?: CascadeAuditBlock;
    modelPath?: "fast_path" | "escalation_path" | "degraded_fallback";
    tokenBudget?: number;
    tokensUsed?: number;
  };
};

type Status = "idle" | "loading" | "success" | "error";

function App() {
  const [responses, setResponses] = useState<UnifiedResponse[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("Awaiting input…");
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [hindsightEnabled, setHindsightEnabled] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [sessions, setSessions] = useState<AnomalyReport[]>([]);

  // ── Load sessions from backend ──────────────────────────────
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/sessions`);
        if (res.ok) {
          const data = await res.json();
          setSessions(data);
        }
      } catch (err) {
        console.error("[HIRA] Failed to load sessions from backend:", err);
      }
    };
    loadSessions();
  }, []);

  // ── Fire a session through the selected pipeline ──────────
  const fireSession = useCallback(
    async (report: AnomalyReport) => {
      setActiveSession(report.session_id);
      setStatus("loading");
      setStatusMessage(`Analyzing ${report.session_id}…`);

      try {
        let unified: UnifiedResponse;

        if (hindsightEnabled) {
          // ── Express backend with hindsight memory + CascadeFlow ──
          const res = await fetch(`${BACKEND_URL}/api/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: report.session_id,
              trigger_type: report.trigger_type,
              payload: report.payload,
            }),
          });

          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Backend error ${res.status}: ${errBody}`);
          }

          const data: HindsightResult & {
            context: HindsightResult["context"] & {
              cascadeAudit?: CascadeAuditBlock;
              modelPath?: "fast_path" | "escalation_path" | "degraded_fallback";
              tokenBudget?: number;
              tokensUsed?: number;
            };
          } = await res.json();

          unified = {
            session_id: data.session_id,
            trigger_type: data.trigger_type,
            recommendation: data.recommendation,
            used_memory: data.used_memory,
            used_cascade: data.used_cascade,
            context: data.context,
          };
        } else {
          // ── Tauri Rust baseline (Phase 1) ──
          const result = await invoke<BaselineResult>(
            "analyze_incident_baseline",
            { report }
          );
          unified = { ...result };
        }

        setResponses((prev) => [unified, ...prev]);
        setStatus("success");
        const label = hindsightEnabled ? "CascadeFlow analysis" : "baseline analysis";
        setStatusMessage(`${report.session_id} — ${label} complete`);
      } catch (err) {
        setStatus("error");
        setStatusMessage(`Error: ${String(err)}`);
      } finally {
        setActiveSession(null);
      }
    },
    [hindsightEnabled]
  );

  // ── Reset memory ──────────────────────────────────────────
  const resetMemory = useCallback(async () => {
    setResetting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/memory/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
      setResponses([]);
      setStatus("success");
      setStatusMessage("Memory subsystems cleared — ready for fresh demo run");
    } catch (err) {
      setStatus("error");
      setStatusMessage(`Reset error: ${String(err)}`);
    } finally {
      setResetting(false);
    }
  }, []);

  const sessionMeta: Record<string, { indicator: string; tag: string }> = {
    "Session 1": { indicator: "session-btn__indicator--s1", tag: "traffic_spike" },
    "Session 3": { indicator: "session-btn__indicator--s3", tag: "failed_logins" },
    "Session 5": { indicator: "session-btn__indicator--s5", tag: "traffic_spike" },
  };

  // ── Phase 4: derive active cascade state ─────────────────
  const hasActiveCascade = responses.some((r) => r.used_cascade);

  const phaseLabel = hasActiveCascade
    ? "4 — CascadeFlow"
    : hindsightEnabled
    ? "3 — Hindsight"
    : "1 — Foundation";

  return (
    <div className="app-wrapper">
      {/* ── Header ──────────────────────────────── */}
      <header className="header">
        <div className="header__badge">
          <span className="pulse-dot" />
          {hasActiveCascade
            ? "Phase 4 · CascadeFlow"
            : hindsightEnabled
            ? "Phase 3 · Hindsight"
            : "Phase 1 · Baseline"}
        </div>
        <h1 className="header__title">HIRA Control Panel</h1>
        <p className="header__subtitle">
          Hindsight-Informed Recursive Analyst — fire mock incident sessions
          {hasActiveCascade
            ? " and observe the CascadeFlow routing engine selecting the optimal model path."
            : hindsightEnabled
            ? " and observe how cross-session memory correlation alters recommendations."
            : " and observe the naive baseline routing before memory and CascadeFlow are wired."}
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
            {(sessions.length > 0 ? sessions : MOCK_SESSIONS).map((session) => {
              const meta = sessionMeta[session.session_id] || {
                indicator: session.session_id.includes("3") || session.session_id.includes("2")
                  ? "session-btn__indicator--s3"
                  : session.session_id.includes("5") || session.session_id.includes("6") || session.session_id.includes("Edge")
                  ? "session-btn__indicator--s5"
                  : "session-btn__indicator--s1",
                tag: session.trigger_type,
              };
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
              <div className="card__desc">
                {hasActiveCascade
                  ? "CascadeFlow routing engine active"
                  : hindsightEnabled
                  ? "Hindsight memory active"
                  : "Phase 1 configuration"}
              </div>
            </div>
          </div>
          <div className="meta-grid">
            <div className="meta-item">
              <div className="meta-item__label">Phase</div>
              <div className="meta-item__value meta-item__value--accent">
                {phaseLabel}
              </div>
            </div>
            <div className="meta-item">
              <div className="meta-item__label">Memory</div>
              <div
                className={`meta-item__value ${
                  hindsightEnabled ? "meta-item__value--active" : ""
                }`}
              >
                {hindsightEnabled ? "Active" : "Disabled"}
              </div>
            </div>
            <div className="meta-item">
              <div className="meta-item__label">CascadeFlow</div>
              <div
                className={`meta-item__value ${
                  hasActiveCascade ? "meta-item__value--cascade" : ""
                }`}
              >
                {hasActiveCascade ? "Active" : "Disabled"}
              </div>
            </div>
            <div className="meta-item">
              <div className="meta-item__label">Responses</div>
              <div className="meta-item__value meta-item__value--accent">
                {responses.length}
              </div>
            </div>
          </div>

          {/* ── Token Budget Meter ── */}
          {hasActiveCascade && responses[0]?.context?.tokensUsed != null && (
            <div className="token-meter">
              <span className="token-meter__label">Token Budget</span>
              <div className="token-meter__track">
                <div
                  className="token-meter__fill"
                  style={{
                    width: `${Math.min(
                      ((responses[0].context!.tokensUsed! /
                        (responses[0].context!.tokenBudget ?? 8000)) *
                        100),
                      100
                    )}%`,
                  }}
                />
              </div>
              <span className="token-meter__value">
                {responses[0].context!.tokensUsed} /{" "}
                {responses[0].context!.tokenBudget ?? 8000}
              </span>
            </div>
          )}

          {/* ── Hindsight Toggle & Reset ── */}
          <div className="hindsight-controls">
            <label className="toggle" id="hindsight-toggle">
              <input
                type="checkbox"
                checked={hindsightEnabled}
                onChange={(e) => setHindsightEnabled(e.target.checked)}
              />
              <span className="toggle__track">
                <span className="toggle__thumb" />
              </span>
              <span className="toggle__label">Enable Hindsight Memory</span>
            </label>

            <button
              id="btn-reset-memory"
              className="reset-btn"
              disabled={resetting}
              onClick={resetMemory}
            >
              {resetting ? (
                <>
                  <span className="reset-btn__spinner" />
                  Clearing…
                </>
              ) : (
                <>🗑️ Reset Memory</>
              )}
            </button>
          </div>
        </section>

        {/* Response Card (full width) */}
        <section className="card card--full">
          <div className="card__header">
            <div className="card__icon card__icon--emerald">🛡️</div>
            <div>
              <div className="card__title">
                {hasActiveCascade
                  ? "CascadeFlow Responses"
                  : hindsightEnabled
                  ? "Hindsight Responses"
                  : "Baseline Responses"}
              </div>
              <div className="card__desc">
                {hasActiveCascade
                  ? "Adaptive model routing — complexity-scored, path-audited recommendations"
                  : hindsightEnabled
                  ? "Cross-session correlation — memory-informed recommendations"
                  : "Naive routing — no hindsight, no cascade"}
              </div>
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
                Fire an incident session above to see{" "}
                {hasActiveCascade
                  ? "CascadeFlow"
                  : hindsightEnabled
                  ? "hindsight"
                  : "baseline"}{" "}
                analysis
              </div>
            ) : (
              responses.map((res, i) => (
                <div key={`${res.session_id}-${i}`} className="response-block">
                  <div className="response-block__header">
                    <span className="response-block__session">
                      {res.session_id} · {res.trigger_type}
                    </span>
                    <div className="response-block__flags">
                      {/* Hindsight Override badge */}
                      {res.context?.overridden && (
                        <span className="flag flag--override" id="flag-hindsight-override">
                          ⚠️ Hindsight Override
                        </span>
                      )}
                      <span
                        className={`flag ${
                          res.used_memory ? "flag--on" : "flag--off"
                        }`}
                      >
                        Memory {res.used_memory ? "ON" : "OFF"}
                      </span>
                      <span
                        className={`flag ${
                          res.used_cascade ? "flag--on" : "flag--off"
                        }`}
                      >
                        Cascade {res.used_cascade ? "ON" : "OFF"}
                      </span>
                      {/* Model path badge — Phase 4 */}
                      {res.used_cascade && res.context?.modelPath && (
                        <span
                          className={`flag flag--model-${res.context.modelPath.replace(
                            /_/g,
                            "-"
                          )}`}
                        >
                          {res.context.modelPath === "fast_path" && "⚡ Fast Path"}
                          {res.context.modelPath === "escalation_path" && "🔺 Escalated"}
                          {res.context.modelPath === "degraded_fallback" && "⚠️ Degraded"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Confidence Score */}
                  {res.context?.overridden && (
                    <div className="confidence-bar">
                      <span className="confidence-bar__label">
                        Pattern Confidence
                      </span>
                      <div className="confidence-bar__track">
                        <div
                          className="confidence-bar__fill"
                          style={{
                            width: `${(res.context.confidence * 100).toFixed(0)}%`,
                          }}
                        />
                      </div>
                      <span className="confidence-bar__value">
                        {(res.context.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}

                  <p className="response-block__text">{res.recommendation}</p>

                  {/* Recalled Past Incidents */}
                  {res.context &&
                    res.context.pastIncidents.length > 0 && (
                      <div className="recalled-section">
                        <div className="recalled-section__title">
                          🧠 Recalled Past Incidents ({res.context.pastIncidents.length})
                        </div>
                        <div className="recalled-list">
                          {res.context.pastIncidents.map((inc) => (
                            <div key={inc.id} className="recalled-item">
                              <span className="recalled-item__id">
                                {inc.id.substring(0, 8)}…
                              </span>
                              <span className="recalled-item__type">
                                {inc.metadata.trigger_type || "unknown"}
                              </span>
                              <span className="recalled-item__distance">
                                dist: {inc.distance.toFixed(4)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* CascadeFlow Audit Block — Phase 4 */}
                  {res.context?.cascadeAudit && (
                    <div
                      className="cascade-audit"
                      id={`cascade-audit-${res.session_id}`}
                    >
                      <div className="cascade-audit__title">🔀 CascadeFlow Audit</div>
                      <pre className="cascade-audit__pre">
                        {res.context.cascadeAudit.formatted}
                      </pre>
                      {res.context.cascadeAudit.latencySavingPct > 0 && (
                        <div className="cascade-audit__saving">
                          ⚡ ~{res.context.cascadeAudit.latencySavingPct}% latency
                          saved vs always-full-model
                        </div>
                      )}
                    </div>
                  )}
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
