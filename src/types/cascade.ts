// ─────────────────────────────────────────────────────────────
// CascadeFlow Types — Frontend mirror of backend CascadeAuditBlock
//
// Keeps the frontend type-safe without pulling in the backend
// module directly.  Must stay in sync with:
//   backend/src/types/memory.ts → CascadeAuditBlock
// ─────────────────────────────────────────────────────────────

/**
 * Structured CascadeFlow audit block returned by POST /api/analyze.
 * Mirrors backend/src/types/memory.ts CascadeAuditBlock exactly.
 */
export interface CascadeAuditBlock {
  /** Human-readable complexity description, e.g. "Medium (credential + traffic correlation)". */
  complexity: string;
  /** Human-readable model path description. */
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
