// ─────────────────────────────────────────────────────────────
// Task 4 — Session Script (Sessions 1–5)
//
// Defines the 5 POC demo sessions and a runDemoSession() helper
// that POSTs each session to /api/analyze and pretty-prints output.
// ─────────────────────────────────────────────────────────────

import type { InputTrigger } from "../types/memory";

// ── Demo Trigger type (extension of InputTrigger) ─────────────

/** Severity label as used in the demo script spec. */
export type SeverityLabel = "low" | "medium" | "high" | "critical";

/** Numeric severity map for converting string labels → 0–1 scale. */
const SEVERITY_MAP: Record<SeverityLabel, number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.8,
  critical: 1.0,
};

/**
 * Demo-specific trigger shape: extends InputTrigger with an
 * indicators bag and a string severity label for readability.
 */
export interface DemoTrigger extends InputTrigger {
  /** Human-readable severity label. */
  severityLabel: SeverityLabel;
  /** Rich indicator bag specific to this session. */
  indicators: Record<string, unknown>;
  /** Optional session name for display. */
  sessionName: string;
}

// ── Helper ────────────────────────────────────────────────────

function makeTrigger(
  trigger_type: string,
  severityLabel: SeverityLabel,
  source: string,
  indicators: Record<string, unknown>,
  sessionName: string
): DemoTrigger {
  return {
    trigger_type,
    severityLabel,
    severity: SEVERITY_MAP[severityLabel],
    source,
    indicators,
    sessionName,
    // Summary text is built here so the embedding captures indicator context
    summary: `[${trigger_type}] severity:${SEVERITY_MAP[severityLabel].toFixed(2)} — ${sessionName}: ${JSON.stringify(indicators)}`,
  };
}

// ── Session Definitions ───────────────────────────────────────

export const DEMO_SESSIONS: DemoTrigger[] = [
  // ── Session 1 — DDoS Probe ─────────────────────────────────
  makeTrigger(
    "traffic_spike",
    "high",
    "203.0.113.0/24",
    {
      requests_per_second: 8400,
      source_diversity: "low",
      geo_anomaly: true,
    },
    "DDoS Probe"
  ),

  // ── Session 2 — Baseline Noise (control) ───────────────────
  makeTrigger(
    "traffic_spike",
    "low",
    "198.51.100.5",
    {
      requests_per_second: 310,
      source_diversity: "high",
      geo_anomaly: false,
    },
    "Baseline Noise (Control)"
  ),

  // ── Session 3 — Credential Stuffing ────────────────────────
  makeTrigger(
    "failed_logins",
    "high",
    "45.155.205.0/28",
    {
      attempts: 2300,
      unique_users_targeted: 180,
      known_breach_list_match: true,
    },
    "Credential Stuffing"
  ),

  // ── Session 4 — Composite Trigger (the delta moment) ───────
  makeTrigger(
    "traffic_spike",
    "critical",
    "185.220.101.0/24",
    {
      requests_per_second: 6100,
      source_diversity: "low",
      geo_anomaly: true,
      concurrent_failed_logins: 940,
      known_breach_list_match: true,
    },
    "Composite Trigger — DDoS + Credential Stuffing"
  ),

  // ── Session 5 — Token Anomaly (post-chain validation) ──────
  makeTrigger(
    "failed_logins",
    "medium",
    "10.0.12.44",
    {
      attempts: 88,
      token_reuse_detected: true,
      post_2fa_failure: true,
    },
    "Token Anomaly (Post-Chain Validation)"
  ),
];

// ── Demo Runner ───────────────────────────────────────────────

const BACKEND_URL = process.env["BACKEND_URL"] ?? "http://localhost:3001";
const STEP_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fire a single demo session against the live backend and pretty-print
 * the full AgentDecision + reflection to stdout.
 *
 * @param sessionIndex - 0-based index into DEMO_SESSIONS
 */
export async function runDemoSession(sessionIndex: number): Promise<void> {
  const trigger = DEMO_SESSIONS[sessionIndex];
  if (!trigger) {
    throw new Error(`Session index ${sessionIndex} out of range (0–${DEMO_SESSIONS.length - 1})`);
  }

  const requestBody = {
    session_id: `Session ${sessionIndex + 1}`,
    trigger_type: trigger.trigger_type,
    source: trigger.source,
    severity: trigger.severity,
    summary: trigger.summary,
    indicators: trigger.indicators,
  };

  const response = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    trigger: unknown;
    decision: Record<string, unknown>;
    reflection: string;
    similarIncidents: Array<{ id: string; distance: number; metadata: Record<string, string> }>;
  };

  // ── Pretty print ─────────────────────────────────────────
  console.log(`\n  Trigger Type : ${trigger.trigger_type}`);
  console.log(`  Severity     : ${trigger.severityLabel} (${trigger.severity})`);
  console.log(`  Indicators   : ${JSON.stringify(trigger.indicators)}`);
  console.log(`\n  ─── AgentDecision ───────────────────────────────────`);
  console.log(`  Mode         : ${data.decision["mode"]}`);

  if (data.decision["mode"] === "COMPOSITE_OVERRIDE") {
    console.log(`  Pattern      : ${data.decision["patternId"]} — ${data.decision["patternLabel"]}`);
    console.log(`  Confidence   : ${((data.decision["confidence"] as number) * 100).toFixed(1)}%`);
    console.log(`  Mitigations  : ${(data.decision["mitigationChain"] as string[]).join(" → ")}`);
  } else {
    console.log(`  Mitigations  : ${(data.decision["mitigationChain"] as string[]).join(" → ")}`);
  }

  console.log(`  Rationale    : ${data.decision["rationale"]}`);
  console.log(`\n  ─── Past Incidents Referenced ───────────────────────`);

  if (data.similarIncidents.length === 0) {
    console.log("  (none — memory is empty for this query)");
  } else {
    data.similarIncidents.forEach((inc, i) => {
      console.log(
        `  [${i + 1}] incident_id:${inc.metadata["incident_id"] ?? inc.id}  ` +
        `type:${inc.metadata["trigger_type"] ?? "?"}  dist:${inc.distance.toFixed(4)}`
      );
    });
  }

  console.log(`\n  ─── Hindsight Reflection ────────────────────────────`);
  console.log(`  ${data.reflection.replace(/\n/g, "\n  ")}`);

  await sleep(STEP_DELAY_MS);
}
