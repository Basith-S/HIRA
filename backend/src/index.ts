// ─────────────────────────────────────────────────────────────
// Express Server Entry Point — SENTRI Backend (Phase 4)
//
// Boot order:
//   1. Load .env
//   2. Init ChromaDB vector store
//   3. Mount API routes
//   4. Listen
// ─────────────────────────────────────────────────────────────

import path from "path";
import dotenv from "dotenv";
// Load .env relative to this file's location
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import { initVectorStore } from "./memory/vectorStore";
import { TOKEN_BUDGET } from "./cascade/modelRouter";
import analyzeRouter from "./routes/analyze";
import memoryRouter from "./routes/memory";

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// ── Middleware ────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    memory: "chroma_connected",
    phases: [1, 2, 3, 4, 5],
    version: "0.5.0",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    memory: "chroma_connected",
    phases: [1, 2, 3, 4, 5],
    version: "0.5.0",
  });
});

// ── CascadeFlow status ────────────────────────────────────────

app.get("/api/cascade/status", (_req, res) => {
  res.json({
    engine: "CascadeFlow",
    phase: 4,
    status: "active",
    tokenBudget: TOKEN_BUDGET,
    description:
      "CascadeFlow Routing Engine — scores complexity, routes to fast/escalation/degraded model path, and appends a structured audit trail to every /api/analyze response.",
    paths: {
      fast_path: "llama-3-8b (simulated) — low/medium complexity, ≤8k tokens",
      escalation_path: "gpt-4o (simulated) — high complexity or composite attack",
      degraded_fallback: "rule-based memory lookup — token budget exceeded",
    },
  });
});

// ── Routes ────────────────────────────────────────────────────

app.get("/api/sessions", (_req, res) => {
  res.json([
    {
      session_id: "Session 1",
      trigger_type: "traffic_spike",
      payload: {
        timestamp: new Date().toISOString(),
        source: "203.0.113.42",
        requests_per_second: 12500,
        baseline_rps: 800,
        severity: 0.87,
        summary: "DDoS-like traffic spike against public ingress",
      },
    },
    {
      session_id: "Session 2",
      trigger_type: "traffic_spike",
      payload: {
        timestamp: new Date().toISOString(),
        source: "203.0.113.42",
        requests_per_second: 1800,
        baseline_rps: 900,
        severity: 0.5,
        summary: "Control traffic fluctuation from a previously observed source",
      },
    },
    {
      session_id: "Session 3",
      trigger_type: "failed_logins",
      payload: {
        timestamp: new Date().toISOString(),
        source: "198.51.100.17",
        attempt_count: 342,
        time_window_secs: 60,
        target_accounts: ["admin@acme.io", "cto@acme.io", "root"],
        severity: 0.93,
        summary: "Credential stuffing burst after traffic spike",
      },
    },
    {
      session_id: "Session 4",
      trigger_type: "traffic_spike",
      payload: {
        timestamp: new Date().toISOString(),
        source: "10.0.0.0/8",
        requests_per_second: 32000,
        baseline_rps: 1600,
        severity: 0.97,
        summary: "Critical takeover precursor with traffic and credential correlation",
      },
    },
    {
      session_id: "Session 5",
      trigger_type: "traffic_spike",
      payload: {
        timestamp: new Date().toISOString(),
        source: "10.0.0.0/8",
        requests_per_second: 45000,
        baseline_rps: 2000,
        severity: 0.95,
        summary: "Final POC composite takeover precursor",
      },
    },
    {
      session_id: "Session 6 (Edge)",
      trigger_type: "data_exfiltration",
      payload: {
        timestamp: new Date().toISOString(),
        source: "db-prod-01",
        bytes_out: 900000000,
        severity: 0.98,
        raw_log_dump: "exfiltration ".repeat(3200),
        summary: "Oversized exfiltration context to force token budget fallback",
      },
    },
  ]);
});

app.use("/api/analyze", analyzeRouter);
app.use("/api/memory", memoryRouter);

// ── Startup ───────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log("[SENTRI] Initializing vector store…");
  await initVectorStore();

  app.listen(PORT, () => {
    console.log(`[SENTRI] Backend running on http://localhost:${PORT}`);
    console.log(`[SENTRI] Phase 4 — CascadeFlow routing engine active`);
    console.log(`[SENTRI]   POST  /api/analyze`);
    console.log(`[SENTRI]   GET   /api/memory/recall?type=&severity=`);
    console.log(`[SENTRI]   POST  /api/memory/reset`);
    console.log(`[SENTRI]   GET   /api/cascade/status`);
    console.log(`[SENTRI]   GET   /health`);
  });
}

bootstrap().catch((err) => {
  console.error("[SENTRI] Fatal startup error:", err);
  process.exit(1);
});
