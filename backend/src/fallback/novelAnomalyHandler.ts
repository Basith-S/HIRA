import { storeIncident } from "../memory/memoryService";
import { dispatchNotification } from "../notifications/notificationStubs";
import type {
  GeminiClassification,
  RawInput,
  MemoryArtifact,
} from "../types/memory";

export type NovelAnomalyResponse = {
  status: "NOVEL_ANOMALY";
  action: "INVESTIGATE_AND_NOTIFY";
  inputId: string;
  storedAs: string;
  notificationId: string;
  timestamp: string;
  message: string;
};

export async function handleNovelAnomaly(
  input: RawInput,
  classification: GeminiClassification
): Promise<NovelAnomalyResponse> {
  const timestamp = new Date().toISOString();
  const incidentId = `NOV-${Date.now()}`;

  // Build a MemoryArtifact from the classification to store for future pattern learning
  const artifact: MemoryArtifact = {
    incident_id: incidentId,
    trigger_type: classification.threatType ?? input.inputType,
    vectors: [],
    mitigation_success: true,
    hindsight_note: `Novel anomaly — ${classification.reasoning} Content source: ${input.source ?? "unknown"}`,
    created_at: timestamp,
  };

  try {
    await storeIncident(artifact);
  } catch (err) {
    console.error("[NovelAnomaly] storeIncident failed (non-fatal):", err);
  }

  let notificationId = "NOTIF-UNAVAILABLE";
  try {
    const notification = await dispatchNotification(classification, null);
    notificationId = notification.notificationId;
  } catch (err) {
    console.error("[Notification] dispatch failed for novel anomaly (non-fatal):", err);
  }

  return {
    status: "NOVEL_ANOMALY",
    action: "INVESTIGATE_AND_NOTIFY",
    inputId: input.inputId,
    storedAs: incidentId,
    notificationId,
    timestamp,
    message: `Novel anomaly — no historical match. ${classification.reasoning} Stored for future pattern learning.`,
  };
}
