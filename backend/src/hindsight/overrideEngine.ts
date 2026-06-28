// ─────────────────────────────────────────────────────────────
// Task 2 — Behavioral Override Engine
//
// Translates a ClassifyResult (or null) into a fully resolved
// AgentDecision that the rest of the pipeline can act on.
// ─────────────────────────────────────────────────────────────

import type { ClassifyResult } from "./patternClassifier";

// ── Types ─────────────────────────────────────────────────────

export type AgentDecision = {
  /** BASELINE = single-vector response; COMPOSITE_OVERRIDE = pattern triggered. */
  mode: "BASELINE" | "COMPOSITE_OVERRIDE";
  /** Matched composite pattern ID, or null for baseline. */
  patternId: string | null;
  /** Human-readable pattern label, or null for baseline. */
  patternLabel: string | null;
  /** Computed confidence score (0–1), or null for baseline. */
  confidence: number | null;
  /** Ordered mitigation actions to execute. */
  mitigationChain: string[];
  /** Analyst-readable explanation of the decision. */
  rationale: string;
};

// ── Decision Builder ──────────────────────────────────────────

/**
 * Build a fully resolved `AgentDecision` from a pattern classification
 * result and the baseline mitigation action for this trigger type.
 *
 * @param classifyResult     - Output of `classifyPattern`, or null if no match
 * @param baselineMitigation - Single mitigation action for the BASELINE path
 */
export function buildDecision(
  classifyResult: ClassifyResult | null,
  baselineMitigation: string
): AgentDecision {
  if (!classifyResult) {
    return {
      mode: "BASELINE",
      patternId: null,
      patternLabel: null,
      confidence: null,
      mitigationChain: [baselineMitigation],
      rationale:
        "No composite pattern matched. Applying single-vector response.",
    };
  }

  const { pattern, confidence } = classifyResult;

  return {
    mode: "COMPOSITE_OVERRIDE",
    patternId: pattern.id,
    patternLabel: pattern.label,
    confidence,
    mitigationChain: pattern.mitigationChain,
    rationale:
      `Hindsight matched composite pattern '${pattern.label}' with confidence ` +
      `${(confidence * 100).toFixed(1)}%. Escalating mitigation chain.`,
  };
}
