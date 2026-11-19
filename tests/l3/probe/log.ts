import { redact } from "../../l1/evidence.js";

// Probe output. Every line starts with PROBE| so the live observations can be pulled out of a CI log. Values are redacted and
// cut to a length a reader can take in; nothing here prints an Authorization value, a token or a password.
let secrets: string[] = [];
export function setProbeSecrets(values: string[]): void {
  secrets = values;
}
export function probe(label: string, value: unknown, max = 1500): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const clean = redact(text ?? "undefined", secrets).replace(/\s+/g, " ");
  console.log(`PROBE|${label}|${clean.length > max ? `${clean.slice(0, max)}...(+${clean.length - max})` : clean}`);
}
