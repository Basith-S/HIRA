// ─────────────────────────────────────────────────────────────
// Classifier contract — generated, not authored here.
//
// contract.json comes from osava-ft/export_contract.py, which derives it from
// the same prompt.py the model was trained and evaluated under. Do not edit
// either file by hand: regenerate with
//
//     python3 export_contract.py --also <this dir>/contract.json
//
// This module exists because every fact in that JSON had previously been
// restated on this side, and the restatements drifted. VALID_SEVERITIES still
// listed `critical` after R5 dropped it; parseClassification() required
// `confidence` after R7 removed it, which made every response fail validation
// and fall back to "benign"; promptBuilder's few-shot examples still taught the
// pre-R4 seven-field schema. None of those failed loudly.
// ─────────────────────────────────────────────────────────────

import contractJson from "./contract.json";
import type { RawInputType } from "../types/memory";

export interface ClassifierContract {
  schema_version: string;
  model: string;
  input: {
    field_order: string[];
    max_cmdline: number;
    truncation_marker: string;
    user_message_template: string;
    supported_input_types: string[];
  };
  severity: {
    scale: string[];
    accepted_on_input: string[];
    bucket: Record<string, string>;
    classes: string[];
    score_prefix: string;
  };
  routing: {
    escalate_severities: string[];
    escalate_threat_types: string[];
    confidence_reported_by_model: boolean;
    confidence_from_severity: Record<string, number>;
  };
  indicators: string[];
  output_fields: string[];
  prompt_sha256: string;
  prompt_variant: string;
}

export const CONTRACT = contractJson as ClassifierContract;

export const VALID_SEVERITIES = new Set(CONTRACT.severity.accepted_on_input);
export const ESCALATE_SEVERITIES = new Set(CONTRACT.routing.escalate_severities);
export const ESCALATE_THREAT_TYPES = new Set(CONTRACT.routing.escalate_threat_types);
export const CONFIDENCE_FROM_SEVERITY = CONTRACT.routing.confidence_from_severity;

/**
 * Can the specialist classify this input at all?
 *
 * osava-smollm was fine-tuned on Windows Sysmon telemetry and nothing else.
 * Measured behaviour on out-of-distribution input is `severity: "none"` — it
 * does not decline, it answers "clean". A PowerShell reverse shell submitted
 * as `code_snippet` comes back benign, which is the worst failure an intake
 * tier can have. Route anything else to the generalist path instead.
 */
export function isSupportedInput(inputType: RawInputType): boolean {
  return CONTRACT.input.supported_input_types.includes(inputType);
}

/** Fold `critical` into `high` (R5) and map severity to the 3-class bucket. */
export function bucketOf(severity: string): string {
  return CONTRACT.severity.bucket[severity] ?? "benign";
}

/** Routing is the host's decision (R7), computed from what the model reports. */
export function shouldEscalate(severity: string, threatType: string | null): boolean {
  return (
    ESCALATE_SEVERITIES.has(severity) ||
    (threatType !== null && ESCALATE_THREAT_TYPES.has(threatType))
  );
}

/**
 * Render a raw payload into the frozen `Key: value` contract (R1).
 *
 * Field order is load-bearing — the model was trained on exactly this
 * sequence. Lines that do not parse as a known field are dropped rather than
 * passed through, because unrecognised text is precisely what the model has
 * never seen. Returns null when nothing usable is left, which the caller must
 * treat as "cannot classify", never as "clean".
 */
export function renderContract(content: string): string | null {
  const fields = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const key = CONTRACT.input.field_order.find(
      (f) => f.toLowerCase() === m[1]!.toLowerCase()
    );
    if (key && !fields.has(key)) fields.set(key, (m[2] ?? "").trim());
  }
  if (!fields.has("EventID")) return null;

  const out: string[] = [];
  for (const f of CONTRACT.input.field_order) {
    let v = fields.get(f);
    if (v === undefined || v === "") continue;
    // R3: the same 512-char cap the training data was built under.
    if (v.length > CONTRACT.input.max_cmdline) {
      v = v.slice(0, CONTRACT.input.max_cmdline) + CONTRACT.input.truncation_marker;
    }
    out.push(`${f}: ${v.replace(/%%/g, "%")}`);
  }
  return out.length ? out.join("\n") : null;
}

/** Wrap a rendered event in the user-message template the model was trained on. */
export function buildContractPrompt(body: string): string {
  return CONTRACT.input.user_message_template.replace("{body}", body);
}
