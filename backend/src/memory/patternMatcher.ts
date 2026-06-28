import type { InputTrigger, SimilarIncident } from "../types/memory";

export interface PatternMatchResult {
  matched: boolean;
  recommendation?: string;
  confidence?: number;
}

/**
 * Cross-references the current trigger against recalled past incidents
 * to detect composite, multi-session attack patterns.
 *
 * Pattern Rules:
 *   1. traffic_spike & no history -> Generic rate limiting (baseline fallback).
 *   2. failed_logins & recalled traffic_spike -> Correlated stuffing (Session 3 delta).
 *   3. traffic_spike & recalled (traffic_spike + failed_logins) -> Full lockout chain (Session 5 delta).
 */
export function matchPatterns(
  currentTrigger: InputTrigger,
  recalledIncidents: SimilarIncident[]
): PatternMatchResult {
  const currentType = currentTrigger.trigger_type;

  // Filter recalled incidents to those with reasonable similarity
  // Since we use cosine distance in ChromaDB, we use a threshold of 1.0 to allow cross-type matching.
  const relevantPast = recalledIncidents.filter((inc) => inc.distance < 1.0);

  const hasPastTrafficSpike = relevantPast.some(
    (inc) => inc.metadata["trigger_type"] === "traffic_spike"
  );
  const hasPastFailedLogins = relevantPast.some(
    (inc) => inc.metadata["trigger_type"] === "failed_logins"
  );

  // Scenario 3: traffic_spike + past traffic_spike + past failed_logins -> PRECURSOR TO SITE TAKEOVER
  if (currentType === "traffic_spike" && hasPastTrafficSpike && hasPastFailedLogins) {
    console.log("[PatternMatcher] Match: Session 5 Composite Attack Pattern (Traffic Spike -> Brute Force -> Takeover Precursor)");
    return {
      matched: true,
      recommendation:
        "High-confidence Credential Stuffing + potential Takeover precursor (correlated with Session 1 and Session 3). " +
        "Recommended lockdown: WAF rule on login endpoint + 2FA enforcement + session token rotation + forensic log export.",
      confidence: 0.85,
    };
  }

  // Scenario 2: failed_logins + past traffic_spike -> CORRELATED BRUTE FORCE
  if (currentType === "failed_logins" && hasPastTrafficSpike) {
    console.log("[PatternMatcher] Match: Session 3 Correlated Anomaly (Traffic Spike preceding authentication burst)");
    return {
      matched: true,
      recommendation:
        "Failed logins burst detected. Correlated with past traffic spike (Session 1). " +
        "Suggest enforcing CAPTCHA and performing IP reputation checks.",
      confidence: 0.7,
    };
  }

  // Scenario 1: Anything else falls back to baseline behavior
  return {
    matched: false,
  };
}
