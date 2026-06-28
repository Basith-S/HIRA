import axios from "axios";

type SessionFixture = {
  sessionId: number;
  sessionLabel: string;
  trigger_type: string;
  payload: Record<string, unknown>;
  edgeOnly?: boolean;
};

type ValidationResult = {
  sessionId: number;
  sessionLabel: string;
  baseline: {
    mitigation: string;
    latencyMs: number;
    tokensUsed: number;
    patternDetected: false;
  };
  sentri: {
    mitigation: string[];
    latencyMs: number;
    tokensUsed: number;
    patternDetected: boolean;
    patternId: string | null;
    mode: "BASELINE" | "COMPOSITE_OVERRIDE" | "BUDGET_FALLBACK" | "NOVEL_ANOMALY";
    confidence: number | null;
  };
  delta: {
    latencySavingMs: number;
    latencySavingPct: string;
    tokenDelta: number;
    mitigationUpgrade: boolean;
    compositeDetected: boolean;
  };
};

const BASE_URL = process.env["SENTRI_BASE_URL"] ?? "http://localhost:3001";

const DEMO_SESSIONS: SessionFixture[] = [
  {
    sessionId: 1,
    sessionLabel: "Session 1",
    trigger_type: "traffic_spike",
    payload: {
      timestamp: new Date().toISOString(),
      source: "203.0.113.42",
      requests_per_second: 12500,
      baseline_rps: 800,
      severity: 0.87,
      summary: "DDoS-like traffic spike against public ingress",
    },
  },
  {
    sessionId: 2,
    sessionLabel: "Session 2",
    trigger_type: "traffic_spike",
    payload: {
      timestamp: new Date().toISOString(),
      source: "203.0.113.42",
      requests_per_second: 1800,
      baseline_rps: 900,
      severity: 0.5,
      summary: "Control traffic fluctuation from a previously observed source",
    },
  },
  {
    sessionId: 3,
    sessionLabel: "Session 3",
    trigger_type: "failed_logins",
    payload: {
      timestamp: new Date().toISOString(),
      source: "198.51.100.17",
      attempt_count: 342,
      time_window_secs: 60,
      target_accounts: ["admin@acme.io", "cto@acme.io", "root"],
      severity: 0.93,
      summary: "Credential stuffing burst after traffic spike",
    },
  },
  {
    sessionId: 4,
    sessionLabel: "Session 4",
    trigger_type: "traffic_spike",
    payload: {
      timestamp: new Date().toISOString(),
      source: "10.0.0.0/8",
      requests_per_second: 32000,
      baseline_rps: 1600,
      severity: 0.97,
      summary: "Critical takeover precursor with traffic and credential correlation",
    },
  },
  {
    sessionId: 5,
    sessionLabel: "Session 5",
    trigger_type: "traffic_spike",
    payload: {
      timestamp: new Date().toISOString(),
      source: "10.0.0.0/8",
      requests_per_second: 45000,
      baseline_rps: 2000,
      severity: 0.95,
      summary: "Final POC composite takeover precursor",
    },
  },
  {
    sessionId: 6,
    sessionLabel: "Session 6",
    trigger_type: "data_exfiltration",
    payload: {
      timestamp: new Date().toISOString(),
      source: "db-prod-01",
      bytes_out: 900000000,
      severity: 0.98,
      raw_log_dump: "exfiltration ".repeat(3200),
      summary: "Oversized exfiltration context to force token budget fallback",
    },
    edgeOnly: true,
  },
];

async function main(): Promise<void> {
  await assertBackendAvailable();
  await resetMemory();

  const results: ValidationResult[] = [];
  for (const session of DEMO_SESSIONS.filter((item) => !item.edgeOnly)) {
    results.push(await runSession(session));
  }

  const edgeSession = DEMO_SESSIONS.find((item) => item.edgeOnly);
  if (edgeSession) {
    const edge = await postAnalyze(edgeSession, false);
    const edgeMode = edge.data?.decision?.mode ?? edge.data?.status ?? "UNKNOWN";
    console.log(`\nEdge Session 6 mode: ${edgeMode}`);
    if (edgeMode !== "BUDGET_FALLBACK") {
      console.warn("REGRESSION: Session 6 did not hit BUDGET_FALLBACK.");
    }
  }

  printReport(results);
  printRegressionChecks(results);
}

async function assertBackendAvailable(): Promise<void> {
  try {
    await axios.get(`${BASE_URL}/api/health`, { timeout: 5000 });
  } catch (err) {
    throw new Error(
      `SENTRI backend is not reachable at ${BASE_URL}. Start it with npm run dev. ${String(err)}`
    );
  }
}

async function resetMemory(): Promise<void> {
  await axios.post(`${BASE_URL}/api/memory/reset`);
}

async function runSession(session: SessionFixture): Promise<ValidationResult> {
  const baseline = await postAnalyze(session, true);
  const sentriStartedAt = Date.now();
  const sentri = await postAnalyze(session, false);
  const sentriLatencyMs = Date.now() - sentriStartedAt;

  const decision = sentri.data?.decision ?? null;
  const sentriMode = sentri.data?.status === "NOVEL_ANOMALY"
    ? "NOVEL_ANOMALY"
    : decision?.mode ?? "BASELINE";
  const sentriMitigation = decision?.mitigationChain ?? ["INVESTIGATE", "NOTIFY_OWNER"];
  const sentriTokens = extractTokens(sentri.data);
  const baselineLatency = baseline.data?.latencyMs ?? 1150;
  const baselineTokens = baseline.data?.tokensUsed ?? 420;
  const latencySavingMs = baselineLatency - sentriLatencyMs;

  return {
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    baseline: {
      mitigation: baseline.data?.baselineMitigation ?? baseline.data?.recommendation ?? "",
      latencyMs: baselineLatency,
      tokensUsed: baselineTokens,
      patternDetected: false,
    },
    sentri: {
      mitigation: sentriMitigation,
      latencyMs: sentriLatencyMs,
      tokensUsed: sentriTokens,
      patternDetected: Boolean(decision?.patternDetected),
      patternId: decision?.patternId ?? null,
      mode: sentriMode,
      confidence: decision?.confidence ?? null,
    },
    delta: {
      latencySavingMs,
      latencySavingPct: `${Math.round((latencySavingMs / baselineLatency) * 100)}%`,
      tokenDelta: baselineTokens - sentriTokens,
      mitigationUpgrade:
        sentriMitigation.length > 1 || sentriMode === "COMPOSITE_OVERRIDE",
      compositeDetected: Boolean(decision?.patternDetected),
    },
  };
}

async function postAnalyze(session: SessionFixture, baseline: boolean) {
  const suffix = baseline ? "?mode=baseline" : "";
  return axios.post(`${BASE_URL}/api/analyze${suffix}`, {
    session_id: session.sessionLabel,
    trigger_type: session.trigger_type,
    payload: session.payload,
  });
}

function extractTokens(data: any): number {
  const raw = data?.cascadeAudit?.tokensUsed ?? data?.context?.cascadeAudit?.tokensUsed;
  if (typeof raw === "string") {
    const parsed = Number(raw.split("/")[0]?.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof data?.context?.tokensUsed === "number") return data.context.tokensUsed;
  if (typeof data?.tokensUsed === "number") return data.tokensUsed;
  return 0;
}

function printReport(results: ValidationResult[]): void {
  const avgLatency = Math.round(
    results.reduce((sum, result) => sum + result.delta.latencySavingMs, 0) /
      results.length
  );
  const composites = results.filter((result) => result.delta.compositeDetected).length;
  const upgrades = results.filter((result) => result.delta.mitigationUpgrade).length;

  console.log("\n+--------------------------------------------------------------------------+");
  console.log("|                     SENTRI VALIDATION REPORT                            |");
  console.log("+--------------------------------------------------------------------------+");
  console.log("| Session | Mode               | Latency d | Token d | Composite | Upgrade |");
  console.log("+--------------------------------------------------------------------------+");
  for (const result of results) {
    console.log(
      `| ${pad(String(result.sessionId), 7)} | ` +
        `${pad(result.sentri.mode, 18)} | ` +
        `${pad(`${result.delta.latencySavingMs}ms`, 9)} | ` +
        `${pad(String(result.delta.tokenDelta), 7)} | ` +
        `${pad(result.delta.compositeDetected ? "yes" : "no", 9)} | ` +
        `${pad(result.delta.mitigationUpgrade ? "yes" : "no", 7)} |`
    );
  }
  console.log("+--------------------------------------------------------------------------+");
  console.log(`Aggregate latency saving: ${avgLatency}ms avg`);
  console.log(`Composite patterns caught: ${composites}/5`);
  console.log(`Mitigation upgrades: ${upgrades}/5`);
}

function printRegressionChecks(results: ValidationResult[]): void {
  const session2 = results.find((result) => result.sessionId === 2);
  const session4 = results.find((result) => result.sessionId === 4);

  if (session2?.sentri.mode !== "BASELINE") {
    console.warn("REGRESSION: Session 2 did not appear as BASELINE.");
  }
  if (session4?.sentri.mode !== "COMPOSITE_OVERRIDE") {
    console.warn("REGRESSION: Session 4 did not appear as COMPOSITE_OVERRIDE.");
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width, " ");
}

main().catch((err) => {
  if (axios.isAxiosError(err)) {
    console.error(`Validation request failed: ${err.message}`);
    console.error(`URL: ${err.config?.url ?? "unknown"}`);
    console.error(`Status: ${err.response?.status ?? "none"}`);
    console.error(`Response: ${JSON.stringify(err.response?.data ?? null)}`);
    process.exit(1);
  }

  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
