import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { noNewHighCritical } from "../../../src/oracles/scan.js";
import { fail } from "../../../src/oracles/verdict.js";
import { l3Case } from "../support/case.js";

// P4-MCP-SUPP-005. The dependency scanner is `npm audit --json`. The gate fails on any high or critical advisory that is not
// in the committed baseline (tests/l3/snapshots/scan-baseline.json). It needs the npm advisory endpoint, the same registry
// that `npm ci` uses. A scanner that cannot reach it leaves the case unverified, which fails.
const BASELINE = path.resolve(process.cwd(), "tests", "l3", "snapshots", "scan-baseline.json");
const run = promisify(execFile);

l3Case(
  "P4-MCP-SUPP-005",
  "the dependency scan has no high or critical advisory outside the committed baseline",
  async (ctx) => {
    let stdout = "";
    try {
      ({ stdout } = await run("npm", ["audit", "--json"], { cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }));
    } catch (err) {
      // npm audit exits non-zero when it finds vulnerabilities but still prints the report on stdout.
      stdout = (err as { stdout?: string }).stdout ?? "";
    }
    let report: unknown;
    try {
      report = JSON.parse(stdout) as unknown;
    } catch {
      ctx.check(fail("npm audit did not print a JSON report (the advisory endpoint may be unreachable)"));
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as { advisories: string[] };
    ctx.check(noNewHighCritical(report, baseline));
  },
  { stack: false },
);
