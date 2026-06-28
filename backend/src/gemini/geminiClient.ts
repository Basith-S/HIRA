// ─────────────────────────────────────────────────────────────
// Gemini Client
//
// Initializes the Google Generative AI SDK with API key from env.
// Exposes generateFlash() and generatePro() with:
//   - 30s timeout enforced via Promise.race
//   - Typed GeminiError on failure
//   - Console timing log per call
// ─────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Typed error ───────────────────────────────────────────────

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly model: string
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

// ── SDK init ──────────────────────────────────────────────────

const apiKey = process.env["GEMINI_API_KEY"] ?? "";
const genAI = new GoogleGenerativeAI(apiKey);

const FLASH_MODEL_NAME =
  process.env["GEMINI_FLASH_MODEL"] ?? "gemini-1.5-flash";
const PRO_MODEL_NAME =
  process.env["GEMINI_PRO_MODEL"] ?? "gemini-1.5-pro";

const flashModel = genAI.getGenerativeModel({ model: FLASH_MODEL_NAME });
const proModel = genAI.getGenerativeModel({ model: PRO_MODEL_NAME });

const TIMEOUT_MS = 30_000;

// ── Internal helper ───────────────────────────────────────────

async function callModel(
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
  modelName: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (!apiKey) {
    throw new GeminiError(
      "GEMINI_API_KEY is not configured in environment",
      modelName
    );
  }

  const startMs = Date.now();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new GeminiError(`${modelName} timed out after ${TIMEOUT_MS}ms`, modelName)),
      TIMEOUT_MS
    )
  );

  const callPromise = (async () => {
    try {
      const result = await model.generateContent([systemPrompt, userPrompt]);
      const text = result.response.text();
      if (!text) {
        throw new GeminiError(`${modelName} returned empty response`, modelName);
      }
      return text.trim();
    } catch (err: unknown) {
      if (err instanceof GeminiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new GeminiError(`${modelName} API call failed: ${msg}`, modelName);
    }
  })();

  const text = await Promise.race([callPromise, timeoutPromise]);
  const elapsedMs = Date.now() - startMs;
  console.log(`[Gemini] ${modelName} responded in ${elapsedMs}ms`);
  return text;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Call gemini-1.5-flash (fast path / intake classifier).
 */
export async function generateFlash(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  return callModel(flashModel, FLASH_MODEL_NAME, systemPrompt, prompt);
}

/**
 * Call gemini-1.5-pro (escalation path / deep analyzer).
 */
export async function generatePro(
  prompt: string,
  systemPrompt: string
): Promise<string> {
  return callModel(proModel, PRO_MODEL_NAME, systemPrompt, prompt);
}

export { FLASH_MODEL_NAME, PRO_MODEL_NAME };
