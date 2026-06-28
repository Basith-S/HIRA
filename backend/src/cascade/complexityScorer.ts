// ─────────────────────────────────────────────────────────────
// CascadeFlow — Complexity Scorer
//
// Synchronous (no async) — runs before any model call so the
// routing decision adds zero extra latency.
//
// FIX (audit pass):
//   - Token count now derived from full serialised trigger JSON
//     (Math.ceil(JSON.stringify(trigger).length / 4)) so that
//     indicator-rich payloads produce higher estimates than
//     bare severity-only requests.
//   - Keyword scanner scans the full serialised trigger string,
//     not just a summary substring — catches values inside
//     nested indicators (e.g. known_breach_list_match).
//   - Added keywords: "breach", "credential", "exfil",
//     "lateral", "privilege"
//   - Complexity tier simplified to 2-tier:
//       High  → tokenEstimate >= 200 OR any keyword matched
//       Low   → everything else
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

// Keywords that immediately signal a high-severity scenario.
// Scanned against the full JSON-serialised trigger (including indicators).
const HIGH_SEVERITY_KEYWORDS: string[] = [
  // Original entries
  "takeover",
  "admin access",
  "defacement",
  "ransomware",
  "exfiltration",
  "privilege escalation",
  "root",
  "site takeover",
  // Added in audit pass
  "breach",
  "credential",
  "exfil",
  "lateral",
  "privilege",
];

/**
 * Score the incoming request complexity.
 *
 * @param trigger           - Full trigger object (including payload indicators) to serialise
 * @param patternConfidence - Confidence from PatternMatchResult (0 if not matched)
 * @param severity          - Severity from payload (0.0 – 1.0)
 * @param pastIncidentCount - Number of recalled incidents in context
 */
export function scoreComplexity(
  trigger: Record<string, unknown>,
  patternConfidence: number,
  severity: number,
  pastIncidentCount: number
): ComplexityScore {
  // ── Token estimate ──────────────────────────────────────────
  // Derived from the full serialised trigger JSON so that
  // indicator-rich payloads (many fields) score higher than
  // bare severity-only requests.
  // 1 token ≈ 4 chars; each recalled incident adds ~150 tokens.
  const serialized = JSON.stringify(trigger);
  const tokenEstimate =
    Math.ceil(serialized.length / 4) + pastIncidentCount * 150;

  // ── Keyword scan (case-insensitive, full serialised payload) ─
  const lowerSerialized = serialized.toLowerCase();
  const keywordsMatched = HIGH_SEVERITY_KEYWORDS.filter((kw) =>
    lowerSerialized.includes(kw.toLowerCase())
  );

  // ── Composite attack flag ───────────────────────────────────
  const compositeAttack = patternConfidence >= 0.7;

  // ── Complexity tier (2-tier) ────────────────────────────────
  // High  → token count >= 200 OR any high-severity keyword present
  // Low   → everything else
  const complexityLevel: ComplexityScore["complexityLevel"] =
    tokenEstimate >= 200 || keywordsMatched.length > 0 ? "high" : "low";

  return {
    tokenEstimate,
    keywordsMatched,
    compositeAttack,
    severity,
    complexityLevel,
  };
}
