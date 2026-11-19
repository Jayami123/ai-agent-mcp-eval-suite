import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Not a ledger case. Backs P4-GATE-002 ("does not call a second provider") and the "pure functions" rule:
// nothing in src/stats may reach the network, the environment, the disk or the clock.
const DIR = path.resolve(process.cwd(), "src/stats");
const FORBIDDEN: Array<[string, RegExp]> = [
  ["fetch(", /\bfetch\s*\(/],
  ["node:http", /node:https?\b/],
  ["node:net", /node:(net|tls|dgram|dns)\b/],
  ["node:fs", /node:fs\b/],
  ["node:child_process", /node:child_process\b/],
  ["process.env", /process\.env/],
  ["Date.now", /Date\.now\s*\(/],
  ["new Date()", /new Date\s*\(\s*\)/],
  ["Math.random", /Math\.random\s*\(/],
  ["harness import", /qa-portfolio-harness/],
  ["tests import", /from\s+["'](\.\.\/)+tests\//],
];

test("l5 no-network: src/stats has no network, env, disk, clock or random access", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(path.join(DIR, file), "utf8");
    for (const [label, re] of FORBIDDEN) assert.equal(re.test(text), false, `${file} uses ${label}`);
  }
});
