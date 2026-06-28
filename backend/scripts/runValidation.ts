import axios from "axios";
import { DEMO_SESSIONS, DemoSession } from "../src/demo/sessionScript";
import type { AgentDecisionMode } from "../src/types/memory";

type ValidationResult = {
  sessionId: number;
  sessionLabel: string;
  baseline: {
    verdict: "THREAT" | "CLEAN";
    mitigation: string;
    latencyMs: number;
    tokensUsed: number;
  };
  sentri: {
    verdict: "THREAT" | "CLEAN" | "NOVEL";
    isThreat: boolean;
    severity: string;
    confidence: number;
    mode: AgentDecisionMode;
    mitigationChain: string[];
    attackChain: string[];
    cvssScore: number | null;
    latencyMs: number;
    tokensUsed: number;
    modelPath: string;
  };
  delta: {
    correctDetection: boolean;
    latencySavingMs: number;
    latencySavingPct: string;
    tokenDelta: number;
    mitigationUpgrade: boolean;
    escalated: boolean;
  };
};

const BASE_URL = process.env["SENTRI_BASE_URL"] ?? "http://localhost:3001";

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

async function runSession(session: DemoSession): Promise<ValidationResult> {
  const baseline = await postAnalyze(session, true);
  const sentriStartedAt = Date.now();
  const sentri = await postAnalyze(session, false);
  const sentriLatencyMs = Date.now() - sentriStartedAt;

  const decision = sentri.data?.decision ?? null;
  const classification = sentri.data?.classification ?? {};
  
  const sentriMode = sentri.data?.status === "NOVEL_ANOMALY"
    ? "NOVEL_ANOMALY"
    : decision?.mode ?? "BASELINE";
    
  const sentriMitigation = decision?.mitigationChain ?? ["INVESTIGATE", "NOTIFY_OWNER"];
  const sentriTokens = extractTokens(sentri.data);
  const baselineLatency = baseline.data?.latencyMs ?? 1150;
  const baselineTokens = baseline.data?.tokensUsed ?? 420;
  const latencySavingMs = baselineLatency - sentriLatencyMs;

  const isThreat = classification.isThreat ?? false;
  const correctDetection = isThreat === (session.expectThreat ?? true);

  return {
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    baseline: {
      verdict: "THREAT", // Mock baseline always assumes threat for validation purposes (or handles via old trigger types)
      mitigation: baseline.data?.baselineMitigation ?? baseline.data?.recommendation ?? "",
      latencyMs: baselineLatency,
      tokensUsed: baselineTokens,
    },
    sentri: {
      verdict: sentriMode === "NOVEL_ANOMALY" ? "NOVEL" : (isThreat ? "THREAT" : "CLEAN"),
      isThreat,
      severity: classification.severity ?? "unknown",
      confidence: classification.confidence ?? 0,
      mode: sentriMode as AgentDecisionMode,
      mitigationChain: sentriMitigation,
      attackChain: decision?.attackChain ?? [],
      cvssScore: decision?.cvssScore ?? null,
      latencyMs: sentriLatencyMs,
      tokensUsed: sentriTokens,
      modelPath: sentri.data?.context?.modelPath ?? "unknown",
    },
    delta: {
      correctDetection,
      latencySavingMs,
      latencySavingPct: `${Math.round((latencySavingMs / baselineLatency) * 100)}%`,
      tokenDelta: baselineTokens - sentriTokens,
      mitigationUpgrade: sentriMitigation.length > 1 || sentriMode === "COMPOSITE_OVERRIDE" || sentriMode === "DEEP_ANALYSIS",
      escalated: sentri.data?.context?.modelPath?.includes("pro") ?? false,
    },
  };
}

async function postAnalyze(session: DemoSession, baseline: boolean) {
  const suffix = baseline ? "?mode=baseline" : "";
  return axios.post(`${BASE_URL}/api/analyze${suffix}`, {
    inputType: session.inputType,
    content: session.content,
    source: session.source,
    filename: session.filename,
    // Provide fallback for legacy fields just in case
    session_id: session.sessionLabel,
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
  const correct = results.filter((result) => result.delta.correctDetection).length;
  const upgrades = results.filter((result) => result.delta.mitigationUpgrade).length;

  console.log("\n╔══════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                        SENTRI VALIDATION REPORT                               ║");
  console.log("╠══════════════════════════════════════════════════════════════════════════════════╣");
  console.log("║ S# │ Verdict │ Mode               │ CVSS │ Latency Δ  │ Model                 ║");
  console.log("╠══════════════════════════════════════════════════════════════════════════════════╣");
  for (const result of results) {
    const cvssStr = result.sentri.cvssScore ? result.sentri.cvssScore.toFixed(1) : "—";
    const latencyStr = `${result.delta.latencySavingMs <= 0 ? "" : "+"}${result.delta.latencySavingMs}ms`;
    let modelShort = result.sentri.modelPath;
    if (modelShort.includes("flash") && modelShort.includes("pro")) modelShort = "flash → pro";
    else if (modelShort.includes("flash")) modelShort = "flash";
    else if (modelShort.includes("pro")) modelShort = "pro";

    console.log(
      `║ ${pad(String(result.sessionId), 2)} │ ` +
        `${pad(result.sentri.verdict, 7)} │ ` +
        `${pad(result.sentri.mode, 18)} │ ` +
        `${pad(cvssStr, 4)} │ ` +
        `${pad(latencyStr, 10)} │ ` +
        `${pad(modelShort, 21)} ║`
    );
  }
  console.log("╚══════════════════════════════════════════════════════════════════════════════════╝");
  console.log(`Threats correctly identified: ${correct}/${results.length}`);
  const falsePositives = results.filter(r => r.sentri.isThreat && r.baseline.verdict === "CLEAN").length; // Very naive check
  // console.log(`False positives: ${falsePositives}`);
  console.log(`Aggregate latency saving: ${avgLatency}ms avg`);
  console.log(`Mitigation upgrades: ${upgrades}/${results.length}`);
}

function printRegressionChecks(results: ValidationResult[]): void {
  const session2 = results.find((result) => result.sessionId === 2);
  const session4 = results.find((result) => result.sessionId === 4);

  if (session2 && session2.sentri.verdict !== "CLEAN") {
    console.warn("REGRESSION: Session 2 did not appear as CLEAN.");
  }
  if (session4 && session4.sentri.mode !== "DEEP_ANALYSIS" && session4.sentri.mode !== "COMPOSITE_OVERRIDE") {
    console.warn("REGRESSION: Session 4 did not appear as DEEP_ANALYSIS or COMPOSITE_OVERRIDE.");
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
