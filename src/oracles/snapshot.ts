import { createHash } from "node:crypto";
import { canonicalJson } from "../stub/canonical.js";
import { fail, pass, type Verdict } from "./verdict.js";

export type ServerId = "twenty" | "outline" | "nextcloud" | "penpot" | "mattermost" | "lab";

/** A before/after reading of one product store. Only the digest and a small summary are kept in evidence. */
export interface Snapshot {
  server: ServerId;
  /** What was read, for example "people+companies+opportunities+notes". */
  scope: string;
  digest: string;
  /** Secret-free summary (row counts, titles of seed rows). Full rows are never written to evidence. */
  summary: Record<string, unknown>;
}

export function digestOf(rows: unknown): string {
  return createHash("sha256").update(canonicalJson(rows)).digest("hex");
}

export function makeSnapshot(server: ServerId, scope: string, rows: unknown, summary: Record<string, unknown>): Snapshot {
  return { server, scope, digest: digestOf(rows), summary };
}

export function unchanged(before: Snapshot, after: Snapshot): Verdict {
  if (before.server !== after.server || before.scope !== after.scope) return fail("snapshots are not comparable");
  return before.digest === after.digest
    ? pass(`${before.server} ${before.scope} unchanged`)
    : fail(`${before.server} ${before.scope} changed: before ${JSON.stringify(before.summary)}, after ${JSON.stringify(after.summary)}`);
}

/** Minimal shape of a tools/list entry. */
export interface PinnedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
}

/**
 * P4-MCP-PROT-007: differences between the committed tools/list and a live one: names added or removed, and for a shared
 * name any change to description, inputSchema, outputSchema or annotations. Empty means no drift.
 */
export function toolsDiff(pinned: PinnedTool[], live: PinnedTool[]): string[] {
  const out: string[] = [];
  const p = new Map(pinned.map((t) => [t.name, t]));
  const l = new Map(live.map((t) => [t.name, t]));
  for (const n of p.keys()) if (!l.has(n)) out.push(`tool removed: ${n}`);
  for (const n of l.keys()) if (!p.has(n)) out.push(`tool added: ${n}`);
  for (const [n, a] of p) {
    const b = l.get(n);
    if (b === undefined) continue;
    for (const field of ["description", "inputSchema", "outputSchema", "annotations"] as const) {
      if (digestOf(a[field] ?? null) !== digestOf(b[field] ?? null)) out.push(`${n}: ${field} changed`);
    }
  }
  return out;
}

export function toolsMatchPin(pinned: PinnedTool[], live: PinnedTool[]): Verdict {
  const diff = toolsDiff(pinned, live);
  return diff.length === 0 ? pass(`${live.length} tools match the committed snapshot`) : fail(`tools/list drift: ${diff.slice(0, 6).join("; ")}`);
}
