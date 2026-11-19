import path from "node:path";
import { after, before } from "node:test";
import type { ProductAdapter } from "qa-portfolio-harness";
import { oracleFor, type ServerOracle } from "../../../src/oracles/index.js";
import { runId } from "../../l1/evidence.js";
import { requireStubContainer } from "../../l1/stub-recorder.js";
import { startStack, type BusinessServer, type L3Stack, type StackServer } from "./stack.js";

// One stack per entry file (tests/l3/<group>/run.e2e.ts), shared by every case module that file imports. Bringing a
// product up is the slow part (minutes), so cases share it. The harness owns start and stop; this only calls it.

export interface Runtime {
  stack: L3Stack;
  servers: BusinessServer[];
  /** Evidence sub-directory for this run. */
  dir: string;
  oracle(server: BusinessServer): ServerOracle;
}

let current: Runtime | undefined;

export function runtime(): Runtime {
  if (current === undefined) throw new Error("L3_RUNTIME_NOT_STARTED: call bootRuntime() in the entry file before the cases run");
  return current;
}

/** Registers the before and after hooks. Does nothing unless P4_STACK_TESTS=1, so `npm test` needs no Docker. */
export function bootRuntime(servers: StackServer[], label: string): void {
  if (process.env["P4_STACK_TESTS"] !== "1") return;
  const dir = path.join("l3", `${label}-${runId()}`);
  const oracles = new Map<BusinessServer, ServerOracle>();
  const businessServers = servers.filter((s): s is BusinessServer => s !== "lab" && s !== "lab2");
  before(
    async () => {
      await requireStubContainer();
      const stack = await startStack(servers, dir);
      for (const s of businessServers) oracles.set(s, oracleFor(s, stack.adapters.get(s) as ProductAdapter));
      current = { stack, servers: businessServers, dir, oracle: (s) => oracles.get(s) as ServerOracle };
    },
    { timeout: 40 * 60_000 },
  );
  after(
    async () => {
      for (const o of oracles.values()) await o.close().catch(() => undefined);
      await current?.stack.stop();
      current = undefined;
    },
    { timeout: 20 * 60_000 },
  );
}
