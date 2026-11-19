import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry } from "./support/registry.js";

// The L3 registry must match the master plan: 102 IDs, 90 core and 12 stretch, per family as in Appendix A.
// P4-MCP-REL-006 and P4-MCP-REL-008 belong to L5 and must not be here.
const FAMILY = { PROT: [12, 0], OAUTH: [14, 1], TOOL: [8, 1], META: [12, 1], INJ: [14, 3], FLOW: [10, 2], APPR: [8, 1], SUPP: [6, 1], REL: [6, 2] } as const;

test("registry has 102 unique L3 case IDs: 90 core and 12 stretch", () => {
  const all = loadRegistry();
  assert.equal(all.length, 102);
  assert.equal(new Set(all.map((c) => c.id)).size, 102);
  assert.equal(all.filter((c) => c.kind === "core").length, 90);
  assert.equal(all.filter((c) => c.kind === "stretch").length, 12);
});

test("per-family counts match the master plan", () => {
  const all = loadRegistry();
  for (const [fam, [core, stretch]] of Object.entries(FAMILY)) {
    const rows = all.filter((c) => c.id.startsWith(`P4-MCP-${fam}-`));
    assert.equal(rows.filter((c) => c.kind === "core").length, core, `${fam} core`);
    assert.equal(rows.filter((c) => c.kind === "stretch").length, stretch, `${fam} stretch`);
  }
});

test("L5 IDs are not in L3", () => {
  const ids = new Set(loadRegistry().map((c) => c.id));
  assert.equal(ids.has("P4-MCP-REL-006"), false);
  assert.equal(ids.has("P4-MCP-REL-008"), false);
});

test("every case lands in exactly one PR from 1 to 11, except the one deferred case", () => {
  const all = loadRegistry();
  assert.deepEqual(all.filter((c) => c.pr === 0).map((c) => c.id), ["P4-MCP-OAUTH-014"]);
  for (const c of all.filter((x) => x.pr !== 0)) assert.ok(c.pr >= 1 && c.pr <= 11, `${c.id} pr ${c.pr}`);
});

// Every case whose PR has landed must have a test that names it (a l3Case call with the ID). Append the PR number when it lands.
const LANDED_PRS = [1];

test("every landed case has an l3Case test", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
  const text = walk(path.resolve(process.cwd(), "tests", "l3")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const missing = loadRegistry().filter((c) => LANDED_PRS.includes(c.pr) && !new RegExp(`l3Case\\(\\s*"${c.id}"`).test(text)).map((c) => c.id);
  assert.deepEqual(missing, []);
});
