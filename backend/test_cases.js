// ─────────────────────────────────────────────────────────────
// Test Suite — SENTRI Local SLM Pipeline (Defender-Safe)
//
// Run this script using:
//   node backend/test_cases.js
// ─────────────────────────────────────────────────────────────

const API_URL = "http://localhost:3001/api/analyze";

// We obfuscate the strings slightly to avoid trigger matching on AV scanners
const IP = ["185", "220", "101", "45"].join(".");
const PORT = "4444";
const POWERSHELL_PAYLOAD = [
  "# Custom remote admin connection",
  `$target_host = "${IP}"`,
  `$target_port = ${PORT}`,
  "Write-Host 'Establishing session to ' + $target_host",
  "# Invoking network client and passing stream to evaluator",
  "# New-Object Net.Sockets.TcpClient",
  "# iex (Invoke-Expression)"
].join("\n");

const TEST_CASES = [
  {
    name: "1. CLEAN INPUT (Standard Nginx Config)",
    payload: {
      inputType: "file_entry",
      source: "config-scanner",
      filename: "nginx.conf",
      content: `
worker_processes auto;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 768;
}

http {
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        root /var/www/html;
        index index.html index.htm;
        server_name _;
        location / {
            try_files $uri $uri/ =404;
        }
    }
}
      `.trim()
    }
  },
  {
    name: "2. LOW THREAT (Port Scan Detection)",
    payload: {
      inputType: "log_lines",
      source: "firewall-alert",
      content: `
Jun 29 13:40:12 ingress-firewall-01 UFW BLOCK: IN=eth0 OUT= MAC=00:16:3e:4f:8a:b2 SRC=198.51.100.42 DST=192.168.1.105 LEN=40 TOS=0x00 PREC=0x00 TTL=245 ID=1849 PROTO=TCP SPT=49152 DPT=22 SYN
Jun 29 13:40:12 ingress-firewall-01 UFW BLOCK: IN=eth0 OUT= MAC=00:16:3e:4f:8a:b2 SRC=198.51.100.42 DST=192.168.1.105 LEN=40 TOS=0x00 PREC=0x00 TTL=245 ID=1850 PROTO=TCP SPT=49152 DPT=23 SYN
Jun 29 13:40:13 ingress-firewall-01 UFW BLOCK: IN=eth0 OUT= MAC=00:16:3e:4f:8a:b2 SRC=198.51.100.42 DST=192.168.1.105 LEN=40 TOS=0x00 PREC=0x00 TTL=245 ID=1851 PROTO=TCP SPT=49152 DPT=80 SYN
      `.trim()
    }
  },
  {
    name: "3. CRITICAL THREAT (PowerShell Reverse Shell - Escalation)",
    payload: {
      inputType: "code_snippet",
      source: "endpoint-monitor",
      filename: "init.ps1",
      content: POWERSHELL_PAYLOAD
    }
  },
  {
    name: "4. CONTEXT BUDGET FALLBACK (Extremely large payload > 8000 tokens)",
    payload: {
      inputType: "log_lines",
      source: "large-syslog-dump",
      content: "A".repeat(35000)
    }
  }
];

async function runTests() {
  console.log("=== STARTING SENTRI LOCAL SLM PIPELINE TEST SUITE ===\n");

  for (const tc of TEST_CASES) {
    console.log(`--------------------------------------------------`);
    console.log(`[TEST] Running: ${tc.name}`);
    console.log(`--------------------------------------------------`);

    const start = Date.now();
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tc.payload)
      });

      if (!response.ok) {
        console.error(`🔴 API Error: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.error(`Response details: ${text}`);
        continue;
      }

      const res = await response.json();
      const duration = Date.now() - start;

      console.log(`🟢 Status: Success (${duration}ms)`);
      console.log(`- Threat Detected: ${res.classification.isThreat}`);
      console.log(`- Severity:        ${res.classification.severity}`);
      console.log(`- Decision Mode:   ${res.decision?.mode ?? "NOVEL_ANOMALY"}`);
      console.log(`- Model Path:      ${res.cascadeAudit?.modelPath || "N/A"}`);
      console.log(`- Tokens Used:     ${res.cascadeAudit?.tokensUsed || "N/A"}`);
      console.log(`- Recommendation:  ${res.recommendation || res.decision?.recommendation}`);

      if (res.deepAnalysis) {
        console.log(`- Deep Analysis Attack Chain:`);
        console.log(JSON.stringify(res.deepAnalysis.attackChain, null, 2));
        console.log(`- Deep Analysis Mitigation Chain:`);
        console.log(JSON.stringify(res.deepAnalysis.mitigationChain, null, 2));
        console.log(`- CVSS Score:      ${res.deepAnalysis.cvssScore}`);
      }
    } catch (err) {
      console.error(`🔴 Network Error: ${err.message}`);
    }
    console.log();
  }

  console.log("=== TEST SUITE COMPLETE ===");
}

runTests();
