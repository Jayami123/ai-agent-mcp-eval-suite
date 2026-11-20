import type { ProductAdapter } from "qa-portfolio-harness";
import type { ServerId, Snapshot } from "./snapshot.js";
import { MattermostOracle } from "./mattermost.js";
import { NextcloudOracle } from "./nextcloud.js";
import { OutlineOracle } from "./outline.js";
import { PenpotOracle } from "./penpot.js";
import fs from "node:fs";
import { TwentyOracle } from "./twenty.js";

/** What every per-server oracle offers. Read-only: it never writes to the product it watches. */
export interface ServerOracle {
  readonly server: ServerId;
  /** The protected stores of this server as one snapshot (compare before and after with unchanged()). */
  snapshot(): Promise<Snapshot>;
  close(): Promise<void>;
}

/** Each server's oracle lands in the PR named in section 13. Asking for one that has not landed fails loudly. */
export function oracleFor(server: ServerId, adapter: ProductAdapter): ServerOracle {
  if (server === "twenty") return new TwentyOracle(adapter);
  if (server === "nextcloud") return new NextcloudOracle(adapter);
  if (server === "penpot") return new PenpotOracle(adapter);
  if (server === "mattermost") return new MattermostOracle(adapter);
  if (server === "outline") return new OutlineOracle(...outlineTarget(adapter));
  throw new Error(`L3_ORACLE_MISSING: the ${server} oracle has not landed yet (see section 13 of the L3 plan)`);
}

/** The owner's origin and Authorization value, from the run state the harness wrote (never printed). */
function outlineTarget(adapter: ProductAdapter): [string, string] {
  const file = adapter.mcpRunStateFile?.();
  if (file === undefined) throw new Error("L3_NO_RUN_STATE: the outline adapter has no mcpRunStateFile (harness too old)");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpUrl?: unknown; mcpAuthorization?: unknown };
  if (typeof parsed.mcpUrl !== "string" || typeof parsed.mcpAuthorization !== "string") throw new Error("OUTLINE_RUN_STATE_SHAPE: run state lacks mcpUrl or mcpAuthorization (content not printed)");
  return [OutlineOracle.originOf(parsed.mcpUrl), parsed.mcpAuthorization];
}
