// ─────────────────────────────────────────────────────────────
// Task 5 — /api/analyze Route (Phase 3 Hindsight Pipeline)
//
// Full pipeline:
//   1. Parse InputTrigger from request body
//   2. recallSimilar(trigger, topK=5)
//   3. classifyPattern(similarIncidents, trigger.trigger_type)
//   4. Resolve baselineMitigation from trigger type map
//   5. buildDecision(classifyResult, baselineMitigation)
//   6. synthesizeReflection(decision, similarIncidents) — LLM call
//   7. storeIncident(artifact) — fire-and-forget
//   8. Return { trigger, decision, reflection, similarIncidents }
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { recallSimilar, storeIncident } from "../memory/memoryService";
import { classifyPattern } from "../hindsight/patternClassifier";
import { buildDecision } from "../hindsight/overrideEngine";
import { synthesizeReflection } from "../hindsight/reflectionSynthesizer";
import type { InputTrigger, MemoryArtifact } from "../types/memory";

const router = Router();

// ── Baseline mitigation map ───────────────────────────────────

const BASELINE_MITIGATION_MAP: Record<string, string> = {
  traffic_spike: "RATE_LIMIT",
  failed_logins: "ACCOUNT_LOCKOUT",
  port_scan: "FIREWALL_RULE",
  data_exfiltration: "ALERT_SOC",
  internal_lateral_movement: "SEGMENT_NETWORK",
};

function getBaselineMitigation(triggerType: string): string {
  return BASELINE_MITIGATION_MAP[triggerType] ?? "LOG_AND_MONITOR";
}

// ── POST /api/analyze ─────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  // ── Step 1: Parse InputTrigger from body ──────────────────
  const {
    session_id,
    trigger_type,
    source,
    severity,
    summary,
    indicators,
    // Support legacy Phase 2 payload envelope too
    payload,
  } = req.body as {
    session_id?: string;
    trigger_type?: string;
    source?: string;
    severity?: number;
    summary?: string;
    indicators?: Record<string, unknown>;
    payload?: Record<string, unknown>;
  };

  // Resolve trigger_type (required)
  const resolvedType = trigger_type ?? (payload?.["trigger_type"] as string | undefined);
  if (!resolvedType) {
    res.status(400).json({ error: "Missing required field: trigger_type" });
    return;
  }

  // Resolve severity — numeric 0–1; fall back from payload for Phase 2 compat
  const resolvedSeverity: number = (() => {
    if (typeof severity === "number") return severity;
    if (typeof payload?.["severity"] === "number") return payload["severity"] as number;
    return 0.5;
  })();

  // Resolve source
  const resolvedSource: string =
    source ??
    (typeof payload?.["source"] === "string" ? (payload["source"] as string) : "unknown");

  const trigger: InputTrigger = {
    trigger_type: resolvedType,
    source: resolvedSource,
    severity: resolvedSeverity,
    summary,
  };

  // ── Step 2: Recall similar past incidents ─────────────────
  let similarIncidents: Awaited<ReturnType<typeof recallSimilar>> = [];

  try {
    similarIncidents = await recallSimilar(trigger, 5);
    console.log(`[Hindsight] Found ${similarIncidents.length} similar past incidents`);
  } catch (err) {
    console.warn("[Hindsight] recall failed (non-fatal):", err);
  }

  // ── Step 3: Classify composite pattern ───────────────────
  const classifyResult = classifyPattern(similarIncidents, resolvedType);

  // ── Step 4: Resolve baseline mitigation ──────────────────
  const baselineMitigation = getBaselineMitigation(resolvedType);

  // ── Step 5: Build agent decision ─────────────────────────
  const decision = buildDecision(classifyResult, baselineMitigation);

  // ── Step 6: Synthesize LLM reflection ────────────────────
  let reflection = "";
  try {
    reflection = await synthesizeReflection(decision, similarIncidents);
  } catch (err) {
    console.error("[Hindsight] reflection synthesis failed:", err);
    reflection = "(Reflection unavailable — check ANTHROPIC_API_KEY in .env)";
  }

  // ── Step 7: Store incident (fire-and-forget) ─────────────
  const artifact: MemoryArtifact = {
    incident_id: uuidv4(),
    trigger_type: resolvedType,
    vectors: [],
    mitigation_success: decision.mode === "COMPOSITE_OVERRIDE" ? true : false,
    hindsight_note:
      `[${decision.mode}] ${decision.rationale} | ` +
      `Mitigations: ${decision.mitigationChain.join(", ")} | ` +
      `Summary: ${summary ?? `source:${resolvedSource} sev:${resolvedSeverity.toFixed(2)}`}`,
    created_at: new Date().toISOString(),
  };

  storeIncident(artifact).catch((err) => {
    console.error("[Hindsight] storeIncident failed (non-fatal):", err);
  });

  // ── Step 8: Return full decision envelope ─────────────────
  res.json({
    session_id: session_id ?? "unknown",
    trigger,
    decision,
    reflection,
    similarIncidents,
    // Legacy field kept for backward compat with Phase 2 tests
    used_memory: similarIncidents.length > 0,
    used_cascade: decision.mode === "COMPOSITE_OVERRIDE",
  });
});

export default router;
