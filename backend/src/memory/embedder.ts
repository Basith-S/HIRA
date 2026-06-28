// ─────────────────────────────────────────────────────────────
// Task 2 — Embedding Pipeline
//
// Calls the Voyage AI REST API (voyage-3 model) directly via axios.
// Key is read from VOYAGE_API_KEY env var (loaded by dotenv in index.ts).
// ─────────────────────────────────────────────────────────────

import axios, { AxiosError } from "axios";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";

// ── Typed error ───────────────────────────────────────────────

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Build the canonical summary text from incident fields.
 *
 * Format: `"[type] severity:[severity] — [summary]"`
 *
 * @param type       - The trigger type (e.g. "traffic_spike")
 * @param severity   - Numeric severity 0.0–1.0
 * @param summary    - Free-text incident summary
 */
export function buildSummaryText(
  type: string,
  severity: number,
  summary: string
): string {
  return `[${type}] severity:${severity.toFixed(2)} — ${summary}`;
}

/**
 * Generate a Voyage AI embedding vector for the given text.
 *
 * @param text - Plain-text string to embed
 * @returns    A `number[]` embedding vector (1024-dimensional for voyage-3)
 * @throws     `EmbeddingError` on API failure or missing API key
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError(
      "VOYAGE_API_KEY is not set. Add it to backend/.env"
    );
  }

  try {
    const response = await axios.post<VoyageEmbeddingResponse>(
      VOYAGE_API_URL,
      {
        input: [text],
        model: VOYAGE_MODEL,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30_000, // 30 s timeout
      }
    );

    const data = response.data;
    if (!data.data || data.data.length === 0) {
      throw new EmbeddingError("Voyage API returned an empty embedding list.", response.status, data);
    }

    return data.data[0].embedding;
  } catch (err: unknown) {
    if (err instanceof EmbeddingError) throw err;

    const axiosErr = err as AxiosError;
    if (axiosErr.isAxiosError) {
      throw new EmbeddingError(
        `Voyage API request failed: ${axiosErr.message}`,
        axiosErr.response?.status,
        axiosErr.response?.data
      );
    }

    throw new EmbeddingError(`Unexpected error during embedding: ${String(err)}`);
  }
}

// ── Internal types ────────────────────────────────────────────

interface VoyageEmbeddingObject {
  object: string;
  embedding: number[];
  index: number;
}

interface VoyageEmbeddingResponse {
  object: string;
  data: VoyageEmbeddingObject[];
  model: string;
  usage: { total_tokens: number };
}
