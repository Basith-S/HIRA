// ─────────────────────────────────────────────────────────────
// SENTRI Demo Session Payloads — hardcoded client-side
// Maps session <1|2|3|4|5> to a POST /api/analyze body.
// ─────────────────────────────────────────────────────────────

export interface DemoSessionPayload {
  session_id: string;
  trigger_type: string;
  displaySeverity: string; // for feed badge
  payload: Record<string, unknown>;
}

export const DEMO_SESSIONS: Record<number, DemoSessionPayload> = {
  1: {
    session_id: "Session 1",
    trigger_type: "traffic_spike",
    displaySeverity: "high",
    payload: {
      timestamp: new Date().toISOString(),
      source: "203.0.113.42",
      requests_per_second: 12500,
      baseline_rps: 800,
      severity: 0.87,
      summary: "DDoS-like traffic spike against public ingress",
    },
  },
  2: {
    session_id: "Session 2",
    trigger_type: "traffic_spike",
    displaySeverity: "medium",
    payload: {
      timestamp: new Date().toISOString(),
      source: "203.0.113.42",
      requests_per_second: 1800,
      baseline_rps: 900,
      severity: 0.5,
      summary: "Control traffic fluctuation from a previously observed source",
    },
  },
  3: {
    session_id: "Session 3",
    trigger_type: "failed_logins",
    displaySeverity: "critical",
    payload: {
      timestamp: new Date().toISOString(),
      source: "198.51.100.17",
      attempt_count: 342,
      time_window_secs: 60,
      target_accounts: ["admin@acme.io", "cto@acme.io", "root"],
      severity: 0.93,
      summary: "Credential stuffing burst after traffic spike",
    },
  },
  4: {
    session_id: "Session 4",
    trigger_type: "traffic_spike",
    displaySeverity: "critical",
    payload: {
      timestamp: new Date().toISOString(),
      source: "10.0.0.0/8",
      requests_per_second: 32000,
      baseline_rps: 1600,
      severity: 0.97,
      summary: "Critical takeover precursor with traffic and credential correlation",
    },
  },
  5: {
    session_id: "Session 5",
    trigger_type: "traffic_spike",
    displaySeverity: "critical",
    payload: {
      timestamp: new Date().toISOString(),
      source: "10.0.0.0/8",
      requests_per_second: 45000,
      baseline_rps: 2000,
      severity: 0.95,
      summary: "Final POC composite takeover precursor",
    },
  },
};
