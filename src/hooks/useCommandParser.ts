// ─────────────────────────────────────────────────────────────
// useCommandParser — parses SENTRI command strings → API calls
//
// Supported commands:
//   analyze <type> <severity> [key=value ...]
//   recall <type> <severity>
//   session <1|2|3|4|5>
//   history <n>
//   clear
//   help
// ─────────────────────────────────────────────────────────────

import { API_BASE_URL } from "../config";
import { DEMO_SESSIONS } from "../constants/demoSessions";
import type { SENTRIResponse, RecallResponse } from "../types/sentri";

// ── Error formatting ──────────────────────────────────────────

// A failed fetch surfaces as an opaque browser string ("NetworkError when
// attempting to fetch resource" / "Failed to fetch") that says nothing about
// the cause. In practice it always means the backend isn't reachable, so say
// that instead — with the address that was tried.
function describeFetchError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const isNetworkFailure =
    err instanceof TypeError ||
    /networkerror|failed to fetch|load failed|fetch failed/i.test(message);

  if (isNetworkFailure) {
    return (
      `cannot reach the SENTRI backend at ${API_BASE_URL} — ` +
      `start it with \`npm run dev\` in the backend/ directory (${message})`
    );
  }
  return message;
}

// ── Value coercion: string → boolean | number | string ───────

function coerceValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== "") return n;
  return raw;
}

// ── Key=value pair parser ─────────────────────────────────────

function parseKvPairs(tokens: string[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const token of tokens) {
    const idx = token.indexOf("=");
    if (idx === -1) continue;
    const key = token.slice(0, idx).trim();
    const val = token.slice(idx + 1).trim();
    if (key) result[key] = coerceValue(val);
  }
  return result;
}

// ── Severity label → numeric ──────────────────────────────────

function severityToNumber(label: string): number {
  switch (label.toLowerCase()) {
    case "critical": return 1.0;
    case "high":     return 0.87;
    case "medium":   return 0.5;
    case "low":      return 0.2;
    default: {
      const n = parseFloat(label);
      return isNaN(n) ? 0.5 : Math.min(1, Math.max(0, n));
    }
  }
}

// ── Command result types ──────────────────────────────────────

export type ParsedCommandResult =
  | { kind: "analyze"; response: SENTRIResponse; triggerType: string; severity: string }
  | { kind: "recall"; response: RecallResponse }
  | { kind: "session"; response: SENTRIResponse; triggerType: string; severity: string; sessionNum: number }
  | { kind: "history"; n: number }
  | { kind: "clear" }
  | { kind: "help" }
  | { kind: "error"; message: string };

// ── Main parser / executor ────────────────────────────────────

export async function parseAndExecuteCommand(
  raw: string
): Promise<ParsedCommandResult> {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "error", message: "empty command" };

  const tokens = trimmed.split(/\s+/);
  const cmd = tokens[0]?.toLowerCase() ?? "";

  // ── clear ────────────────────────────────────────────────
  if (cmd === "clear") {
    return { kind: "clear" };
  }

  // ── help ─────────────────────────────────────────────────
  if (cmd === "help") {
    return { kind: "help" };
  }

  // ── history <n> ──────────────────────────────────────────
  if (cmd === "history") {
    const n = parseInt(tokens[1] ?? "20", 10);
    return { kind: "history", n: isNaN(n) ? 20 : n };
  }

  // ── recall <type> <severity> ─────────────────────────────
  if (cmd === "recall") {
    const type     = tokens[1] ?? "unknown";
    const severity = tokens[2] ?? "0.5";

    const url = new URL(`${API_BASE_URL}/api/memory/recall`);
    url.searchParams.set("type", type);
    url.searchParams.set("severity", severity);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        return {
          kind: "error",
          message: `recall failed [${res.status}]: ${body}`,
        };
      }
      const data = (await res.json()) as RecallResponse;
      return { kind: "recall", response: data };
    } catch (err) {
      return {
        kind: "error",
        message: `recall error: ${describeFetchError(err)}`,
      };
    }
  }

  // ── session <1|2|3|4|5> ──────────────────────────────────
  if (cmd === "session") {
    const num = parseInt(tokens[1] ?? "", 10);
    const preset = DEMO_SESSIONS[num];
    if (!preset) {
      return {
        kind: "error",
        message: `unknown session: ${tokens[1] ?? ""}. Valid: 1 2 3 4 5`,
      };
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: preset.session_id,
          trigger_type: preset.trigger_type,
          payload: {
            ...preset.payload,
            timestamp: new Date().toISOString(),
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return {
          kind: "error",
          message: `analyze failed [${res.status}]: ${body}`,
        };
      }

      const data = (await res.json()) as SENTRIResponse;
      return {
        kind: "session",
        response: data,
        triggerType: preset.trigger_type,
        severity: preset.displaySeverity,
        sessionNum: num,
      };
    } catch (err) {
      return {
        kind: "error",
        message: `session error: ${describeFetchError(err)}`,
      };
    }
  }

  // ── analyze <type> <severity> [key=value ...] ─────────────
  if (cmd === "analyze") {
    const triggerType = tokens[1];
    const severityLabel = tokens[2] ?? "medium";

    if (!triggerType) {
      return {
        kind: "error",
        message: "usage: analyze <type> <severity> [key=value ...]",
      };
    }

    const kvTokens = tokens.slice(3);
    const indicators = parseKvPairs(kvTokens);

    const severityNum = severityToNumber(severityLabel);

    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      source: "manual-trigger",
      severity: severityNum,
      ...indicators,
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: `manual-${Date.now()}`,
          trigger_type: triggerType,
          payload,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return {
          kind: "error",
          message: `analyze failed [${res.status}]: ${body}`,
        };
      }

      const data = (await res.json()) as SENTRIResponse;
      return {
        kind: "analyze",
        response: data,
        triggerType,
        severity: severityLabel,
      };
    } catch (err) {
      return {
        kind: "error",
        message: `analyze error: ${describeFetchError(err)}`,
      };
    }
  }

  // ── Unknown command / Raw Input Fallback ──────────────────
  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputType: "unknown",
        content: raw,
        source: "sentri-terminal",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        kind: "error",
        message: `raw analyze failed [${res.status}]: ${body}`,
      };
    }

    const data = (await res.json()) as SENTRIResponse;
    // Derive severity label from decision for the UI badge
    const severityLabel = data.classification?.severity ?? "medium";
    const triggerType = data.classification?.threatType ?? "RawInput";

    return {
      kind: "analyze",
      response: data,
      triggerType: triggerType,
      severity: severityLabel,
    };
  } catch (err) {
    return {
      kind: "error",
      message: `raw analyze error: ${describeFetchError(err)}`,
    };
  }
}

