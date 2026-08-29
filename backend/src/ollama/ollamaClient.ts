// ─────────────────────────────────────────────────────────────
// Ollama Client — Local SLM via Ollama REST API
//
// ONLY file that calls http://localhost:11434 (or OLLAMA_URL).
// Exposes runClassifier(), runAnalyzer(), checkOllamaHealth().
//
// Error types:
//   OllamaTimeoutError     — request exceeded OLLAMA_TIMEOUT_MS (default 120s)
//   OllamaUnavailableError — Ollama not running / connection refused
// ─────────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env["OLLAMA_URL"] ?? "http://localhost:11434";
const CLASSIFIER_MODEL = "sentri-classifier";
const ANALYZER_MODEL = "sentri-analyzer";
// Cold model loads (phi3:mini / mistral:7b being paged into memory on the
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
 * Run the sentri-classifier model (phi3:mini) for intake classification.
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
