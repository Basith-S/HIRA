// ─────────────────────────────────────────────────────────────
// Task 3 — Reflection Synthesizer (LLM Layer)
//
// Calls claude-sonnet-4-6 to produce an analyst-style reflection
// that contextualises the AgentDecision against past incident memory.
// ─────────────────────────────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import type { AgentDecision } from "./overrideEngine";
import type { SimilarIncident } from "../types/memory";

// ── System prompt ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are SENTRI's Hindsight reflection engine. You receive a structured agent decision and a list of structurally similar past incidents retrieved from vector memory.

Your job is to write a concise analyst-style reflection (3–5 sentences) that:
- Explains WHY the composite pattern was (or was not) triggered
- Names the specific past incidents that informed the decision (by incident_id)
- Justifies the mitigation chain in operational terms
- Flags any uncertainty if confidence is below 0.80

Be direct, factual, and use security operations language. Do not use bullet points — write in flowing prose.`;

// ── Lazy client singleton ─────────────────────────────────────

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to backend/.env"
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Generate an analyst-style Hindsight reflection for the given decision
 * and the past incidents that informed it.
 *
 * @param decision      - The resolved AgentDecision (BASELINE or COMPOSITE_OVERRIDE)
 * @param pastIncidents - ChromaDB recall results that were passed to the classifier
 * @returns             Plain-text reflection string (3–5 sentences)
 */
export async function synthesizeReflection(
  decision: AgentDecision,
  pastIncidents: SimilarIncident[]
): Promise<string> {
  const anthropic = getClient();

  const userMessage = JSON.stringify({ decision, pastIncidents }, null, 2);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  // Extract the first text block from the response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(
      "[ReflectionSynthesizer] Anthropic API returned no text content block."
    );
  }

  return textBlock.text;
}
