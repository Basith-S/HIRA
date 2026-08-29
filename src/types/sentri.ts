// ─────────────────────────────────────────────────────────────
// SENTRI Frontend Types
// Mirrors backend/src/types/memory.ts exactly.
// ─────────────────────────────────────────────────────────────

export type AgentDecisionMode =
  | "BASELINE"
  | "COMPOSITE_OVERRIDE"
  | "BUDGET_FALLBACK"
  | "NOVEL_ANOMALY"
  | "DEEP_ANALYSIS";

export interface AgentDecision {
  mode: AgentDecisionMode;
  recommendation: string;
  mitigationChain: string[];
  patternDetected: boolean;
  patternId: string | null;
  patternLabel: string | null;
  confidence: number | null;
}

/** Intake classifier output. Mirrors backend `GeminiClassification`. */
export interface ThreatClassification {
  isThreat: boolean;
  confidence: number;
  threatType: string | null;
  severity: "low" | "medium" | "high" | "critical" | "none";
  indicators: Record<string, string | number | boolean>;
  reasoning: string;
  recommendedPath: "fast" | "escalate";
}

export interface SimilarIncident {
  id: string;
  distance: number;
  metadata: Record<string, string>;
}

export interface CascadeAuditBlock {
  complexity: string;
  modelPath: string;
  tokensUsed: string;
  decisions: string[];
  latencySavingPct: number;
  formatted: string;
}

export interface InputTrigger {
  trigger_type: string;
  severity: string; // high | medium | low | critical
  indicators: Record<string, string | number | boolean>;
}

/**
 * The full POST /api/analyze response shape.
 * Top-level `decision`, `reflection`, `similarIncidents`, `cascadeAudit`
 * are the canonical fields; `context` is the older nested envelope.
 */
export interface SENTRIResponse {
  session_id: string;
  /** Present on the Phase 7 pipeline response; absent on legacy replies. */
  inputId?: string;
  classification?: ThreatClassification | null;
  trigger_type: string;
  recommendation: string;
  used_memory: boolean;
  used_cascade: boolean;
  latencyMs?: number;
  tokensUsed?: number;
  trigger?: {
    trigger_type: string;
    source?: string;
    severity?: number;
    summary?: string;
  };
  decision: AgentDecision | null;
  reflection: string | null;
  similarIncidents: SimilarIncident[];
  cascadeAudit: CascadeAuditBlock | null;
  notificationId: string | null;
  context: {
    pastIncidents: SimilarIncident[];
    overridden: boolean;
    confidence: number;
    cascadeAudit?: CascadeAuditBlock | null;
    /** Free-form model path label, e.g. "sentri-classifier (phi3:mini)". */
    modelPath?: string | null;
    tokenBudget?: number;
    tokensUsed?: number;
  };
}

// ── Feed / App State ──────────────────────────────────────────

export interface IncidentEntry {
  id: string;
  timestamp: Date;
  triggerType: string;
  severity: string;
  response: SENTRIResponse | null;
  isNovel: boolean;
  isLoading: boolean;
}

export type ConnectionState = "connected" | "disconnected" | "checking";

export interface ConnectionStatus {
  chroma: ConnectionState;
  api: ConnectionState;
}

export interface AppState {
  incidents: IncidentEntry[];
  selectedId: string | null;
  connectionStatus: ConnectionStatus;
  commandHistory: string[];
  isLoading: boolean;
}

// ── Recall Response ───────────────────────────────────────────

export interface RecallResponse {
  query: {
    trigger_type: string;
    source: string;
    severity: number;
  };
  count: number;
  results: SimilarIncident[];
}
