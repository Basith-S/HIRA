// ─────────────────────────────────────────────────────────────
// Express Server Entry Point — SENTRI Backend (Phase 7)
//
// Boot order:
//   1. Load .env
//   2. Init ChromaDB vector store
//   3. Check Ollama dependencies (non-blocking)
//   4. Mount API routes
//   5. Listen
// ─────────────────────────────────────────────────────────────

import path from "path";
import dotenv from "dotenv";
// Load .env relative to this file's location
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import { initVectorStore } from "./memory/vectorStore";
import { TOKEN_BUDGET } from "./cascade/cascadeRouter";
import { DEMO_SESSIONS } from "./demo/sessionScript";
import { checkOllamaHealth } from "./ollama/ollamaClient";
import analyzeRouter from "./routes/analyze";
import memoryRouter from "./routes/memory";

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// ── Middleware ────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────

app.get("/health", async (_req, res) => {
  const ollama = await checkOllamaHealth();
  const hasClassifier = ollama.models.some((m) => m.includes("sentri-classifier"));
  const hasAnalyzer = ollama.models.some((m) => m.includes("sentri-analyzer"));
  const isDegraded = !ollama.online || !hasClassifier || !hasAnalyzer;

  res.json({
    status: isDegraded ? "degraded" : "ok",
    services: {
      chroma: "connected",
      ollama: ollama.online ? "online" : "offline",
      models: {
        classifier: hasClassifier ? "ready" : "missing",
        analyzer: hasAnalyzer ? "ready" : "missing",
      },
    },
    phases: [1, 2, 3, 4, 5, 6, 7],
    version: "0.7.0",
  });
});

app.get("/api/health", async (_req, res) => {
  const ollama = await checkOllamaHealth();
  const hasClassifier = ollama.models.some((m) => m.includes("sentri-classifier"));
  const hasAnalyzer = ollama.models.some((m) => m.includes("sentri-analyzer"));
  const isDegraded = !ollama.online || !hasClassifier || !hasAnalyzer;

  res.json({
    status: isDegraded ? "degraded" : "ok",
    services: {
      chroma: "connected",
      ollama: ollama.online ? "online" : "offline",
      models: {
        classifier: hasClassifier ? "ready" : "missing",
        analyzer: hasAnalyzer ? "ready" : "missing",
      },
    },
    phases: [1, 2, 3, 4, 5, 6, 7],
    version: "0.7.0",
  });
});

// ── CascadeFlow status ────────────────────────────────────────

app.get("/api/cascade/status", (_req, res) => {
  res.json({
    engine: "CascadeFlow (Ollama Local SLM)",
    phase: 7,
    status: "active",
    tokenBudget: TOKEN_BUDGET,
    description:
      "CascadeFlow Routing Engine — Intake classifier (sentri-classifier / phi3:mini) → conditional Deep Analysis (sentri-analyzer / mistral:7b), appending structured audit trail.",
    paths: {
      fast_path: "sentri-classifier (phi3:mini) — classification & baseline mitigation",
      escalation_path: "sentri-analyzer (mistral:7b) — deep forensic analysis",
      degraded_fallback: "rule-based memory lookup — token budget exceeded",
    },
  });
});

// ── Routes ────────────────────────────────────────────────────

app.get("/api/sessions", (_req, res) => {
  res.json(DEMO_SESSIONS);
});

app.use("/api/analyze", analyzeRouter);
app.use("/api/memory", memoryRouter);

// ── Ollama dependency check (non-blocking) ────────────────────

async function checkDependencies(): Promise<void> {
  const ollama = await checkOllamaHealth();

  if (!ollama.online) {
    console.warn("[SENTRI] ⚠ Ollama not detected at http://localhost:11434");
    console.warn("[SENTRI]   Run: ollama serve");
    console.warn("[SENTRI]   Then: npm run setup:models");
    console.warn("[SENTRI]   Continuing in degraded mode — analysis unavailable");
    return;
  }

  const hasClassifier = ollama.models.some((m) => m.includes("sentri-classifier"));
  const hasAnalyzer = ollama.models.some((m) => m.includes("sentri-analyzer"));

  if (!hasClassifier || !hasAnalyzer) {
    console.warn("[SENTRI] ⚠ SENTRI models not built. Run: npm run setup:models");
    if (!hasClassifier) console.warn("[SENTRI]   Missing: sentri-classifier");
    if (!hasAnalyzer) console.warn("[SENTRI]   Missing: sentri-analyzer");
  } else {
    console.log("[SENTRI] ✓ sentri-classifier ready (phi3:mini)");
    console.log("[SENTRI] ✓ sentri-analyzer ready (mistral:7b)");
  }
}

// ── Startup ───────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log("[SENTRI] Initializing vector store…");
  await initVectorStore();

  // Check Ollama before listen — warn, don't block
  await checkDependencies();

  app.listen(PORT, () => {
    console.log(`[SENTRI] Backend running on http://localhost:${PORT}`);
    console.log(`[SENTRI] Phase 7 — Ollama Local SLM Pipeline active`);
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
