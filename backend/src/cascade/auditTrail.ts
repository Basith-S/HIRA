// ─────────────────────────────────────────────────────────────
// CascadeFlow — Audit Trail Builder
//
// Produces a structured audit block appended to every response.
// The `formatted` string matches the POC spec exactly so demo
// screenshots are clean.
// ─────────────────────────────────────────────────────────────

import type { ComplexityScore } from "./complexityScorer";
import type { RoutingDecision } from "./modelRouter";

export interface CascadeAuditBlock {
  /** Human-readable complexity description. */
  complexity: string;
  /** Human-readable model path description. */
  modelPath: string;
  /** Token usage as "used / budget" string. */
  tokensUsed: string;
  /** Ordered list of key decisions made during this request. */
  decisions: string[];
  /** Estimated % latency saved vs always using the full model. */
  latencySavingPct: number;
  /** Pre-formatted printable audit block string (matches POC spec). */
  formatted: string;
}

/**
 * Build the CascadeFlow audit trail for a single request.
 *
 * @param complexity  - Output of scoreComplexity()
 * @param routing     - Output of routeToModel().routingDecision
 * @param tokensUsed  - Actual (simulated) tokens consumed
 * @param decisions   - Ordered decision strings, e.g. ["Retrieved INC-001", "Escalated to full model"]
 */
export function buildAuditTrail(
  complexity: ComplexityScore,
  routing: RoutingDecision,
  tokensUsed: number,
  decisions: string[]
): CascadeAuditBlock {
  // ── Human-readable complexity label ────────────────────────
  const keywordSuffix =
    complexity.keywordsMatched.length > 0
      ? ` (${complexity.keywordsMatched.slice(0, 2).join(" + ")} detected)`
      : complexity.compositeAttack
      ? " (credential + traffic correlation)"
      : "";
  const complexityStr = `${capitalise(complexity.complexityLevel)}${keywordSuffix}`;

  // ── Human-readable model path label ────────────────────────
  let modelPathStr: string;
  switch (routing.path) {
    case "fast_path":
      modelPathStr = `fast_model (${routing.modelUsed})`;
      break;
    case "escalation_path":
      modelPathStr = `fast_model → full_model (escalated after pattern match)`;
      break;
    case "degraded_fallback":
      modelPathStr = `rule-based memory lookup (token budget exceeded)`;
      break;
  }

  const tokenBudget = 8000;
  const tokensUsedStr = `${tokensUsed} / ${tokenBudget}`;
  const decisionsStr = decisions.join(", ");
  const latencyStr =
    routing.latencySavingPct > 0
      ? `~${routing.latencySavingPct}% vs always-full-model`
      : "none (full model used)";

  // ── Formatted block — must match POC spec exactly ──────────
  const formatted = [
    `[CascadeFlow Audit]`,
    `- Complexity: ${complexityStr}`,
    `- Model Path: ${modelPathStr}`,
    `- Tokens used: ${tokensUsedStr}`,
    `- Decisions: ${decisionsStr}`,
    `- Latency saving: ${latencyStr}`,
  ].join("\n");

  return {
    complexity: complexityStr,
    modelPath: modelPathStr,
    tokensUsed: tokensUsedStr,
    decisions,
    latencySavingPct: routing.latencySavingPct,
    formatted,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
