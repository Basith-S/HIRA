// ─────────────────────────────────────────────────────────────
// AnalysisOutput — center pane (flex-grow)
//
// Renders:
//   - Header: trigger type + severity + mode tag
//   - Mitigation chain
//   - Metrics row
//   - Cascade audit (collapsible)
//   - Reflection (stagger line reveal)
//   - Rationale / recommendation
//   - Help text / error text
//   - Empty state: waiting for input_
//   - Loading state: processing trigger_
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import type { SENTRIResponse } from "../types/sentri";

interface AnalysisOutputProps {
  incident: {
    triggerType: string;
    severity: string;
    response: SENTRIResponse | null;
    isLoading: boolean;
  } | null;
  helpMode: boolean;
  errorText: string | null;
}

// ── Mode tag color ────────────────────────────────────────────

function modeColor(mode: string | undefined): string {
  switch (mode) {
    case "COMPOSITE_OVERRIDE": return "var(--accent)";
    case "BASELINE":           return "var(--text-muted)";
    case "BUDGET_FALLBACK":    return "var(--medium)";
    case "NOVEL_ANOMALY":      return "var(--high)";
    default:                   return "var(--text-muted)";
  }
}

function severityBadgeColor(sev: string): string {
  switch (sev.toLowerCase()) {
    case "critical": return "var(--crit)";
    case "high":     return "var(--high)";
    case "medium":   return "var(--medium)";
    case "low":      return "var(--low)";
    default:         return "var(--text-muted)";
  }
}

// ── Stagger-revealed text block ───────────────────────────────

function StaggerText({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.length > 0 || text.includes("\n"));

  return (
    <div>
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            opacity: 0,
            transform: "translateY(4px)",
            animation: "line-reveal 120ms ease-out forwards",
            animationDelay: `${i * 18}ms`,
            lineHeight: "1.8",
            color: "var(--text-primary)",
            fontSize: "12px",
            minHeight: line === "" ? "0.8em" : undefined,
          }}
        >
          {line || "\u00a0"}
        </div>
      ))}
    </div>
  );
}

// ── Section separator ─────────────────────────────────────────

function Separator() {
  return (
    <div
      style={{
        height: "1px",
        background: "var(--border)",
        margin: "12px 0",
      }}
    />
  );
}

// ── Label style ───────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "10px",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        marginBottom: "8px",
      }}
    >
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function AnalysisOutput({ incident, helpMode, errorText }: AnalysisOutputProps) {
  const [auditOpen, setAuditOpen] = useState(false);

  // ── Empty state ──────────────────────────────────────────
  if (!incident && !helpMode && !errorText) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
          fontSize: "12px",
          letterSpacing: "0.02em",
        }}
      >
        <span>
          waiting for input
          <span className="blink">_</span>
        </span>
      </div>
    );
  }

  // ── Loading state ────────────────────────────────────────
  if (incident?.isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-dim)",
          fontSize: "12px",
        }}
      >
        <span>
          processing trigger
          <span className="blink">_</span>
        </span>
      </div>
    );
  }

  // ── Help text ────────────────────────────────────────────
  if (helpMode) {
    const helpLines = [
      "SENTRI COMMAND REFERENCE",
      "────────────────────────────────────────",
      "",
      "analyze <type> <severity> [key=value ...]",
      "  fire a trigger against the analysis pipeline",
      "  severity: critical | high | medium | low",
      "  example: analyze traffic_spike high rps=8400 geo_anomaly=true",
      "",
      "session <1|2|3|4|5>",
      "  fire a preconfigured demo session payload",
      "  example: session 3",
      "",
      "recall <type> <severity>",
      "  query memory directly, loads into hindsight pane",
      "  example: recall traffic_spike high",
      "",
      "history <n>",
      "  show last n entries in feed (default 20)",
      "",
      "clear",
      "  clear center pane and hindsight pane",
      "",
      "help",
      "  show this reference",
      "",
      "KEYBOARD",
      "────────────────────────────────────────",
      "Ctrl+K   focus command bar",
      "Escape   blur command bar",
      "↑ / ↓    cycle command history",
    ];

    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {helpLines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.startsWith("  ") ? "var(--text-muted)" : "var(--text-primary)",
              fontSize: "11px",
              lineHeight: "1.7",
              whiteSpace: "pre",
            }}
          >
            {line || "\u00a0"}
          </div>
        ))}
      </div>
    );
  }

  // ── Error text ───────────────────────────────────────────
  if (errorText) {
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {errorText.split("\n").map((line, i) => (
          <div
            key={i}
            style={{
              color: "var(--high)",
              fontSize: "12px",
              lineHeight: "1.6",
            }}
          >
            {line || "\u00a0"}
          </div>
        ))}
      </div>
    );
  }

  // ── Full response ────────────────────────────────────────
  if (!incident?.response) return null;

  const r = incident.response;
  const decision = r.decision;
  const mode = decision?.mode ?? "BASELINE";
  const chain = decision?.mitigationChain ?? [];
  const audit = r.cascadeAudit ?? r.context?.cascadeAudit ?? null;

  // Metrics
  const confidence =
    decision?.confidence != null
      ? `${(decision.confidence * 100).toFixed(1)}%`
      : r.context?.confidence != null
      ? `${(r.context.confidence * 100).toFixed(1)}%`
      : "—";
  const tokensUsed = r.context?.tokensUsed ?? r.tokensUsed;
  const tokenBudget = r.context?.tokenBudget ?? 8000;
  const tokensStr = tokensUsed != null ? `${tokensUsed}/${tokenBudget}` : "—";

  const modelPathRaw = r.context?.modelPath;
  const modelStr =
    modelPathRaw === "fast_path"
      ? "fast → fast"
      : modelPathRaw === "escalation_path"
      ? "fast → full"
      : modelPathRaw === "degraded_fallback"
      ? "degraded"
      : "—";

  const patternStr = decision?.patternLabel ?? decision?.patternId ?? "—";

  // Parse audit tokensUsed string (e.g. "446 / 8000")
  let auditTokensUsed = "";
  let auditTokenBudget = "";
  if (audit?.tokensUsed) {
    const parts = audit.tokensUsed.split("/");
    auditTokensUsed = parts[0]?.trim() ?? "";
    auditTokenBudget = parts[1]?.trim() ?? "";
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
      {/* ── Header row ──────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        <span style={{ color: "var(--text-primary)", fontSize: "12px" }}>
          {r.trigger_type}
        </span>
        <span
          style={{
            color: severityBadgeColor(incident.severity),
            fontSize: "10px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          [{incident.severity.toUpperCase()}]
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>·</span>
        <span
          style={{
            color: modeColor(mode),
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {mode}
        </span>
      </div>

      <Separator />

      {/* ── Mitigation Chain ────────────────────────────── */}
      <SectionLabel>MITIGATION CHAIN</SectionLabel>
      <div
        style={{
          fontSize: "11px",
          color: "var(--text-primary)",
          marginBottom: "4px",
        }}
      >
        {chain.length === 0 ? (
          <span style={{ color: "var(--text-muted)" }}>none</span>
        ) : chain.length === 1 ? (
          chain[0]
        ) : (
          chain.map((item, i) => (
            <span key={i}>
              {i > 0 && (
                <span style={{ color: "var(--text-muted)", margin: "0 5px" }}>→</span>
              )}
              {item}
            </span>
          ))
        )}
      </div>

      <Separator />

      {/* ── Metrics Row ─────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0 14px",
          fontSize: "10px",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: "4px",
        }}
      >
        <span>
          CONFIDENCE{" "}
          <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>
            {confidence}
          </span>
        </span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span>
          TOKENS{" "}
          <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>
            {tokensStr}
          </span>
        </span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span>
          MODEL{" "}
          <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>
            {modelStr}
          </span>
        </span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span>
          PATTERN{" "}
          <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>
            {patternStr}
          </span>
        </span>
      </div>

      <Separator />

      {/* ── Cascade Audit (collapsible) ──────────────────── */}
      {audit && (
        <>
          <div
            onClick={() => setAuditOpen((v) => !v)}
            style={{
              cursor: "pointer",
              fontSize: "10px",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: auditOpen ? "8px" : "0",
              userSelect: "none",
            }}
          >
            [audit {auditOpen ? "▲" : "▼"}]
          </div>

          {auditOpen && (
            <div style={{ marginBottom: "4px" }}>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  marginBottom: "8px",
                  letterSpacing: "0.04em",
                }}
              >
                [CascadeFlow Audit]
              </div>
              <dl
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr",
                  gap: "4px 12px",
                }}
              >
                {[
                  ["Complexity", audit.complexity],
                  ["Model Path", audit.modelPath],
                  ["Tokens", `${auditTokensUsed} / ${auditTokenBudget}`],
                  [
                    "Decision",
                    audit.decisions[audit.decisions.length - 1] ?? "—",
                  ],
                  [
                    "Latency",
                    audit.latencySavingPct > 0
                      ? `~${audit.latencySavingPct}% saved`
                      : "none (full model used)",
                  ],
                ].map(([label, value]) => (
                  <>
                    <dt
                      key={`dt-${label}`}
                      style={{
                        fontSize: "10px",
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        lineHeight: "1.6",
                      }}
                    >
                      {label}
                    </dt>
                    <dd
                      key={`dd-${label}`}
                      style={{
                        fontSize: "11px",
                        color: "var(--text-primary)",
                        lineHeight: "1.6",
                        margin: 0,
                      }}
                    >
                      {value}
                    </dd>
                  </>
                ))}
              </dl>
            </div>
          )}

          <Separator />
        </>
      )}

      {/* ── Reflection ──────────────────────────────────── */}
      {r.reflection && (
        <>
          <SectionLabel>REFLECTION</SectionLabel>
          <StaggerText text={r.reflection} />
          <Separator />
        </>
      )}

      {/* ── Rationale (recommendation) ───────────────────── */}
      <SectionLabel>RATIONALE</SectionLabel>
      <StaggerText text={r.recommendation ?? ""} />
    </div>
  );
}
