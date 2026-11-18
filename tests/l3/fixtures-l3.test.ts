import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FIXTURE_ID_PATTERN, loadFixture } from "../../src/stub/fixtures.js";
import { loadRegistry } from "./support/registry.js";
import { twentyInnerNames } from "./support/tool-map.js";

// Runs in the plain PR gate (no stack, no secrets). Every fixture the registry names must exist and be valid, and no
// L3 fixture may exist that the registry does not name (an orphan is a case ID nobody approved).
const DIR = path.resolve(process.cwd(), "src/stub/fixtures");
// PRs whose fixtures must exist so far. Each L3 PR appends its number (a case in a later PR has no fixture yet).
const LANDED_PRS: number[] = []; // PR 1's three fixtures land in the follow-up push with the S2 snapshots; then this becomes [1]
const landed = () => loadRegistry().filter((c) => LANDED_PRS.includes(c.pr));

test("every L3 fixture named in the registry exists, validates and has a legal id", () => {
  for (const def of landed()) {
    for (const id of def.fixtures) {
      assert.match(id, FIXTURE_ID_PATTERN, `${def.id}: fixture id ${id}`);
      const fx = loadFixture(DIR, id);
      assert.equal(fx.id, id);
    }
  }
});

test("no orphan p4-mcp-* fixture files", () => {
  const named = new Set(landed().flatMap((c) => c.fixtures));
  const onDisk = fs.readdirSync(DIR).filter((f) => f.startsWith("p4-mcp-") && f.endsWith(".json")).map((f) => f.slice(0, -5));
  assert.deepEqual(onDisk.filter((id) => !named.has(id)), []);
});

test("a -control fixture never calls a destructive role; a -hostile fixture ends with a text turn", () => {
  for (const def of landed()) {
    for (const id of def.fixtures) {
      const fx = loadFixture(DIR, id);
      if (id.endsWith("-control")) {
        const names = fx.turns.flatMap((t) => (t.tool_calls ?? []).map((c) => c.name));
        assert.deepEqual(names.filter((n) => /mail_send|execute_tool|execute_code|post_message|documents_(import|create|move)|share_create/.test(n)), [], `${id}: control fixture calls a destructive role`);
      }
      if (id.endsWith("-hostile")) assert.ok(fx.turns[fx.turns.length - 1]?.content !== undefined, `${id}: last turn must be text`);
    }
  }
});

test("a Twenty execute_tool call names an inner tool that exists in the captured catalog", () => {
  if (!fs.existsSync(path.resolve(process.cwd(), "tests/l3/snapshots/twenty.catalog.json"))) return; // lands with the S2 snapshots
  const known = new Set(twentyInnerNames());
  for (const def of landed()) {
    for (const id of def.fixtures) {
      for (const turn of loadFixture(DIR, id).turns) {
        for (const call of turn.tool_calls ?? []) {
          if (call.name !== "execute_tool_mcp_twenty") continue;
          const inner = (call.arguments as { toolName?: unknown }).toolName;
          assert.ok(typeof inner === "string" && known.has(inner), `${id}: execute_tool names an inner tool not in twenty.catalog.json`);
        }
      }
    }
  }
});
