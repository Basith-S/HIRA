// ─────────────────────────────────────────────────────────────
// HindsightRecall — right pane (220px)
// Shows recalled similar incidents from memory.
// ─────────────────────────────────────────────────────────────

import type { SimilarIncident } from "../types/sentri";

interface HindsightRecallProps {
  incidents: SimilarIncident[];
  isNovel: boolean;
}

function distanceColor(dist: number): string {
  if (dist < 0.25) return "var(--accent)";
  if (dist < 0.40) return "var(--medium)";
  return "var(--text-muted)";
}


export function HindsightRecall({ incidents, isNovel }: HindsightRecallProps) {
  return (
    <div
      style={{
        width: "220px",
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
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
          HINDSIGHT
        </span>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {incidents.length} match{incidents.length !== 1 ? "es" : ""}
        </span>
      </div>

      {/* Recall Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Empty state */}
        {incidents.length === 0 && !isNovel && (
          <div
            style={{
              padding: "20px 10px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "11px",
              lineHeight: "1.8",
            }}
          >
            no recall data
            <br />
            <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
              submit a trigger to
              <br />
              populate memory
            </span>
          </div>
        )}

        {/* Novel anomaly state */}
        {isNovel && incidents.length === 0 && (
          <div
            style={{
              padding: "20px 10px",
              textAlign: "center",
              lineHeight: "1.8",
            }}
          >
            <div
              style={{
                color: "var(--high)",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                marginBottom: "6px",
              }}
            >
              [NOVEL]
            </div>
            <div style={{ color: "var(--high)", fontSize: "10px" }}>
              no structural match
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
              stored for future
              <br />
              pattern learning
            </div>
          </div>
        )}

        {/* Incident blocks */}
        {incidents.map((inc, i) => {
          const displayId = `#INC-${String(i + 1).padStart(3, "0")}`;
          const type = inc.metadata["trigger_type"] ?? "unknown";
          const sev = inc.metadata["severity"] ?? inc.metadata["sev"] ?? "—";

          return (
            <div key={inc.id}>
              {i > 0 && (
                <div
                  style={{
                    height: "1px",
                    background: "var(--border)",
                    margin: "0",
                  }}
                />
              )}
              <div style={{ padding: "10px 10px" }}>
                {/* Incident ID */}
                <div
                  style={{
                    color: "var(--accent)",
                    fontSize: "11px",
                    marginBottom: "6px",
                    letterSpacing: "0.04em",
                  }}
                >
                  {displayId}
                </div>

                {/* Key-value pairs */}
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr",
                    gap: "3px 8px",
                  }}
                >
                  <dt
                    style={{
                      fontSize: "10px",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    dist
                  </dt>
                  <dd
                    style={{
                      fontSize: "11px",
                      color: distanceColor(inc.distance),
                      margin: 0,
                    }}
                  >
                    {inc.distance.toFixed(4)}
                  </dd>

                  <dt
                    style={{
                      fontSize: "10px",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    type
                  </dt>
                  <dd
                    style={{
                      fontSize: "11px",
                      color: "var(--text-primary)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={type}
                  >
                    {type}
                  </dd>

                  <dt
                    style={{
                      fontSize: "10px",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    sev
                  </dt>
                  <dd
                    style={{
                      fontSize: "11px",
                      color: "var(--text-primary)",
                      margin: 0,
                    }}
                  >
                    {sev}
                  </dd>
                </dl>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
