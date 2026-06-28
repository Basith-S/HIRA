// ─────────────────────────────────────────────────────────────
// Shared Memory Types — Node/Express backend
//
// These mirror the Phase 1 schemas exactly.  The only additions
// are the backend-internal types: InputTrigger and SimilarIncident,
// plus an optional `embedding_id` extension on MemoryArtifact.
//
// Phase 4 additions:
//   - CascadeAuditBlock — structured audit trail per response
//   - AnalyzeResponse   — full typed shape of POST /api/analyze
// ─────────────────────────────────────────────────────────────

/**
 * What HIRA remembers after resolving an incident.
 * Mirrors src/types/schemas.ts `MemoryArtifact` exactly —
 * plus an optional `embedding_id` for ChromaDB cross-reference.
 */
export interface MemoryArtifact {
  /** Unique incident identifier (UUID v4). */
  incident_id: string;
  /** The original trigger type that spawned this incident. */
  trigger_type: string;
  /** Embedding vectors produced by the analysis pipeline. */
  vectors: number[];
  /** Whether the chosen mitigation was ultimately successful. */
  mitigation_success: boolean;
  /** Free-text retrospective note added after resolution. */
  hindsight_note: string;
  /** ISO-8601 timestamp of artifact creation. */
  created_at: string;
  /**
   * ChromaDB document ID for this artifact's embedding entry.
   * Extension field — not present in the Rust/TS Phase 1 schema.
   */
  embedding_id?: string;
}

/**
 * Lightweight trigger shape used internally by the memory service.
 * Derived from AnomalyReport payloads without requiring the full
 * Phase 1 discriminated union at the memory layer.
 */
export interface InputTrigger {
  /** Discriminator: "traffic_spike" | "failed_logins". */
  trigger_type: string;
  /** Source identifier (IP, subnet, user-agent, etc.). */
  source: string;
  /** Severity score (0.0 – 1.0). */
  severity: number;
  /** Optional pre-built summary text; auto-built if absent. */
  summary?: string;
}

/**
 * A result returned by ChromaDB similarity search.
 */
export interface SimilarIncident {
  /** ChromaDB document ID (mirrors embedding_id on MemoryArtifact). */
  id: string;
  /** L2 or cosine distance score — lower means more similar. */
  distance: number;
  /** Metadata stored alongside the embedding in ChromaDB. */
  metadata: Record<string, string>;
}

export type AgentDecisionMode = "BASELINE" | "COMPOSITE_OVERRIDE" | "BUDGET_FALLBACK";

export interface AgentDecision {
  mode: AgentDecisionMode;
  recommendation: string;
  mitigationChain: string[];
  patternDetected: boolean;
  patternId: string | null;
  patternLabel: string | null;
  confidence: number | null;
}

// ─────────────────────────────────────────────────────────────
// Phase 4 — CascadeFlow Types
// ─────────────────────────────────────────────────────────────

/**
 * Structured CascadeFlow audit block appended to every /api/analyze response.
 */
export interface CascadeAuditBlock {
  /** Human-readable complexity description, e.g. "Medium (credential + traffic correlation)". */
  complexity: string;
  /** Human-readable model path description, e.g. "fast_model → full_model (escalated after pattern match)". */
  modelPath: string;
  /** Token usage string, e.g. "2450 / 8000". */
  tokensUsed: string;
  /** Ordered list of key decisions made during this request. */
  decisions: string[];
  /** Estimated % latency saved vs always using the full model (0–100). */
  latencySavingPct: number;
  /** Pre-formatted printable audit block matching the POC spec format. */
  formatted: string;
}

/**
 * Full typed shape of the POST /api/analyze response (Phase 4).
 */
export interface AnalyzeResponse {
  session_id: string;
  trigger_type: string;
  recommendation: string;
  used_memory: boolean;
  used_cascade: boolean;
  context: {
    pastIncidents: SimilarIncident[];
    overridden: boolean;
    confidence: number;
    cascadeAudit?: CascadeAuditBlock;
    modelPath?: "fast_path" | "escalation_path" | "degraded_fallback";
    tokenBudget?: number;
    tokensUsed?: number;
  };
}
