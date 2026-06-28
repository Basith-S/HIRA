// ─────────────────────────────────────────────────────────────
// IncidentFeed — left pane (200px)
// Shows incident entries, newest first, with severity badges.
// ─────────────────────────────────────────────────────────────

import type { IncidentEntry } from "../types/sentri";

interface IncidentFeedProps {
  incidents: IncidentEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type Severity = "critical" | "high" | "medium" | "low" | string;

function severityLabel(sev: Severity): string {
  switch (sev.toLowerCase()) {
    case "critical": return "CRIT";
    case "high":     return "HIGH";
    case "medium":   return "MED ";
    case "low":      return "LOW ";
    default:         return sev.slice(0, 4).toUpperCase().padEnd(4, " ");
  }
}

function severityColor(sev: Severity): string {
  switch (sev.toLowerCase()) {
    case "critical": return "var(--crit)";
    case "high":     return "var(--high)";
    case "medium":   return "var(--medium)";
    case "low":      return "var(--low)";
    default:         return "var(--text-muted)";
  }
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTime(date: Date): string {
  return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`;
}

export function IncidentFeed({ incidents, selectedId, onSelect }: IncidentFeedProps) {
  return (
    <div
      style={{
        width: "200px",
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Pane Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          FEED
        </span>
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
          }}
        >
          {incidents.length}
        </span>
      </div>

      {/* Feed Entries */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
        }}
      >
        {incidents.length === 0 && (
          <div
            style={{
              padding: "16px 10px",
              color: "var(--text-dim)",
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            no incidents
          </div>
        )}

        {incidents.map((inc) => {
          const isSelected = inc.id === selectedId;
          const sevColor = severityColor(inc.severity);
          const label = severityLabel(inc.severity);

          return (
            <div
              key={inc.id}
              onClick={() => onSelect(inc.id)}
              style={{
                height: "36px",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                gap: "6px",
                cursor: "pointer",
                background: isSelected ? "var(--surface)" : "transparent",
                borderLeft: isSelected
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                animation: "feed-enter 200ms ease-out",
                transition: "background 80ms",
                flexShrink: 0,
                overflow: "hidden",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLDivElement).style.background = "#111";
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }
              }}
            >
              {/* Severity badge */}
              <span
                style={{
                  color: sevColor,
                  fontSize: "10px",
                  letterSpacing: "0.04em",
                  flexShrink: 0,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                [{label}]
              </span>

              {/* Type */}
              <span
                style={{
                  color: "var(--text-primary)",
                  fontSize: "10px",
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={inc.triggerType}
              >
                {inc.isLoading ? "…" : inc.triggerType}
              </span>

              {/* Novel badge */}
              {inc.isNovel && (
                <span
                  style={{
                    color: "var(--medium)",
                    fontSize: "9px",
                    flexShrink: 0,
                  }}
                >
                  [N]
                </span>
              )}

              {/* Timestamp */}
              <span
                style={{
                  color: "var(--text-muted)",
                  fontSize: "10px",
                  flexShrink: 0,
                  letterSpacing: "0",
                }}
              >
                {formatTime(inc.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
