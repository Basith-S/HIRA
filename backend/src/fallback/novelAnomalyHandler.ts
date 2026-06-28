import { storeIncident } from "../memory/memoryService";
import { dispatchNotification } from "../notifications/notificationStubs";
import type { InputTrigger, MemoryArtifact } from "../types/memory";

export type NovelAnomalyResponse = {
  status: "NOVEL_ANOMALY";
  action: "INVESTIGATE_AND_NOTIFY";
  trigger: InputTrigger;
  storedAs: string;
  notificationId: string;
  timestamp: string;
  message: string;
};

export async function handleNovelAnomaly(
  trigger: InputTrigger
): Promise<NovelAnomalyResponse> {
  const timestamp = new Date().toISOString();
  const incidentId = `NOV-${Date.now()}`;
  const artifact: MemoryArtifact = {
    incident_id: incidentId,
    trigger_type: trigger.trigger_type,
    vectors: [],
    mitigation_success: true,
    hindsight_note: "Novel anomaly - no historical match. Stored for future pattern learning.",
    created_at: timestamp,
  };

  try {
    await storeIncident(artifact);
  } catch (err) {
    console.error("[NovelAnomaly] storeIncident failed (non-fatal):", err);
  }

  let notificationId = "NOTIF-UNAVAILABLE";
  try {
    const notification = await dispatchNotification(trigger, null);
    notificationId = notification.notificationId;
  } catch (err) {
    console.error("[Notification] dispatch failed for novel anomaly (non-fatal):", err);
  }

  return {
    status: "NOVEL_ANOMALY",
    action: "INVESTIGATE_AND_NOTIFY",
    trigger,
    storedAs: incidentId,
    notificationId,
    timestamp,
    message: "Novel anomaly - no historical match. Stored for future pattern learning.",
  };
}
