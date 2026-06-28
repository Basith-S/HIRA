mod schemas;

use schemas::{AnomalyReport, BaselineResult};

// ─────────────────────────────────────────────────────────────
// Phase 1 — "Dumb" Baseline Routing
//
// This is the naive "Before" state: it accepts an anomaly report,
// ignores any past memory or CascadeFlow logic, and returns a
// generic security recommendation string.
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn analyze_incident_baseline(report: AnomalyReport) -> BaselineResult {
    let recommendation = match report.trigger_type.as_str() {
        "traffic_spike" => format!(
            "[BASELINE] Traffic spike detected for session '{}'. \
             Generic recommendation: enable rate-limiting on the affected \
             ingress and monitor for 15 minutes. No historical memory was \
             consulted. No CascadeFlow reasoning was applied.",
            report.session_id
        ),
        "failed_logins" => format!(
            "[BASELINE] Failed login burst detected for session '{}'. \
             Generic recommendation: temporarily lock the targeted accounts, \
             enforce CAPTCHA on the login endpoint, and alert the SOC team. \
             No historical memory was consulted. No CascadeFlow reasoning \
             was applied.",
            report.session_id
        ),
        other => format!(
            "[BASELINE] Unknown trigger type '{}' for session '{}'. \
             Generic recommendation: forward to a human analyst for triage.",
            other, report.session_id
        ),
    };

    BaselineResult {
        session_id: report.session_id,
        trigger_type: report.trigger_type,
        recommendation,
        used_memory: false,
        used_cascade: false,
    }
}

// Keep the original greet command so nothing breaks during dev.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, analyze_incident_baseline])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
