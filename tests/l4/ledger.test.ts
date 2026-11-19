import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { L4_IDS, caseFile } from "./support/ledger-ids.js";
import { loadFixture } from "../../src/stub/fixtures.js";

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("L4 ledger: 62 IDs, 48 core, 14 stretch", () => {
  assert.equal(L4_IDS.length, 62);
  assert.equal(L4_IDS.filter((c) => c.kind === "core").length, 48);
  assert.equal(L4_IDS.filter((c) => c.kind === "stretch").length, 14);
  assert.equal(new Set(L4_IDS.map((c) => c.id)).size, 62, "IDs are unique");
});

test("L4 ledger: every ID has exactly one test file and the file declares that ID and kind", () => {
  for (const c of L4_IDS) {
    const rel = caseFile(c);
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
    const src = read(rel);
    assert.equal((src.match(/l4Case\(/g) ?? []).length, 1, `${rel} must declare exactly one case`);
    assert.ok(src.includes(`id: "${c.id}"`), `${rel} does not declare ${c.id}`);
    assert.ok(src.includes(`kind: "${c.kind}"`), `${rel} declares the wrong kind for ${c.id}`);
  }
});

test("L4 ledger: no case file exists outside the list", () => {
  const known = new Set(L4_IDS.map(caseFile));
  const dirs = fs.readdirSync(path.join(ROOT, "tests/l4"), { withFileTypes: true }).filter((d) => d.isDirectory() && !["support", "stub", "mock-channel", "oracles"].includes(d.name));
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(ROOT, "tests/l4", d.name))) {
      assert.ok(known.has(`tests/l4/${d.name}/${f}`), `unexpected file tests/l4/${d.name}/${f}`);
    }
  }
});

test("L4 ledger: every oc-* fixture is used by a case file and every fixture a case names exists", () => {
  const fixtureDir = path.join(ROOT, "src/stub/fixtures");
  const files = L4_IDS.map((c) => read(caseFile(c)));
  const used = new Set<string>();
  for (const src of files) for (const m of src.matchAll(/fixture: "([a-z0-9-]+)"/g)) used.add(m[1] ?? "");
  for (const f of fs.readdirSync(fixtureDir)) {
    if (!f.startsWith("oc-") || f.startsWith("oc-stub-")) continue;
    const id = f.replace(/\.json$/, "");
    assert.ok(used.has(id), `fixture ${id} is not used by any L4 case`);
  }
  for (const id of used) assert.doesNotThrow(() => loadFixture(fixtureDir, id), `fixture ${id} does not load`);
});

test("L4 ledger: stub fixtures named oc-* are valid and carry fake data only", () => {
  const fixtureDir = path.join(ROOT, "src/stub/fixtures");
  for (const f of fs.readdirSync(fixtureDir).filter((n) => n.startsWith("oc-"))) {
    const text = fs.readFileSync(path.join(fixtureDir, f), "utf8");
    assert.doesNotThrow(() => loadFixture(fixtureDir, f.replace(/\.json$/, "")));
    assert.ok(!/AIza|sk-[A-Za-z0-9]{10}|Bearer /.test(text), `${f} looks like it holds a secret`);
  }
});
