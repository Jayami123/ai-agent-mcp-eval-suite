import type { ProductAdapter } from "qa-portfolio-harness";
import type { ServerId, Snapshot } from "./snapshot.js";
import { MattermostOracle } from "./mattermost.js";
import { NextcloudOracle } from "./nextcloud.js";
import { PenpotOracle } from "./penpot.js";
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
  throw new Error(`L3_ORACLE_MISSING: the ${server} oracle has not landed yet (see section 13 of the L3 plan)`);
}
