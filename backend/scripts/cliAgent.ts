import axios from "axios";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const BASE_URL = process.env["SENTRI_BASE_URL"] ?? "http://localhost:3001";

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("\n=======================================================");
  console.log("   SENTRI / HIRA — Interactive Security Agent Simulator");
  console.log("=======================================================");
  
  // Verify backend is available
  try {
    await axios.get(`${BASE_URL}/api/health`, { timeout: 3000 });
    console.log(`\x1b[32m✔ Connected to SENTRI API at ${BASE_URL}\x1b[0m`);
  } catch (err) {
    console.error(`\x1b[31m✘ Failed to connect to SENTRI backend at ${BASE_URL}.\x1b[0m`);
    console.error("Please run the backend server first via: npm run dev");
    rl.close();
    return;
  }

  while (true) {
    console.log("\n-------------------------------------------------------");
    console.log("Create a New Security Incident:");
    console.log("1. Traffic Spike (Potential DDoS)");
    console.log("2. Failed Logins (Potential Credential Stuffing)");
    console.log("3. Custom Anomaly (Forces Novel Anomaly Flow)");
    console.log("4. Large Data Log (Forces Budget Fallback)");
    console.log("5. Reset Security Memory");
    console.log("6. Exit");
    
    const choice = await askQuestion("\nSelect an option (1-6): ");
    
    if (choice === "6") {
      console.log("\nExiting simulator. Goodbye!");
      rl.close();
      break;
    }

    if (choice === "5") {
      console.log("\nResetting database security memory...");
      try {
        const response = await axios.post(`${BASE_URL}/api/memory/reset`);
        console.log(`\x1b[32m✔ ${response.data.message}\x1b[0m`);
      } catch (err: any) {
        console.error("\x1b[31mReset failed:\x1b[0m", err.message);
      }
      continue;
    }

    let triggerType = "";
    let source = "192.168.1.50";
    let severity = 0.5;
    let summary = "";
    let extraPayload: Record<string, any> = {};

    switch (choice) {
      case "1":
        triggerType = "traffic_spike";
        source = await askQuestion("Enter attacker source IP (default: 203.0.113.42): ") || "203.0.113.42";
        const rpsInput = await askQuestion("Enter requests per second (default: 12000): ");
        const rps = parseFloat(rpsInput) || 12000;
        severity = rps > 10000 ? 0.9 : 0.5;
        summary = `DDoS-like traffic spike containing ${rps} RPS against public API endpoint.`;
        extraPayload = { requests_per_second: rps, baseline_rps: 800 };
        break;

      case "2":
        triggerType = "failed_logins";
        source = await askQuestion("Enter attacker source IP (default: 198.51.100.17): ") || "198.51.100.17";
        const countInput = await askQuestion("Enter failed attempts count (default: 350): ");
        const attempts = parseInt(countInput) || 350;
        severity = attempts > 300 ? 0.95 : 0.6;
        summary = `Credential stuffing burst of ${attempts} failed logins targeting administrative accounts.`;
        extraPayload = { attempt_count: attempts, time_window_secs: 60, target_accounts: ["admin", "root"] };
        break;

      case "3":
        triggerType = await askQuestion("Enter custom trigger type (e.g. data_leak): ") || "unknown_threat";
        source = await askQuestion("Enter attacker source IP (default: 10.0.0.5): ") || "10.0.0.5";
        summary = await askQuestion("Enter incident summary: ") || "Novel security pattern evaluated.";
        severity = parseFloat(await askQuestion("Enter severity (0.0 to 1.0, default 0.7): ")) || 0.7;
        break;

      case "4":
        triggerType = "data_exfiltration";
        source = "db-prod-01";
        severity = 0.99;
        summary = "Large log context forcing token budget fallback threshold.";
        extraPayload = {
          bytes_out: 900000000,
          raw_log_dump: "exfiltration ".repeat(3200), // forces 8000+ token cap
        };
        console.log("\x1b[33mCreating oversized log payload (>8,000 tokens) to trigger Budget Fallback...\x1b[0m");
        break;

      default:
        console.log("\x1b[31mInvalid choice. Please select 1-6.\x1b[0m");
        continue;
    }

    extraPayload.source = source;
    extraPayload.severity = severity;
    extraPayload.summary = summary;

    console.log(`\n\x1b[36mFiring incident: ${triggerType} (Severity: ${severity}) from ${source}...\x1b[0m`);

    try {
      const response = await axios.post(`${BASE_URL}/api/analyze`, {
        session_id: `CLI-Sim-${Date.now().toString().slice(-4)}`,
        trigger_type: triggerType,
        payload: extraPayload,
      });

      const data = response.data;
      console.log("\n\x1b[32m=================== AGENT COGNITIVE SUMMARY ===================\x1b[0m");
      console.log(`Mitigation Decision Mode : \x1b[35m${data.decision?.mode ?? data.status}\x1b[0m`);
      console.log(`Recommendation           : \x1b[37m${data.recommendation}\x1b[0m`);
      
      if (data.decision?.mitigationChain) {
        console.log(`Mitigation Chain         : \x1b[33m${data.decision.mitigationChain.join(" ➔ ")}\x1b[0m`);
      }

      console.log("\n\x1b[34m[Hindsight Memory Context]\x1b[0m");
      console.log(`Used Vector Memory       : ${data.used_memory ? "Yes" : "No"}`);
      if (data.similarIncidents && data.similarIncidents.length > 0) {
        console.log(`Recalled Incidents (${data.similarIncidents.length}):`);
        data.similarIncidents.forEach((inc: any, idx: number) => {
          console.log(`  ${idx + 1}. ID: ${inc.id.substring(0, 8)}... | Type: ${inc.metadata.trigger_type} | Distance: ${inc.distance.toFixed(4)}`);
        });
      } else {
        console.log("  No similar past incidents recalled.");
      }

      if (data.cascadeAudit) {
        console.log("\n\x1b[34m[CascadeFlow Router Audit]\x1b[0m");
        console.log(`Complexity Level         : ${data.cascadeAudit.complexity}`);
        console.log(`Model Routing Path       : \x1b[36m${data.cascadeAudit.modelPath}\x1b[0m`);
        console.log(`Token Budget Used        : ${data.cascadeAudit.tokensUsed}`);
        console.log(`Latency Saving Estimate  : \x1b[32m${data.cascadeAudit.latencySavingPct}%\x1b[0m`);
        console.log("\nRouting Decisions Trail:");
        data.cascadeAudit.decisions.forEach((dec: string) => {
          console.log(`  ➔ ${dec}`);
        });
      }

      if (data.notificationId) {
        console.log(`\n\x1b[33m[Alert Dispatch Status]\x1b[0m`);
        console.log(`Notification ID Dispatched: ${data.notificationId}`);
      }

      console.log("\x1b[32m===============================================================\x1b[0m");

    } catch (err: any) {
      if (err.response) {
        console.error(`\x1b[31mAgent Analysis Failed: ${err.message}\x1b[0m`);
        console.error(err.response.data);
      } else {
        console.error(`\x1b[31mNetwork Error: ${err.message}\x1b[0m`);
      }
    }
  }
}

main();
