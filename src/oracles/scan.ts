import { fail, pass, unverified, type Verdict } from "./verdict.js";

// P4-MCP-SUPP-005. The dependency scanner is `npm audit --json` (the npm advisory database). Its report lists each
// vulnerable package with a severity and, for an advisory, a numeric source id. The gate fails on any high or critical
// advisory whose id is not in the committed baseline. Advisory ids are the only thing the gate keeps; titles and URLs
// are never copied into a verdict.

export type Severity = "info" | "low" | "moderate" | "high" | "critical";
const GATED: ReadonlySet<Severity> = new Set<Severity>(["high", "critical"]);

export interface Finding {
  /** Stable key: "<advisory source id>" for an advisory, "<package>" when the report names only a package. */
  key: string;
  pkg: string;
  severity: Severity;
}

export interface AuditReport {
  auditReportVersion?: unknown;
  vulnerabilities?: unknown;
  metadata?: { dependencies?: { total?: unknown } };
}

/** Flattens an npm audit report into findings. A report that is not an audit report yields `null` (unverified, not clean). */
export function findingsFromAudit(report: unknown): Finding[] | null {
  const r = report as AuditReport | null;
  if (typeof r !== "object" || r === null || r.auditReportVersion === undefined || typeof r.vulnerabilities !== "object" || r.vulnerabilities === null) return null;
  const out: Finding[] = [];
  for (const [pkg, entry] of Object.entries(r.vulnerabilities as Record<string, unknown>)) {
    const e = entry as { severity?: unknown; via?: unknown } | null;
    const severity = e?.severity as Severity | undefined;
    if (severity === undefined) continue;
    const via = Array.isArray(e?.via) ? (e?.via as unknown[]) : [];
    // An advisory is a via object with a numeric source; its own severity wins over the package entry's.
    const advisories = via.filter((v): v is { source: number; severity?: Severity } => typeof v === "object" && v !== null && typeof (v as { source?: unknown }).source === "number");
    if (advisories.length === 0) out.push({ key: pkg, pkg, severity });
    for (const adv of advisories) out.push({ key: String(adv.source), pkg, severity: adv.severity ?? severity });
  }
  return out;
}

/** Keeps only the gated findings that the baseline does not already list. */
export function newGatedFindings(findings: Finding[], baseline: ReadonlySet<string>): Finding[] {
  return findings.filter((f) => GATED.has(f.severity) && !baseline.has(f.key));
}

export function noNewHighCritical(report: unknown, baseline: { advisories: string[] }): Verdict {
  const findings = findingsFromAudit(report);
  if (findings === null) return unverified("the scanner output is not an npm audit report, so the scan did not run");
  const fresh = newGatedFindings(findings, new Set(baseline.advisories));
  const total = (report as AuditReport).metadata?.dependencies?.total;
  const scanned = typeof total === "number" ? `${total} dependencies` : "dependencies";
  if (fresh.length === 0) return pass(`${scanned} scanned: ${findings.length} finding(s), none high or critical outside the baseline (${baseline.advisories.length} baselined)`);
  return fail(`${fresh.length} high or critical finding(s) not in the baseline: ${fresh.slice(0, 5).map((f) => `${f.pkg} (${f.severity}, key ${f.key})`).join("; ")}`);
}
