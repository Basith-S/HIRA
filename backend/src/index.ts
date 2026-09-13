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
import { checkChromaHealth, initVectorStore } from "./memory/vectorStore";
import { TOKEN_BUDGET } from "./cascade/cascadeRouter";
import { DEMO_SESSIONS } from "./demo/sessionScript";
import { checkOllamaHealth, EMBEDDING_MODEL_NAME } from "./ollama/ollamaClient";
import analyzeRouter from "./routes/analyze";
import memoryRouter from "./routes/memory";

const app = express();
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

// ── Middleware ────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────

// Both paths report the same thing — /health is the bare probe, /api/health is
// what the frontend polls.
async function buildHealthReport() {
  const [ollama, chroma] = await Promise.all([
    checkOllamaHealth(),
    checkChromaHealth(),
  ]);

  const hasClassifier = ollama.models.some((m) => m.includes("osava-smollm"));
  const hasAnalyzer = ollama.models.some((m) => m.includes("sentri-analyzer"));
  const hasEmbedder = ollama.models.some((m) => m.includes(EMBEDDING_MODEL_NAME));
  const isDegraded =
    !ollama.online || !hasClassifier || !hasAnalyzer || !hasEmbedder || !chroma.online;

  return {
    status: isDegraded ? "degraded" : "ok",
    services: {
      chroma: chroma.online ? "connected" : "disconnected",
      chromaDocuments: chroma.documentCount,
      ollama: ollama.online ? "online" : "offline",
      models: {
        classifier: hasClassifier ? "ready" : "missing",
        analyzer: hasAnalyzer ? "ready" : "missing",
        embedder: hasEmbedder ? "ready" : "missing",
      },
    },
    phases: [1, 2, 3, 4, 5, 6, 7],
    version: "0.7.0",
  };
}

app.get("/health", async (_req, res) => {
  res.json(await buildHealthReport());
});

app.get("/api/health", async (_req, res) => {
  res.json(await buildHealthReport());
});

// ── CascadeFlow status ────────────────────────────────────────

app.get("/api/cascade/status", (_req, res) => {
  res.json({
    engine: "CascadeFlow (Ollama Local SLM)",
    phase: 7,
    status: "active",
    tokenBudget: TOKEN_BUDGET,
    description:
      "CascadeFlow Routing Engine — Intake classifier (osava-smollm / SmolLM3-3B) → conditional Deep Analysis (sentri-analyzer / mistral:7b), appending structured audit trail.",
    paths: {
      fast_path: "osava-smollm (SmolLM3-3B) — classification & baseline mitigation",
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

  const hasClassifier = ollama.models.some((m) => m.includes("osava-smollm"));
  const hasAnalyzer = ollama.models.some((m) => m.includes("sentri-analyzer"));

  const hasEmbedder = ollama.models.some((m) => m.includes(EMBEDDING_MODEL_NAME));

  if (!hasClassifier || !hasAnalyzer || !hasEmbedder) {
    console.warn("[SENTRI] ⚠ SENTRI models not built. Run: npm run setup:models");
    if (!hasClassifier) console.warn("[SENTRI]   Missing: osava-smollm");
    if (!hasAnalyzer) console.warn("[SENTRI]   Missing: sentri-analyzer");
    if (!hasEmbedder) console.warn(`[SENTRI]   Missing: ${EMBEDDING_MODEL_NAME} (memory disabled)`);
  } else {
    // Don't name a base model here — it reports what the Modelfile *asks* for,
    // not what the installed model was actually built from.
    console.log("[SENTRI] ✓ osava-smollm ready");
    console.log("[SENTRI] ✓ sentri-analyzer ready");
    console.log(`[SENTRI] ✓ ${EMBEDDING_MODEL_NAME} ready (local embeddings)`);
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
