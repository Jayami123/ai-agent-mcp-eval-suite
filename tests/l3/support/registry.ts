import fs from "node:fs";
import path from "node:path";

export type L3Mode = "P" | "G" | "M";
export type L3Home = "twenty" | "outline" | "nextcloud" | "penpot" | "mattermost" | "all" | "host";

export interface L3CaseDef {
  id: string;
  kind: "core" | "stretch";
  home: L3Home;
  modes: L3Mode[];
  /** Blockers from section 6 of the plan, for example ["APPR", "NCMAIL"]. Empty means it can be built on the L1 stack. */
  needs: string[];
  wave: string;
  /** Number of the L3 PR that lands this case (section 13). 0 means deferred, not built in L3. */
  pr: number;
  /** Stub fixture ids (file names in src/stub/fixtures, without .json). Empty for protocol-only and nightly-only cases. */
  fixtures: string[];
}

const FILE = path.resolve(process.cwd(), "tests", "l3", "support", "l3-cases.json");

export function loadRegistry(): L3CaseDef[] {
  return JSON.parse(fs.readFileSync(FILE, "utf8")) as L3CaseDef[];
}

export function caseDef(id: string): L3CaseDef {
  const def = loadRegistry().find((c) => c.id === id);
  if (!def) throw new Error(`L3_UNKNOWN_CASE: ${id} is not in tests/l3/support/l3-cases.json. Case IDs come from the ledger only.`);
  if (def.pr === 0) throw new Error(`L3_DEFERRED_CASE: ${id} is deferred; it has no test in L3.`);
  return def;
}
