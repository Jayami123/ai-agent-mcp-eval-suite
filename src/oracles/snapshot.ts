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
