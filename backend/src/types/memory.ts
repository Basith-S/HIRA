// ─────────────────────────────────────────────────────────────
// Shared Memory Types — Node/Express backend
//
// Phase 6 additions (Gemini + RawInput overhaul):
//   - RawInputType, RawInput — unstructured real-world data schema
//   - GeminiClassification   — Gemini Flash intake output
//   - DeepAnalysisResult     — Gemini Pro deep analysis output
//   - DEEP_ANALYSIS mode     — added to AgentDecisionMode
//   - AgentDecision extended with attackChain, cvssScore, relatedPatterns
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
 * Lightweight trigger shape used internally by the memory service and
 * pattern matcher. Derived from GeminiClassification after intake.
 * NOT exposed via any API endpoint.
 */
export interface InputTrigger {
  /** Discriminator: "traffic_spike" | "failed_logins" | freeform from Gemini. */
  trigger_type: string;
  /** Source identifier (IP, filename, service name, etc.). */
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

// ─────────────────────────────────────────────────────────────
// Phase 6 — RawInput Schema
// ─────────────────────────────────────────────────────────────

export type RawInputType =
  | "code_snippet"     // source code of any language
  | "file_entry"       // file contents (config, script, binary repr)
  | "log_lines"        // syslog, auth.log, windows event log, etc
  | "network_capture"  // IP headers, DNS queries, packet summaries
  | "process_list"     // running processes + PID + parent
  | "registry_entry"   // Windows registry key/value pairs
  | "email_content"    // raw email headers + body (phishing detection)
  | "hash_list"        // MD5/SHA256 file hashes for IOC matching
  | "unknown";         // fallback — Gemini figures it out

export interface RawInput {
  /** Generated: RAW-${Date.now()} */
  inputId: string;
  /** Hint from the submitter, can be "unknown" */
  inputType: RawInputType;
  /** The raw payload — no length limit enforced here */
  content: string;
  /** Optional: original filename if file was submitted */
  filename?: string;
  /** ISO timestamp of when this was submitted */
  submittedAt: string;
  /** Optional: where this came from ("auth.log", "VS Code", etc.) */
  source?: string;
}

// ─────────────────────────────────────────────────────────────
// Phase 6 — Gemini Classification Output
// ─────────────────────────────────────────────────────────────

export interface GeminiClassification {
  isThreat: boolean;
  /** 0.0–1.0 confidence in the classification */
  confidence: number;
  /** Maps to old InputTrigger types or new freeform threat name */
  threatType: string | null;
  severity: "low" | "medium" | "high" | "critical" | "none";
  /** Extracted indicators of compromise */
  indicators: Record<string, string | number | boolean>;
  /** Gemini's chain-of-thought (1–3 sentences) */
  reasoning: string;
  /** Flash tells CascadeFlow what to do next */
  recommendedPath: "fast" | "escalate";
}

// ─────────────────────────────────────────────────────────────
// Phase 6 — Deep Analysis Output (Gemini Pro)
// ─────────────────────────────────────────────────────────────

export interface DeepAnalysisResult {
  /** Detailed prose report, 4–8 sentences, written for a SOC analyst */
  fullAnalysis: string;
  /** Ordered sequence of attacker TTPs detected */
  attackChain: string[];
  /** Ordered recommended mitigations */
  mitigationChain: string[];
  /** Estimated CVSS v3 base score, if applicable */
  cvssScore: number | null;
  /** Refined confidence from Flash's initial classification */
  confidence: number;
  /** Matching MITRE ATT&CK technique IDs */
  relatedPatterns: string[];
}

// ─────────────────────────────────────────────────────────────
// Agent Decision
// ─────────────────────────────────────────────────────────────

export type AgentDecisionMode =
  | "BASELINE"
  | "COMPOSITE_OVERRIDE"
  | "DEEP_ANALYSIS"
  | "BUDGET_FALLBACK";

export interface AgentDecision {
  mode: AgentDecisionMode;
  recommendation: string;
  mitigationChain: string[];
  patternDetected: boolean;
  patternId: string | null;
  patternLabel: string | null;
  confidence: number | null;
  /** Populated when mode === "DEEP_ANALYSIS" */
  attackChain?: string[];
  cvssScore?: number | null;
  relatedPatterns?: string[];
  rationale?: string;
}

// ─────────────────────────────────────────────────────────────
// Phase 4 — CascadeFlow Types (shape unchanged)
// ─────────────────────────────────────────────────────────────

/**
 * Structured CascadeFlow audit block appended to every /api/analyze response.
 */
export interface CascadeAuditBlock {
  complexity: string;
  modelPath: string;
  tokensUsed: string;
  decisions: string[];
  latencySavingPct: number;
  formatted: string;
}

/**
 * Full typed shape of the POST /api/analyze response.
 */
export interface AnalyzeResponse {
  inputId: string;
  rawInput: Omit<RawInput, "content"> & { content: string }; // content truncated
  classification: GeminiClassification;
  deepAnalysis: DeepAnalysisResult | null;
  decision: AgentDecision;
  similarIncidents: SimilarIncident[];
  cascadeAudit: CascadeAuditBlock;
  notificationId: string | null;
  context: {
    pastIncidents: SimilarIncident[];
    overridden: boolean;
    confidence: number;
    cascadeAudit?: CascadeAuditBlock;
    modelPath?: string;
    tokenBudget?: number;
    tokensUsed?: number;
  };
}
