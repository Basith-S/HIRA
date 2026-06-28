import fs from "fs/promises";
import path from "path";
import type { AgentDecision, GeminiClassification } from "../types/memory";

export type NotificationChannel = "EMAIL" | "SLACK" | "WEBHOOK";

export type NotificationPayload = {
  notificationId: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  sentAt: string;
  status: "STUB_SENT";
};

const DEFAULT_RECIPIENT = "soc-team@sentri.internal";
const LOG_FILE = path.resolve(__dirname, "../../logs/notifications.jsonl");

export async function dispatchNotification(
  classification: GeminiClassification,
  decision: AgentDecision | null,
  channel: NotificationChannel = "SLACK"
): Promise<NotificationPayload> {
  const sentAt = new Date().toISOString();
  const notificationId = `NOTIF-${Date.now()}`;
  const severity = classification.severity.toUpperCase();
  const threatType = classification.threatType ?? "unknown";
  const subject = buildSubject(classification.severity, threatType);
  const actionRequired = actionForSeverity(classification.severity);
  const mitigationChain =
    decision?.mitigationChain.join(" -> ") ?? "INVESTIGATE -> NOTIFY_OWNER";

  const body = [
    `Threat Type: ${threatType}`,
    `Severity: ${severity}`,
    `Confidence: ${(classification.confidence * 100).toFixed(1)}%`,
    `Reasoning: ${classification.reasoning}`,
    `Mode: ${decision?.mode ?? "NOVEL"}`,
    `Mitigation chain activated: ${mitigationChain}`,
    `Timestamp: ${sentAt}`,
    `Action required: ${actionRequired}`,
  ].join("\n");

  const payload: NotificationPayload = {
    notificationId,
    channel,
    recipient: DEFAULT_RECIPIENT,
    subject,
    body,
    sentAt,
    status: "STUB_SENT",
  };

  printNotification(payload);
  await appendNotificationLog(payload);

  return payload;
}

function buildSubject(
  severity: GeminiClassification["severity"],
  threatType: string
): string {
  if (severity === "critical") {
    return `[SENTRI CRITICAL] Critical threat detected — ${threatType}`;
  }
  if (severity === "high") {
    return `[SENTRI HIGH] High-severity incident — ${threatType}`;
  }
  return `[SENTRI NOTICE] Anomaly logged — ${threatType}`;
}

function actionForSeverity(severity: GeminiClassification["severity"]): string {
  if (severity === "critical") return "Review SENTRI dashboard immediately.";
  if (severity === "high") return "Review within 30 minutes.";
  return "No immediate action required. Logged for review.";
}

function printNotification(payload: NotificationPayload): void {
  const divider = "-----------------------------------";
  console.log(
    [
      divider,
      `[SENTRI NOTIFICATION - ${payload.channel}]`,
      "",
      `To: ${payload.recipient}`,
      "",
      `Subject: ${payload.subject}`,
      payload.body,
      "",
      divider,
    ].join("\n")
  );
}

async function appendNotificationLog(payload: NotificationPayload): Promise<void> {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.appendFile(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf-8");
}
