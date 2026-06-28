// ─────────────────────────────────────────────────────────────
// Task 5 — /api/analyze Route
//
// Mirrors the Phase 1 dumb baseline routing logic.
// Memory is additive context only — the response logic is unchanged.
//
// Pipeline:
//   PRE:  recallSimilar(trigger) → attach to context
//   CORE: generate baseline recommendation (dumb routing)
//   POST: storeIncident(resolvedArtifact)
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { recallSimilar, storeIncident } from "../memory/memoryService";
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

  // ── CORE: Dumb baseline recommendation (Phase 1 logic) ─────
  let recommendation: string;
  switch (trigger_type) {
    case "traffic_spike":
      recommendation =
        `[BASELINE] Traffic spike detected for session '${session_id}'. ` +
        `Generic recommendation: enable rate-limiting on the affected ` +
        `ingress and monitor for 15 minutes. No CascadeFlow reasoning was applied.`;
      break;

    case "failed_logins":
      recommendation =
        `[BASELINE] Failed login burst detected for session '${session_id}'. ` +
        `Generic recommendation: temporarily lock the targeted accounts, ` +
        `enforce CAPTCHA on the login endpoint, and alert the SOC team. ` +
        `No CascadeFlow reasoning was applied.`;
      break;

    default:
      recommendation =
        `[BASELINE] Unknown trigger type '${trigger_type}' for session '${session_id}'. ` +
        `Generic recommendation: forward to a human analyst for triage.`;
  }

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
    used_cascade: false,
    context: {
      pastIncidents,
    },
  });
});

export default router;
