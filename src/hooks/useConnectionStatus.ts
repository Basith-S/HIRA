// ─────────────────────────────────────────────────────────────
// useConnectionStatus — polls /api/health every 10 seconds
// Checks both API and chroma status from the health response.
// ─────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import type { ConnectionStatus, ConnectionState } from "../types/sentri";
import { API_BASE_URL } from "../config";

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>({
    chroma: "checking",
    api: "checking",
  });

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        setStatus({ chroma: "disconnected", api: "disconnected" });
        return;
      }

      const data = (await res.json()) as {
        status: string;
        services?: { chroma?: string };
      };

      // A 200 means the API is up. "degraded" describes its dependencies
      // (Ollama/Chroma), not reachability, so it must not mark the API down.
      const chroma: ConnectionState =
        data.services?.chroma === "connected" ? "connected" : "disconnected";

      setStatus({ api: "connected", chroma });
    } catch {
      setStatus({ chroma: "disconnected", api: "disconnected" });
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10_000);
    return () => clearInterval(interval);
  }, []);

  return status;
}
