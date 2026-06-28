use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────
// Input Triggers — the raw anomaly signals that enter HIRA
// ─────────────────────────────────────────────────────────────

/// A sudden, abnormal increase in network or request traffic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficSpike {
    /// ISO-8601 timestamp when the spike was detected.
    pub timestamp: String,
    /// The source identifier (IP, subnet, service name, etc.).
    pub source: String,
    /// Requests-per-second at the time of detection.
    pub requests_per_second: f64,
    /// Normal baseline RPS for this source — used to gauge severity.
    pub baseline_rps: f64,
    /// Severity score derived upstream (0.0 – 1.0).
    pub severity: f64,
}

/// A burst of consecutive authentication failures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedLogins {
    /// ISO-8601 timestamp of the most recent failure in the burst.
    pub timestamp: String,
    /// The source identifier (IP, user-agent fingerprint, etc.).
    pub source: String,
    /// How many failures occurred inside the detection window.
    pub attempt_count: u32,
    /// Length of the detection window in seconds.
    pub time_window_secs: u64,
    /// List of targeted account names / emails.
    pub target_accounts: Vec<String>,
    /// Severity score derived upstream (0.0 – 1.0).
    pub severity: f64,
}

/// The top-level anomaly report envelope sent from the frontend.
/// `trigger_type` discriminates the variant; `payload` carries
/// the JSON-serialised trigger body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyReport {
    /// A human-readable session label, e.g. "Session 1".
    pub session_id: String,
    /// Discriminator: "traffic_spike" | "failed_logins".
    pub trigger_type: String,
    /// The raw JSON payload matching the trigger_type schema.
    pub payload: serde_json::Value,
}

// ─────────────────────────────────────────────────────────────
// Memory Artifact — what HIRA remembers after resolving an
// incident (Phase 2+ will persist these; Phase 1 defines shape)
// ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryArtifact {
    /// Unique incident identifier (UUID v4).
    pub incident_id: String,
    /// The original trigger type that spawned this incident.
    pub trigger_type: String,
    /// Embedding vectors produced by the analysis pipeline.
    /// Stored as a flat f64 array; dimensionality is implicit.
    pub vectors: Vec<f64>,
    /// Whether the chosen mitigation was ultimately successful.
    pub mitigation_success: bool,
    /// Free-text retrospective note added after resolution.
    pub hindsight_note: String,
    /// ISO-8601 timestamp of artifact creation.
    pub created_at: String,
}

// ─────────────────────────────────────────────────────────────
// CascadeFlow Audit Trail — an ordered chain of decision blocks
// that records *why* HIRA chose a particular response path
// ─────────────────────────────────────────────────────────────

/// A single decision node in the CascadeFlow chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeBlock {
    /// Monotonically increasing step index within the cascade.
    pub step: u32,
    /// Which agent / module produced this block.
    pub agent: String,
    /// What action was taken (e.g. "route", "mitigate", "escalate").
    pub action: String,
    /// The input data snapshot that was evaluated at this step.
    pub input_snapshot: serde_json::Value,
    /// The decision / output produced by the agent.
    pub output: serde_json::Value,
    /// Confidence score the agent assigned to its decision (0.0 – 1.0).
    pub confidence: f64,
    /// ISO-8601 timestamp of this step.
    pub timestamp: String,
}

/// The full audit trail for one incident's CascadeFlow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeFlowTrail {
    /// The incident this trail belongs to.
    pub incident_id: String,
    /// Ordered sequence of decision blocks.
    pub blocks: Vec<CascadeBlock>,
    /// Overall status: "in_progress" | "completed" | "failed".
    pub status: String,
}

// ─────────────────────────────────────────────────────────────
// Baseline Analysis Result — returned by the "dumb" Phase 1
// command before memory / CascadeFlow is wired up
// ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineResult {
    pub session_id: String,
    pub trigger_type: String,
    pub recommendation: String,
    pub used_memory: bool,
    pub used_cascade: bool,
}
