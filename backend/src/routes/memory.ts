// ─────────────────────────────────────────────────────────────
// Task 6 — GET /api/memory/recall
//
// Manual verification endpoint.  Build a dummy InputTrigger from
// query params and return top-3 similar past incidents as JSON.
//
// Usage: GET /api/memory/recall?type=traffic_spike&severity=high
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from "express";
import { recallSimilar, resetMemory } from "../memory/memoryService";
import { resetPhase5FallbackMemory } from "./analyze";
import type { InputTrigger } from "../types/memory";

const router = Router();

// ── GET /api/memory/recall ────────────────────────────────────

router.get("/recall", async (req: Request, res: Response) => {
  const rawType = typeof req.query["type"] === "string" ? req.query["type"] : "unknown";
  const rawSeverity = typeof req.query["severity"] === "string" ? req.query["severity"] : "0.5";
  const rawSource = typeof req.query["source"] === "string" ? req.query["source"] : "manual-test";

  // Map named severity labels to numeric scores
  const severityMap: Record<string, number> = {
    low: 0.2,
    medium: 0.5,
    high: 0.8,
    critical: 1.0,
  };
  const severityScore =
    severityMap[rawSeverity.toLowerCase()] ?? parseFloat(rawSeverity) ?? 0.5;

  const trigger: InputTrigger = {
    trigger_type: rawType,
    source: rawSource,
    severity: isNaN(severityScore) ? 0.5 : severityScore,
  };

  try {
    const results = await recallSimilar(trigger, 3);
    res.json({
      query: trigger,
      count: results.length,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Recall failed", detail: message });
  }
});

// ── POST /api/memory/reset ────────────────────────────────────

router.post("/reset", async (req: Request, res: Response) => {
  try {
    await resetMemory();
    resetPhase5FallbackMemory();
    res.json({ status: "success", message: "Memory subsystems cleared successfully." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: "Reset failed", detail: message });
  }
});

export default router;
