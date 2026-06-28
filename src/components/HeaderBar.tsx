// ─────────────────────────────────────────────────────────────
// HeaderBar — 32px top bar
// Shows: SENTRI brand, version, connection status, UTC clock
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import type { ConnectionStatus } from "../types/sentri";

interface HeaderBarProps {
  connectionStatus: ConnectionStatus;
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function utcTime(): string {
  const now = new Date();
  return `${padTwo(now.getUTCHours())}:${padTwo(now.getUTCMinutes())}:${padTwo(now.getUTCSeconds())} UTC`;
}

function StatusDot({ state }: { state: "connected" | "disconnected" | "checking" }) {
  const color =
    state === "connected"
      ? "var(--accent)"
      : state === "checking"
      ? "var(--medium)"
      : "var(--crit)";
  return (
    <span
      style={{
        color,
        animation: state === "checking" ? "pulse-dot 1.5s ease-in-out infinite" : undefined,
      }}
    >
      ●
    </span>
  );
}

export function HeaderBar({ connectionStatus }: HeaderBarProps) {
  const [time, setTime] = useState(utcTime);

  useEffect(() => {
    const id = setInterval(() => setTime(utcTime()), 1000);
    return () => clearInterval(id);
  }, []);

  const [isLight, setIsLight] = useState(() => document.body.classList.contains("light-mode"));

  const toggleTheme = () => {
    const nextLight = !isLight;
    setIsLight(nextLight);
    if (nextLight) {
      document.body.classList.add("light-mode");
    } else {
      document.body.classList.remove("light-mode");
    }
  };

  return (
    <header
      style={{
        height: "32px",
        background: "var(--bg)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: "24px",
        flexShrink: 0,
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            color: "var(--accent)",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.2em",
          }}
        >
          SENTRI
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>v0.5.0</span>
      </div>

      {/* Connection Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flex: 1,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "10px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <StatusDot state={connectionStatus.chroma} />
          chroma
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "10px",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <StatusDot state={connectionStatus.api} />
          api
        </span>
      </div>

      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "10px",
          textTransform: "uppercase",
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        [{isLight ? "dark" : "light"}]
      </button>

      {/* Clock */}
      <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>{time}</span>
    </header>
  );
}

