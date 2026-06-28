// ─────────────────────────────────────────────────────────────
// Shared Memory Types — Node/Express backend
//
// These mirror the Phase 1 schemas exactly.  The only additions
// are the backend-internal types: InputTrigger and SimilarIncident,
// plus an optional `embedding_id` extension on MemoryArtifact.
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
