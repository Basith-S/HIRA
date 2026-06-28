// ─────────────────────────────────────────────────────────────
// Task 1 — Pattern Classifier
//
// Matches a set of SimilarIncidents + an incoming trigger type
// against a hard-coded registry of composite attack patterns.
//
// Distance threshold: < 0.55  (adjusted from spec's 0.35 to match
// real Voyage AI cosine distances; see implementation plan for rationale)
// ─────────────────────────────────────────────────────────────

import type { SimilarIncident } from "../types/memory";

// ── Types ─────────────────────────────────────────────────────

export type CompositePattern = {
  /** Unique pattern identifier, e.g. "ddos+credential_stuffing". */
  id: string;
  /** Human-readable label shown in the AgentDecision. */
  label: string;
  /** Attack trigger types that must ALL co-occur to match this pattern. */
  vectorTypes: string[];
  /** Minimum confidence score (0–1) required to trigger an override. */
  confidenceThreshold: number;
  /** Ordered list of mitigation actions to execute on a match. */
  mitigationChain: string[];
};

/**
 * Return type of classifyPattern — wraps the matched pattern with
 * the computed confidence score so callers can thread it through to
 * buildDecision without re-computing.
 */
export type ClassifyResult = {
  pattern: CompositePattern;
  confidence: number;
};

// ── Pattern Registry ──────────────────────────────────────────

export const COMPOSITE_PATTERNS: CompositePattern[] = [
  {
    id: "ddos+credential_stuffing",
    label: "DDoS-Masked Credential Stuffing",
    vectorTypes: ["traffic_spike", "failed_logins"],
    confidenceThreshold: 0.72,
    mitigationChain: ["WAF_BLOCK", "ENABLE_2FA", "ROTATE_TOKENS"],
  },
  {
    id: "recon+exfil",
    label: "Recon-to-Exfiltration Chain",
    vectorTypes: ["port_scan", "data_exfiltration"],
    confidenceThreshold: 0.68,
    mitigationChain: ["ISOLATE_ENDPOINT", "REVOKE_API_KEYS", "ALERT_SOC"],
  },
  {
    id: "bruteforce+lateral",
    label: "Brute Force with Lateral Movement",
    vectorTypes: ["failed_logins", "internal_lateral_movement"],
    confidenceThreshold: 0.65,
    mitigationChain: ["LOCKOUT_ACCOUNTS", "SEGMENT_NETWORK", "ROTATE_TOKENS"],
  },
];

// ── Core Classifier ───────────────────────────────────────────

/**
 * Classify a set of recalled similar incidents + the incoming trigger
 * against the composite pattern registry.
 *
 * Algorithm:
 *   1. Collect all `trigger_type` values from incidents where distance < 0.55
 *   2. Include `incomingType` in that set
 *   3. For each pattern, check if ALL vectorTypes appear in the set
 *   4. Compute confidence = 1 − (average distance of incidents matching the pattern)
 *      If no stored incidents matched (only incomingType contributed), use 0.50
 *   5. Return the first pattern where confidence >= confidenceThreshold, else null
 *
 * @param similarIncidents - ChromaDB recall results (ordered by ascending distance)
 * @param incomingType     - The trigger_type of the current incoming event
 */
export function classifyPattern(
  similarIncidents: SimilarIncident[],
  incomingType: string
): ClassifyResult | null {
  // Step 1: Filter to incidents within the distance budget
  const DISTANCE_THRESHOLD = 0.55;
  const relevant = similarIncidents.filter(
    (inc) => inc.distance < DISTANCE_THRESHOLD
  );

  // Step 2: Build the observed type set
  const observedTypes = new Set<string>([incomingType]);
  for (const inc of relevant) {
    const t = inc.metadata["trigger_type"];
    if (t) observedTypes.add(t);
  }

  // Step 3–5: Check each pattern in order
  for (const pattern of COMPOSITE_PATTERNS) {
    const allPresent = pattern.vectorTypes.every((vt) => observedTypes.has(vt));
    if (!allPresent) continue;

    // Incidents that contributed a type required by this pattern
    const contributors = relevant.filter((inc) =>
      pattern.vectorTypes.includes(inc.metadata["trigger_type"] ?? "")
    );

    let confidence: number;
    if (contributors.length === 0) {
      // incomingType alone satisfied all vectorTypes (single-event pattern)
      confidence = 0.5;
    } else {
      const avgDistance =
        contributors.reduce((sum, inc) => sum + inc.distance, 0) /
        contributors.length;
      confidence = 1 - avgDistance;
    }

    if (confidence >= pattern.confidenceThreshold) {
      return { pattern, confidence };
    }
  }

  return null;
}
