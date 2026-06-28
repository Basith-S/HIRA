import fs from "fs/promises";
import path from "path";
import type { AgentDecision, InputTrigger } from "../types/memory";

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
  trigger: InputTrigger,
  decision: AgentDecision | null,
  channel: NotificationChannel = "SLACK"
): Promise<NotificationPayload> {
  const sentAt = new Date().toISOString();
  const notificationId = `NOTIF-${Date.now()}`;
  const severity = severityLabel(trigger.severity);
  const subject = buildSubject(severity, trigger.trigger_type);
  const actionRequired = actionForSeverity(severity);
  const mitigationChain =
    decision?.mitigationChain.join(" -> ") ?? "INVESTIGATE -> NOTIFY_OWNER";

  const body = [
    `Incident ID: ${decision?.patternId ?? "NOVEL"}`,
    `Pattern: ${decision?.patternLabel ?? "Unknown - under investigation"}`,
    `Severity: ${severity}`,
    `Mitigation chain activated: ${mitigationChain}`,
    `Confidence: ${decision?.confidence != null ? `${(decision.confidence * 100).toFixed(1)}%` : "N/A"}`,
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

function severityLabel(rawSeverity: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (rawSeverity >= 0.95) return "CRITICAL";
  if (rawSeverity >= 0.75) return "HIGH";
  if (rawSeverity >= 0.4) return "MEDIUM";
  return "LOW";
}

function buildSubject(
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  triggerType: string
): string {
  if (severity === "CRITICAL") {
    return `[SENTRI CRITICAL] Composite attack pattern detected - ${triggerType}`;
  }
  if (severity === "HIGH") {
    return `[SENTRI HIGH] Escalated incident - ${triggerType}`;
  }
  return `[SENTRI NOTICE] Anomaly logged - ${triggerType}`;
}

function actionForSeverity(severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"): string {
  if (severity === "CRITICAL") return "Review SENTRI dashboard immediately.";
  if (severity === "HIGH") return "Review within 30 minutes.";
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
