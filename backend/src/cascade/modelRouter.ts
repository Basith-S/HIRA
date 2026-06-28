// ─────────────────────────────────────────────────────────────
// CascadeFlow — Model Router
//
// Decides which "model" handles this request and returns a
// simulated recommendation.  For the POC all LLM calls are
// deterministic mocks — the structure is designed so real API
// calls can replace the mock blocks without touching call-sites.
// ─────────────────────────────────────────────────────────────

import type { ComplexityScore } from "./complexityScorer";

export type ModelPath =
  | "fast_path"
  | "escalation_path"
  | "degraded_fallback";

export interface RoutingDecision {
  /** Which execution path was taken. */
  path: ModelPath;
  /** Name of the model used (may be a simulated label). */
  modelUsed: string;
  /** Human-readable reason for the routing choice (for audit trail). */
  reason: string;
  /** Estimated % latency saved vs always routing to the full model. */
  latencySavingPct: number;
}

export interface ModelResponse {
  /** Final recommendation text to surface to the user. */
  recommendation: string;
  /** Simulated token count for this request (budget tracking). */
  tokensUsed: number;
  /** The routing decision that produced this response. */
  routingDecision: RoutingDecision;
}

/** Hard cap on context tokens — triggers degraded fallback when exceeded. */
export const TOKEN_BUDGET = 8000;

// ── Latency model constants ────────────────────────────────────
// Used to compute realistic latency-saving estimates for the audit trail.
/** Average fast-model latency (ms) — llama-3-8b tier. */
const FAST_MODEL_AVG_MS = 420;
/** Average full-model latency (ms) — gpt-4o tier. */
const FULL_MODEL_AVG_MS = 1150;
/** Pre-computed saving % for fast-path routing vs always-full-model. */
const FAST_PATH_SAVING_PCT = Math.round((1 - FAST_MODEL_AVG_MS / FULL_MODEL_AVG_MS) * 100);

/**
 * Route the request to the appropriate (simulated) model and return a
 * recommendation with token usage and routing metadata.
 *
 * @param complexity               - Output of scoreComplexity()
 * @param hindsightRecommendation  - PatternMatcher recommendation if matched (null otherwise)
 * @param baselineRecommendation   - Switch-case fallback recommendation
 * @param triggerType              - e.g. "traffic_spike" | "failed_logins"
 * @param sessionId                - For log messages
 */
export async function routeToModel(
  complexity: ComplexityScore,
  hindsightRecommendation: string | null,
  baselineRecommendation: string,
  triggerType: string,
  sessionId: string
): Promise<ModelResponse> {
  // ── 1. Degraded fallback — token budget exceeded ────────────
  if (complexity.tokenEstimate > TOKEN_BUDGET) {
    console.log(
      `[CascadeFlow] ${sessionId}: token budget exceeded (${complexity.tokenEstimate} > ${TOKEN_BUDGET}), degrading to rule-based fallback`
    );
    const routingDecision: RoutingDecision = {
      path: "degraded_fallback",
      modelUsed: "rule-based memory lookup",
      reason: `Token estimate ${complexity.tokenEstimate} exceeds hard cap of ${TOKEN_BUDGET}. Falling back to deterministic rule-based lookup to avoid context overflow.`,
      latencySavingPct: 0,
    };
    return {
      recommendation:
        `[DEGRADED] Token budget exceeded (${complexity.tokenEstimate} tokens estimated). ` +
        `Falling back to rule-based memory lookup. ` +
        (hindsightRecommendation ?? baselineRecommendation),
      tokensUsed: complexity.tokenEstimate,
      routingDecision,
    };
  }

  // ── 2. Escalation path — high complexity or composite attack ─
  if (complexity.complexityLevel === "high" || complexity.compositeAttack) {
    console.log(
      `[CascadeFlow] ${sessionId}: escalating to full model (complexity=${complexity.complexityLevel}, composite=${complexity.compositeAttack})`
    );
    const routingDecision: RoutingDecision = {
      path: "escalation_path",
      modelUsed: "gpt-4o (simulated)",
      reason:
        complexity.compositeAttack
          ? `Composite attack pattern detected (pattern confidence ≥ 0.7). Full model required for multi-step forensic planning.`
          : `High complexity score: tokenEstimate=${complexity.tokenEstimate}, severity=${complexity.severity.toFixed(2)}, keywords=[${complexity.keywordsMatched.join(", ")}].`,
      latencySavingPct: 0,
    };

    const escalatedRecommendation = buildEscalatedRecommendation(
      triggerType,
      sessionId,
      complexity,
      hindsightRecommendation
    );

    return {
      recommendation: escalatedRecommendation,
      tokensUsed: complexity.tokenEstimate + 420, // simulated output tokens
      routingDecision,
    };
  }

  // ── 3. Fast path — low / medium complexity ──────────────────
  console.log(
    `[CascadeFlow] ${sessionId}: fast path selected (complexity=${complexity.complexityLevel})`
  );
  const routingDecision: RoutingDecision = {
    path: "fast_path",
    modelUsed: "llama-3-8b (simulated)",
    reason: `Low complexity (tokenEstimate=${complexity.tokenEstimate}, severity=${complexity.severity.toFixed(2)}). Fast path sufficient — no high-severity keywords, no composite pattern.`,
    latencySavingPct: FAST_PATH_SAVING_PCT,
  };

  const fastRecommendation = buildFastPathRecommendation(
    triggerType,
    sessionId,
    hindsightRecommendation
  );

  return {
    recommendation: fastRecommendation,
    tokensUsed: complexity.tokenEstimate + 120, // simulated output tokens
    routingDecision,
  };
}

// ── Simulated "model" outputs ──────────────────────────────────

function buildFastPathRecommendation(
  triggerType: string,
  sessionId: string,
  hindsightRecommendation: string | null
): string {
  if (hindsightRecommendation) {
    return `[FAST-PATH] ${hindsightRecommendation}`;
  }
  switch (triggerType) {
    case "traffic_spike":
      return (
        `[FAST-PATH] Anomalous traffic detected for ${sessionId} — ` +
        `apply rate-limit rule (500 req/min/IP) on ingress and monitor for 10 minutes.`
      );
    case "failed_logins":
      return (
        `[FAST-PATH] Authentication burst detected for ${sessionId} — ` +
        `lock targeted accounts for 15 minutes and enforce CAPTCHA on the login endpoint.`
      );
    default:
      return (
        `[FAST-PATH] Unknown trigger '${triggerType}' for ${sessionId} — ` +
        `route to Tier-1 analyst for triage.`
      );
  }
}

function buildEscalatedRecommendation(
  triggerType: string,
  sessionId: string,
  complexity: ComplexityScore,
  hindsightRecommendation: string | null
): string {
  const keywordNote =
    complexity.keywordsMatched.length > 0
      ? ` High-risk keywords detected: [${complexity.keywordsMatched.join(", ")}].`
      : "";

  if (hindsightRecommendation) {
    return (
      `[ESCALATED] Cross-session composite attack confirmed for ${sessionId}.${keywordNote} ` +
      `Full forensic response plan: (1) ${hindsightRecommendation} ` +
      `(2) Immediately isolate affected network segments. ` +
      `(3) Rotate all privileged credentials and invalidate active sessions. ` +
      `(4) Export forensic logs to SIEM and open P1 incident ticket. ` +
      `(5) Engage IR team and notify stakeholders within 30 minutes.`
    );
  }

  switch (triggerType) {
    case "traffic_spike":
      return (
        `[ESCALATED] Severe traffic anomaly confirmed for ${sessionId}.${keywordNote} ` +
        `Full response plan: (1) Engage DDoS mitigation provider immediately. ` +
        `(2) Block offending CIDR blocks at edge. ` +
        `(3) Scale ingress horizontally and enable geo-fencing. ` +
        `(4) Alert NOC and open P1 incident. ` +
        `(5) Review BGP routes for traffic hijacking.`
      );
    case "failed_logins":
      return (
        `[ESCALATED] Critical authentication attack confirmed for ${sessionId}.${keywordNote} ` +
        `Full response plan: (1) Hard-lock all targeted accounts. ` +
        `(2) Force 2FA re-enrollment on next login. ` +
        `(3) Rotate all API keys and session tokens. ` +
        `(4) Submit attacker IPs to threat intelligence feed. ` +
        `(5) Engage SOC and initiate credential-stuffing forensics.`
      );
    default:
      return (
        `[ESCALATED] High-severity unknown trigger '${triggerType}' for ${sessionId}.${keywordNote} ` +
        `Escalating to senior analyst with full context dump and P1 priority.`
      );
  }
}
