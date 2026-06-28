// ─────────────────────────────────────────────────────────────
// Phase 4 — /api/analyze Route with CascadeFlow Routing Engine
//
// Pipeline (in order):
//   PRE:      recallSimilar(trigger) → attach to context
//   CORE:     hindsight pattern matching / behavioral override
//   CASCADE:  scoreComplexity → routeToModel → buildAuditTrail
//   POST:     storeIncident(resolvedArtifact)
//   RESPONSE: JSON with full cascade fields
//
// Phase 3 hindsight logic is preserved intact — CascadeFlow
// wraps its output, it does NOT replace it.
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { recallSimilar, storeIncident } from "../memory/memoryService";
import { matchPatterns } from "../memory/patternMatcher";
import { buildSummaryText } from "../memory/embedder";
import { scoreComplexity } from "../cascade/complexityScorer";
import { routeToModel, TOKEN_BUDGET } from "../cascade/modelRouter";
import { buildAuditTrail } from "../cascade/auditTrail";
import type { InputTrigger, MemoryArtifact } from "../types/memory";

const router = Router();

// ── POST /api/analyze ─────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { session_id, trigger_type, payload } = req.body as {
    session_id: string;
    trigger_type: string;
    payload: Record<string, unknown>;
  };

  if (!session_id || !trigger_type || !payload) {
    res.status(400).json({
      error: "Missing required fields: session_id, trigger_type, payload",
    });
    return;
  }

  // ── PRE: Recall similar past incidents ─────────────────────
  const severity =
    typeof payload["severity"] === "number" ? (payload["severity"] as number) : 0.5;
  const source =
    typeof payload["source"] === "string" ? (payload["source"] as string) : "unknown";

  const incomingTrigger: InputTrigger = {
    trigger_type,
    source,
    severity,
  };

  let pastIncidents: Awaited<ReturnType<typeof recallSimilar>> = [];

  try {
    pastIncidents = await recallSimilar(incomingTrigger);
    console.log(`[Hindsight] Found ${pastIncidents.length} similar past incidents`);
  } catch (err) {
    // Memory recall is non-fatal — log and continue with baseline
    console.warn("[Hindsight] recall failed (non-fatal):", err);
  }

  // ── CORE: Hindsight pattern matching & Override ───────────
  let isOverridden = false;
  let matchConfidence = 0.0;
  let hindsightRecommendation: string | null = null;

  // Build baseline switch-case recommendation
  let baselineRecommendation: string;
  switch (trigger_type) {
    case "traffic_spike":
      baselineRecommendation =
        `[BASELINE] Traffic spike detected for session '${session_id}'. ` +
        `Generic recommendation: enable rate-limiting on the affected ` +
        `ingress and monitor for 15 minutes. No CascadeFlow reasoning was applied.`;
      break;

    case "failed_logins":
      baselineRecommendation =
        `[BASELINE] Failed login burst detected for session '${session_id}'. ` +
        `Generic recommendation: temporarily lock the targeted accounts, ` +
        `enforce CAPTCHA on the login endpoint, and alert the SOC team. ` +
        `No CascadeFlow reasoning was applied.`;
      break;

    default:
      baselineRecommendation =
        `[BASELINE] Unknown trigger type '${trigger_type}' for session '${session_id}'. ` +
        `Generic recommendation: forward to a human analyst for triage.`;
  }

  const patternResult = matchPatterns(incomingTrigger, pastIncidents);
  if (patternResult.matched && patternResult.recommendation) {
    hindsightRecommendation = patternResult.recommendation;
    isOverridden = true;
    matchConfidence = patternResult.confidence ?? 0.0;
    console.log(
      `[Hindsight] Applied behavioral override for ${session_id} (Confidence: ${matchConfidence})`
    );
  }

  // ── CASCADE: Build trigger text for scoring ────────────────
  // Build the summary text the same way the embedder does,
  // including source and trigger context in the summary string.
  const triggerSummary = `source:${source} trigger:${trigger_type} severity:${severity.toFixed(2)}` +
    (hindsightRecommendation ? ` hindsight:${hindsightRecommendation.substring(0, 120)}` : "");
  const triggerText = buildSummaryText(trigger_type, severity, triggerSummary);

  // ── CASCADE: Score complexity ──────────────────────────────
  const complexity = scoreComplexity(
    triggerText,
    matchConfidence,
    severity,
    pastIncidents.length
  );
  console.log(
    `[CascadeFlow] Complexity: ${complexity.complexityLevel} | ` +
    `tokens: ${complexity.tokenEstimate} | ` +
    `keywords: [${complexity.keywordsMatched.join(", ")}] | ` +
    `composite: ${complexity.compositeAttack}`
  );

  // ── CASCADE: Route to model ────────────────────────────────
  const modelResponse = await routeToModel(
    complexity,
    hindsightRecommendation,
    baselineRecommendation,
    trigger_type,
    session_id
  );

  // ── CASCADE: Build audit trail ─────────────────────────────
  const auditDecisions: string[] = [];
  if (pastIncidents.length > 0) {
    auditDecisions.push(`Retrieved ${pastIncidents.length} past incident(s) from memory`);
  }
  if (isOverridden) {
    auditDecisions.push(`Applied hindsight rule (confidence: ${(matchConfidence * 100).toFixed(0)}%)`);
  }
  auditDecisions.push(
    modelResponse.routingDecision.path === "fast_path"
      ? "Routed to fast model"
      : modelResponse.routingDecision.path === "escalation_path"
      ? "Escalated to full model"
      : "Degraded to rule-based fallback"
  );
  if (modelResponse.routingDecision.path === "escalation_path" && isOverridden) {
    auditDecisions.push("Recommended 2FA enforcement + credential rotation");
  }

  const auditBlock = buildAuditTrail(
    complexity,
    modelResponse.routingDecision,
    modelResponse.tokensUsed,
    auditDecisions
  );

  // The final recommendation comes from the model router
  const recommendation = modelResponse.recommendation;

  // ── POST: Store the resolved artifact ─────────────────────
  const artifact: MemoryArtifact = {
    incident_id: uuidv4(),
    trigger_type,
    vectors: [],           // Populated internally by memoryService.storeIncident
    mitigation_success: true,
    hindsight_note: recommendation,
    created_at: new Date().toISOString(),
  };

  // Fire-and-forget storage so the response is not delayed
  storeIncident(artifact).catch((err) => {
    console.error("[Hindsight] storeIncident failed (non-fatal):", err);
  });

  // ── Response ───────────────────────────────────────────────
  res.json({
    session_id,
    trigger_type,
    recommendation,
    used_memory: pastIncidents.length > 0,
    used_cascade: true,        // always true — Phase 4 is active
    context: {
      pastIncidents,
      overridden: isOverridden,
      confidence: matchConfidence,
      // ── Phase 4 CascadeFlow fields ──
      cascadeAudit: auditBlock,
      modelPath: modelResponse.routingDecision.path,
      tokenBudget: TOKEN_BUDGET,
      tokensUsed: modelResponse.tokensUsed,
    },
  });
});

export default router;
