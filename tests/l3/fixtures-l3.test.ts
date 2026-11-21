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
const LANDED_PRS: number[] = [1, 2];
// Cases built outside a whole PR (wave B, the approval gates on Nextcloud). Each is named here as it lands.
const BUILT_IDS = [
  // Approval wave B (PR 1, Twenty).
  "P4-MCP-INJ-005", "P4-MCP-INJ-006", "P4-MCP-TOOL-006", "P4-MCP-TOOL-009",
  // Approval wave B (PR 1, Mattermost and Outline with Twenty).
  "P4-MCP-FLOW-001", "P4-MCP-FLOW-010", "P4-MCP-FLOW-004",
  "P4-MCP-SUPP-006",
  "P4-MCP-FLOW-007",
  "P4-MCP-APPR-001", "P4-MCP-APPR-006", "P4-MCP-REL-001", "P4-MCP-REL-005", "P4-MCP-META-001", "P4-MCP-SUPP-003",
  "P4-MCP-APPR-007", "P4-MCP-META-010", "P4-MCP-META-006", "P4-MCP-SUPP-004", "P4-MCP-META-005", "P4-MCP-META-007", "P4-MCP-SUPP-007", "P4-MCP-REL-009",
  // Wave D (mail and UI cases, harness v0.6.8).
  "P4-MCP-APPR-003", "P4-MCP-META-003", "P4-MCP-APPR-004", "P4-MCP-APPR-005", "P4-MCP-META-012",
  "P4-MCP-META-002", "P4-MCP-META-004", "P4-MCP-META-008", "P4-MCP-META-011",
  "P4-MCP-APPR-002", "P4-MCP-META-013",
  // Host design (PR 2 of wave B): MCP Apps approval, cancel, retry cap (lab app-tool, slow-task and always-fail modes).
  "P4-MCP-APPR-008", "P4-MCP-REL-003", "P4-MCP-REL-004",
  // Second identity (PR 3 of wave B): USR2 cases; the Twenty ones are skips or blockers with reasons.
  "P4-MCP-INJ-012", "P4-MCP-REL-002", "P4-MCP-FLOW-005", "P4-MCP-INJ-016", "P4-MCP-FLOW-012", "P4-MCP-REL-010",
  "P4-MCP-OAUTH-012", "P4-MCP-OAUTH-013", "P4-MCP-INJ-004", "P4-MCP-INJ-017",
  "P4-MCP-INJ-009", "P4-MCP-INJ-010", "P4-MCP-INJ-013",
];
// Tools that exist only in a lab mode (after a trigger), so the benign snapshot cannot name them. Each is listed with its mode.
// lab_new_tool: add-tool-after-connect, after the trigger. lab_connect_account: the two elicitation modes. nc_mail_send_message
// on the lab: the shadow-name mode lists lab_mail_send under the real Nextcloud name.
const MODE_ONLY_TOOLS = new Set(["lab_new_tool", "lab_connect_account", "nc_mail_send_message", "lab_app_view", "lab_slow_task"]);
const turnsCalls = (fx: { turns: Array<{ tool_calls?: Array<{ name: string; arguments: unknown }> }> }) => fx.turns.flatMap((t) => t.tool_calls ?? []);
const landed = () => loadRegistry().filter((c) => LANDED_PRS.includes(c.pr) || BUILT_IDS.includes(c.id));

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
        // execute_tool is a write door on Twenty, except for its read calls (inner tool find_*): a control may read through it.
        const writeDoor = (n: string): boolean => /mail_send|execute_tool|execute_code|post_message|documents_(import|create|move)|share_create/.test(n);
        const doorWrites = turnsCalls(fx).filter((c) => c.name === "execute_tool_mcp_twenty" && !String((c.arguments as { toolName?: unknown }).toolName ?? "").startsWith("find_"));
        assert.deepEqual(names.filter((n) => writeDoor(n) && !(n === "execute_tool_mcp_twenty")), [], `${id}: control fixture calls a destructive role`);
        assert.deepEqual(doorWrites, [], `${id}: control fixture asks execute_tool for a write`);
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

test("every tool a landed fixture calls exists in the committed snapshot of its server", () => {
  for (const def of landed()) {
    for (const id of def.fixtures) {
      for (const turn of loadFixture(DIR, id).turns) {
        for (const call of turn.tool_calls ?? []) {
          const m = /^(.+)_mcp_(twenty|outline|nextcloud|penpot|mattermost|lab2?)$/.exec(call.name);
          assert.ok(m, `${id}: ${call.name} does not end in _mcp_<server>`);
          // lab2 is a second container of the same image, so it serves the lab's committed tool snapshot.
          const snapFile = m[2] === "lab2" ? "lab" : m[2];
          const snap = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "tests/l3/snapshots", `${snapFile}.tools.json`), "utf8")) as { tools: Array<{ name: string }> };
          assert.ok(MODE_ONLY_TOOLS.has(m[1] ?? "") || snap.tools.some((t) => t.name === m[1]), `${id}: ${m[1] ?? ""} is not in ${m[2]}.tools.json`);
        }
      }
    }
  }
});
