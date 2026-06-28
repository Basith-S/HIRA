// ─────────────────────────────────────────────────────────────
// CascadeFlow — Complexity Scorer
//
// Synchronous (no async) — runs before any model call so the
// routing decision adds zero extra latency.
// ─────────────────────────────────────────────────────────────

export interface ComplexityScore {
  /** Rough token count of the full request context. */
  tokenEstimate: number;
  /** High-severity keywords found in the trigger text (case-insensitive). */
  keywordsMatched: string[];
  /** True if patternMatcher already flagged a composite attack. */
  compositeAttack: boolean;
  /** Raw severity from InputTrigger payload (0.0 – 1.0). */
  severity: number;
  /** Derived complexity tier. */
  complexityLevel: "low" | "medium" | "high";
}

// Keywords that immediately signal a high-severity scenario
const HIGH_SEVERITY_KEYWORDS: string[] = [
  "takeover",
  "admin access",
  "defacement",
  "ransomware",
  "exfiltration",
  "privilege escalation",
  "root",
  "site takeover",
];

/**
 * Score the incoming request complexity.
 *
 * @param triggerText        - Summary text fed to the embedder (or built inline)
 * @param patternConfidence  - Confidence from PatternMatchResult (0 if not matched)
 * @param severity           - Severity from payload (0.0 – 1.0)
 * @param pastIncidentCount  - Number of recalled incidents in context
 */
export function scoreComplexity(
  triggerText: string,
  patternConfidence: number,
  severity: number,
  pastIncidentCount: number
): ComplexityScore {
  // ── Token estimate ──────────────────────────────────────────
  // Rough heuristic: 1 token ≈ 4 chars, each recalled incident adds ~150 tokens
  const tokenEstimate =
    Math.ceil(triggerText.length / 4) + pastIncidentCount * 150;

  // ── Keyword scan (case-insensitive) ────────────────────────
  const lowerText = triggerText.toLowerCase();
  const keywordsMatched = HIGH_SEVERITY_KEYWORDS.filter((kw) =>
    lowerText.includes(kw.toLowerCase())
  );

  // ── Composite attack flag ───────────────────────────────────
  const compositeAttack = patternConfidence >= 0.7;

  // ── Complexity tier ─────────────────────────────────────────
  let complexityLevel: ComplexityScore["complexityLevel"];

  if (
    tokenEstimate > 2000 ||
    keywordsMatched.length > 0 ||
    patternConfidence >= 0.8 ||
    severity >= 0.9
  ) {
    complexityLevel = "high";
  } else if (
    tokenEstimate < 500 &&
    severity < 0.7 &&
    keywordsMatched.length === 0 &&
    patternConfidence < 0.5
  ) {
    complexityLevel = "low";
  } else {
    complexityLevel = "medium";
  }

  return {
    tokenEstimate,
    keywordsMatched,
    compositeAttack,
    severity,
    complexityLevel,
  };
}
