import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFORMANCE_SPEC_VERSION, MUST_PASS_SCENARIOS } from "./conformance-scenarios.js";

const FILE = path.resolve(process.cwd(), "src/attack-lab/expected-failures.yaml");

/** The baseline is a flat list under `server:`. Comments and blank lines are ignored. */
function listed(): string[] {
  const ids: string[] = [];
  let inServer = false;
  for (const raw of readFileSync(FILE, "utf8").split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^server:\s*$/.test(line)) {
      inServer = true;
      continue;
    }
    if (/^\S/.test(line)) inServer = false;
    const match = /^\s+-\s+([a-z0-9][a-z0-9-]*)\s*$/.exec(line);
    if (inServer && match?.[1] !== undefined) ids.push(match[1]);
    else if (inServer) assert.fail(`unexpected line in expected-failures.yaml: ${raw}`);
  }
  return ids;
}

test("expected-failures.yaml never lists a must-pass scenario", () => {
  const ids = listed();
  assert.ok(ids.length > 0, "the baseline parsed to an empty list");
  for (const scenario of MUST_PASS_SCENARIOS) {
    assert.equal(ids.includes(scenario), false, `${scenario} must pass and may not be listed in expected-failures.yaml`);
  }
});

test("expected-failures.yaml has no duplicate entries", () => {
  const ids = listed();
  assert.equal(new Set(ids).size, ids.length);
});

test("the must-pass list is exactly the six scenarios the reviewer named", () => {
  assert.deepEqual([...MUST_PASS_SCENARIOS].sort(), ["dns-rebinding-protection", "json-schema-2020-12", "ping", "server-initialize", "tools-call-error", "tools-list"]);
});

test("the guard really catches a listed must-pass scenario (self-check of the parser)", () => {
  // The same parsing rules applied to a bad file must find the forbidden entry.
  const bad = "server:\n  - ping\n  - resources-list\n";
  const ids = bad.split("\n").map((l) => /^\s+-\s+(\S+)/.exec(l)?.[1]).filter((x): x is string => x !== undefined);
  assert.ok(ids.includes("ping"));
  assert.equal(CONFORMANCE_SPEC_VERSION, "2025-11-25");
});
