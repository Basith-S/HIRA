// ─────────────────────────────────────────────────────────────
// Ollama Client — Local SLM via Ollama REST API
//
// ONLY file that calls http://localhost:11434 (or OLLAMA_URL).
// Exposes runClassifier(), runAnalyzer(), runEmbedding(), checkOllamaHealth().
//
// Error types:
//   OllamaTimeoutError     — request exceeded OLLAMA_TIMEOUT_MS (default 120s)
//   OllamaUnavailableError — Ollama not running / connection refused
// ─────────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const CLASSIFIER_MODEL = "osava-smollm";
const ANALYZER_MODEL = "sentri-analyzer";
// 1024-dimensional, matching the vector width the ChromaDB collection was
// created with — swapping to a different width requires rebuilding it.
const EMBED_MODEL = process.env["OLLAMA_EMBED_MODEL"] ?? "mxbai-embed-large";
// Cold model loads (SmolLM3-3B / mistral:7b being paged into memory on the
// first request) routinely take longer than a warm inference, so this budget
// has to cover load time, not just generation. Override with OLLAMA_TIMEOUT_MS.
const TIMEOUT_MS = parseInt(process.env["OLLAMA_TIMEOUT_MS"] ?? "120000", 10);

// Keep a model resident between requests so only the first call pays the load cost.
const KEEP_ALIVE = process.env["OLLAMA_KEEP_ALIVE"] ?? "30m";

// ── Typed errors ──────────────────────────────────────────────

export class OllamaTimeoutError extends Error {
  constructor(model: string) {
    super(`Ollama model '${model}' timed out after ${TIMEOUT_MS}ms`);
    this.name = "OllamaTimeoutError";
  }
}

export class OllamaUnavailableError extends Error {
  constructor() {
    super("Ollama not running — start with: ollama serve");
    this.name = "OllamaUnavailableError";
  }
}

// ── Types ─────────────────────────────────────────────────────

type OllamaRequest = {
  model: string;
  prompt: string;
  stream: false;
  keep_alive?: string;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
};

type OllamaResponse = {
  model: string;
  response: string;
  done: boolean;
  total_duration: number; // nanoseconds
  eval_count: number; // tokens generated
};

type OllamaTagsResponse = {
  models: Array<{ name: string }>;
};

// ── Result type ───────────────────────────────────────────────

export type OllamaResult = {
  text: string;
  tokensUsed: number;
  latencyMs: number;
};

// ── Internal helper ───────────────────────────────────────────

async function callOllama(model: string, prompt: string): Promise<OllamaResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body: OllamaRequest = {
    model,
    prompt,
    stream: false,
    keep_alive: KEEP_ALIVE,
  };

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaResponse;
    const latencyMs = Math.round(data.total_duration / 1_000_000);
    const tokensUsed = data.eval_count ?? 0;

    console.log(
      `[Ollama] ${model} responded in ${latencyMs}ms (${tokensUsed} tokens)`
    );

    return {
      text: data.response?.trim() ?? "",
      tokensUsed,
      latencyMs,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new OllamaTimeoutError(model);
      }
      // Connection refused — Ollama not running
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed") ||
        err.message.includes("network")
      ) {
        throw new OllamaUnavailableError();
      }
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Run the osava-smollm model (SmolLM3-3B) for intake classification.
 */
export async function runClassifier(prompt: string): Promise<OllamaResult> {
  return callOllama(CLASSIFIER_MODEL, prompt);
}

/**
 * Run the sentri-analyzer model (mistral:7b) for deep forensic analysis.
 */
export async function runAnalyzer(prompt: string): Promise<OllamaResult> {
  return callOllama(ANALYZER_MODEL, prompt);
}

/**
 * Generate an embedding vector for `text` via the local embedding model.
 * Returns a 1024-dimensional vector for the default mxbai-embed-large.
 */
export async function runEmbedding(text: string): Promise<number[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text,
        keep_alive: KEEP_ALIVE,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Ollama embeddings returned HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = (await response.json()) as { embedding?: number[] };
    if (!data.embedding || data.embedding.length === 0) {
      throw new Error(`Ollama model '${EMBED_MODEL}' returned an empty embedding.`);
    }

    return data.embedding;
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === "AbortError") throw new OllamaTimeoutError(EMBED_MODEL);
      if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("fetch failed") ||
        err.message.includes("network")
      ) {
        throw new OllamaUnavailableError();
      }
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const EMBEDDING_MODEL_NAME = EMBED_MODEL;

/**
 * Check if Ollama is reachable and which models are available.
 * Called by /api/health and startup dependency check.
 */
export async function checkOllamaHealth(): Promise<{
  online: boolean;
  models: string[];
}> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { online: false, models: [] };
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const models = (data.models ?? []).map((m) => m.name);
    return { online: true, models };
  } catch {
    return { online: false, models: [] };
  }
}

export { CLASSIFIER_MODEL, ANALYZER_MODEL };
