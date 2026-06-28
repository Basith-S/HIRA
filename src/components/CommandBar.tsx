// ─────────────────────────────────────────────────────────────
// CommandBar — 44px bottom bar
//
// Features:
//   - Prefix `>` in --accent
//   - Full-width input, no border
//   - [↵] hint on right, disappears on focus
//   - Command history (↑/↓)
//   - Ctrl+K focuses from anywhere (via useEffect on document)
//   - Escape blurs
// ─────────────────────────────────────────────────────────────

import { useRef, useState, useEffect, useCallback } from "react";

interface CommandBarProps {
  onSubmit: (cmd: string) => void;
  commandHistory: string[];
  isLoading: boolean;
}

export function CommandBar({ onSubmit, commandHistory, isLoading }: CommandBarProps) {
  const [value, setValue] = useState("");
  const [histIdx, setHistIdx] = useState(-1);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Ctrl+K global focus ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    setHistIdx(-1);
  }, [value, onSubmit]);

  // ── Keyboard handling ─────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
      return;
    }

    if (e.key === "Escape") {
      inputRef.current?.blur();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const nextIdx = Math.min(histIdx + 1, commandHistory.length - 1);
      setHistIdx(nextIdx);
      setValue(commandHistory[nextIdx] ?? "");
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = Math.max(histIdx - 1, -1);
      setHistIdx(nextIdx);
      setValue(nextIdx === -1 ? "" : (commandHistory[nextIdx] ?? ""));
      return;
    }
  };

  return (
    <div
      style={{
        height: "44px",
        background: "var(--bg)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: "8px",
        flexShrink: 0,
      }}
    >
      {/* Prompt prefix */}
      <span
        style={{
          color: "var(--accent)",
          fontSize: "13px",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        &gt;
      </span>

      {/* Input */}
      <input
        ref={inputRef}
        id="sentri-command-input"
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHistIdx(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={isLoading ? "processing…" : ""}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          fontSize: "12px",
          lineHeight: "1.6",
          letterSpacing: "0.02em",
          caretColor: "var(--accent)",
        }}
      />

      {/* [↵] hint — hides on focus */}
      {!focused && (
        <span
          style={{
            color: "var(--text-muted)",
            fontSize: "10px",
            flexShrink: 0,
            userSelect: "none",
            letterSpacing: "0.04em",
          }}
        >
          [↵]
        </span>
      )}
    </div>
  );
}
