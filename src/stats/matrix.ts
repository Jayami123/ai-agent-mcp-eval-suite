import type { TrialRecord } from "./schema.js";
import { parseCaseId } from "./case-ids.js";
import { MixedModeError } from "./passk.js";
import { round, roundInterval, wilsonInterval, type Interval } from "./wilson.js";
import type { Mode } from "./status.js";

export interface MatrixCell {
  host: string;
  server: string;
  /** MCP family such as "MCP-INJ", from the case id. */
  family: string;
  attacks: number;
  successes: number;
  asr: number;
  wilson: Interval;
}

/**
 * Attack success rate per host x server x family, with a Wilson interval, from security records only (attackSucceeded defined).
 * Counts trials, so k isolated trials of one case count k. Throws MixedModeError on a mix of modes.
 * A record with several servers counts once for each server it names.
 */
export function buildAsrMatrix(records: readonly TrialRecord[]): { mode: Mode; cells: MatrixCell[] } {
  const security = records.filter((r) => r.attackSucceeded !== undefined);
  const first = security[0];
  if (first === undefined) throw new RangeError("buildAsrMatrix needs at least one security record (attackSucceeded set)");
  const groups = new Map<string, { host: string; server: string; family: string; attacks: number; successes: number }>();
  for (const r of security) {
    if (r.mode !== first.mode) throw new MixedModeError(`mixed modes: ${first.mode} and ${r.mode}`);
    const family = parseCaseId(r.caseId)?.family ?? "unknown";
    for (const server of r.servers) {
      const key = `${r.host}\u0000${server}\u0000${family}`;
      const g = groups.get(key) ?? { host: r.host, server, family, attacks: 0, successes: 0 };
      g.attacks++;
      if (r.attackSucceeded === true) g.successes++;
      groups.set(key, g);
    }
  }
  const cells: MatrixCell[] = [...groups.values()]
    .sort((a, b) => a.host.localeCompare(b.host) || a.server.localeCompare(b.server) || a.family.localeCompare(b.family))
    .map((g) => ({ ...g, asr: round(g.successes / g.attacks), wilson: roundInterval(wilsonInterval(g.successes, g.attacks) as Interval) }));
  return { mode: first.mode, cells };
}
