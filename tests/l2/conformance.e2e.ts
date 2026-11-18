import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configFromEnv } from "../../src/attack-lab/modes.js";
import { createLab } from "../../src/attack-lab/server.js";
import { CONFORMANCE_SPEC_VERSION, MUST_PASS_SCENARIOS } from "./conformance-scenarios.js";

// Points the official conformance suite at the benign lab. Needs no model, no secret and no network beyond localhost.
// Guarded: run it with `npm run test:lab:conformance` (P4_LAB_CONFORMANCE=1).
const ENABLED = process.env["P4_LAB_CONFORMANCE"] === "1";
const BIN = path.resolve(process.cwd(), "node_modules/.bin/conformance");
const BASELINE = path.resolve(process.cwd(), "src/attack-lab/expected-failures.yaml");

// Async on purpose: the lab runs in this process, so a blocking spawn would stop it from answering the tool.
function conformance(args: string[]): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, ["server", "--spec-version", CONFORMANCE_SPEC_VERSION, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
}

/** Checks of one scenario from the tool's output folder: results/server-<scenario>-<timestamp>/checks.json. */
function checksOf(dir: string, scenario: string): Array<{ id: string; status: string }> {
  const folder = readdirSync(dir).find((name) => name.startsWith(`server-${scenario}-`));
  assert.ok(folder !== undefined, `no result folder for ${scenario}`);
  return JSON.parse(readFileSync(path.join(dir, folder, "checks.json"), "utf8")) as Array<{ id: string; status: string }>;
}

test(
  "conformance: the benign lab passes the active suite against the baseline, and the six must-pass scenarios pass",
  { skip: ENABLED ? false : "requires P4_LAB_CONFORMANCE=1 (npm run test:lab:conformance)", timeout: 10 * 60_000 },
  async (t) => {
    const lab = await createLab({ config: configFromEnv({}), controlToken: "conformance-test-token-0000" });
    t.after(() => lab.close());
    const out = mkdtempSync(path.join(tmpdir(), "lab-conformance-"));

    // 1. The active suite, with the baseline. Exit 0 means: no unexpected failure and no stale baseline entry.
    const active = await conformance(["--url", lab.mcpUrl, "--expected-failures", BASELINE, "-o", out]);
    console.log(active.output.split("=== SUMMARY ===")[1] ?? active.output.slice(-2000));
    assert.equal(active.status, 0, "the active conformance suite did not exit 0");

    // 2. json-schema-2020-12 is outside the active suite, so run it by name.
    const schema = await conformance(["--url", lab.mcpUrl, "--scenario", "json-schema-2020-12", "-o", out]);
    assert.equal(schema.status, 0, "json-schema-2020-12 did not exit 0");

    // 3. Read the checks: every must-pass scenario has real checks and none failed.
    for (const scenario of MUST_PASS_SCENARIOS) {
      const checks = checksOf(out, scenario).filter((check) => check.status !== "INFO");
      assert.ok(checks.length > 0, `${scenario} produced no checks`);
      for (const check of checks) assert.equal(check.status, "SUCCESS", `${scenario}: ${check.id} is ${check.status}`);
    }
  },
);
