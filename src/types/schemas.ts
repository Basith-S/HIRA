// ─────────────────────────────────────────────────────────────
// Input Triggers
// ─────────────────────────────────────────────────────────────

/** A sudden, abnormal increase in network or request traffic. */
export interface TrafficSpike {
  /** ISO-8601 timestamp when the spike was detected. */
  timestamp: string;
  /** The source identifier (IP, subnet, service name, etc.). */
  source: string;
  /** Requests-per-second at the time of detection. */
  requests_per_second: number;
  /** Normal baseline RPS for this source. */
  baseline_rps: number;
  /** Severity score (0.0 – 1.0). */
  severity: number;
}

/** A burst of consecutive authentication failures. */
export interface FailedLogins {
  /** ISO-8601 timestamp of the most recent failure. */
  timestamp: string;
  /** The source identifier (IP, user-agent fingerprint, etc.). */
  source: string;
  /** How many failures inside the detection window. */
  attempt_count: number;
  /** Length of the detection window in seconds. */
  time_window_secs: number;
  /** Targeted account names / emails. */
  target_accounts: string[];
  /** Severity score (0.0 – 1.0). */
  severity: number;
}

/** Top-level anomaly report envelope sent to the Tauri backend. */
export interface AnomalyReport {
  /** Human-readable session label, e.g. "Session 1". */
  session_id: string;
  /** Discriminator: "traffic_spike" | "failed_logins". */
  trigger_type: "traffic_spike" | "failed_logins";
  /** JSON payload matching the trigger_type schema. */
  payload: TrafficSpike | FailedLogins;
}

// ─────────────────────────────────────────────────────────────
// Memory Artifact
// ─────────────────────────────────────────────────────────────

/** What HIRA remembers after resolving an incident. */
export interface MemoryArtifact {
  /** Unique incident identifier (UUID v4). */
  incident_id: string;
  /** The trigger type that spawned this incident. */
  trigger_type: string;
  /** Embedding vectors from the analysis pipeline. */
  vectors: number[];
  /** Whether the mitigation was successful. */
  mitigation_success: boolean;
  /** Free-text retrospective note. */
  hindsight_note: string;
  /** ISO-8601 timestamp of creation. */
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// CascadeFlow Audit Trail
// ─────────────────────────────────────────────────────────────

/** A single decision node in the CascadeFlow chain. */
export interface CascadeBlock {
  /** Step index within the cascade. */
  step: number;
  /** Which agent / module produced this block. */
  agent: string;
  /** Action taken: "route" | "mitigate" | "escalate" | etc. */
  action: string;
  /** Input data snapshot evaluated at this step. */
  input_snapshot: Record<string, unknown>;
  /** Decision / output produced by the agent. */
  output: Record<string, unknown>;
  /** Confidence score (0.0 – 1.0). */
  confidence: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** Full audit trail for one incident's CascadeFlow. */
export interface CascadeFlowTrail {
  /** The incident this trail belongs to. */
  incident_id: string;
  /** Ordered decision blocks. */
  blocks: CascadeBlock[];
  /** Overall status. */
  status: "in_progress" | "completed" | "failed";
}

// ─────────────────────────────────────────────────────────────
// Baseline Analysis Result
// ─────────────────────────────────────────────────────────────

/** Returned by the Phase 1 "dumb" baseline command. */
export interface BaselineResult {
  session_id: string;
  trigger_type: string;
  recommendation: string;
  used_memory: boolean;
  used_cascade: boolean;
}
