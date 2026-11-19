import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { GOLDEN_SET, L5_CASES, parseCaseId } from "../../src/stats/index.js";

// Not a ledger case. Master plan rule: every ID for this lane has a test, or a stated reason it is deferred.
const DIR = path.resolve(process.cwd(), "tests/l5");

test("l5 coverage: every L5 case id has a test whose name starts with the id", () => {
  const sources = readdirSync(DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => readFileSync(path.join(DIR, f), "utf8"));
  for (const c of L5_CASES) {
    const found = sources.some((s) => s.includes(`test("${c.id}:`));
    assert.ok(found, `${c.id} has no test named "${c.id}: ..." in tests/l5`);
  }
});

test("l5 coverage: the list has 15 ids, 14 core and 1 stretch, all well formed and unique", () => {
  assert.equal(L5_CASES.length, 15);
  assert.equal(L5_CASES.filter((c) => c.kind === "core").length, 14);
  assert.equal(new Set(L5_CASES.map((c) => c.id)).size, 15);
  for (const c of L5_CASES) assert.notEqual(parseCaseId(c.id), null, c.id);
});

test("l5 coverage: the golden set only holds well formed ids", () => {
  for (const id of GOLDEN_SET) assert.notEqual(parseCaseId(id), null, id);
});
