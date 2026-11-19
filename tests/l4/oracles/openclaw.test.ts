import { test } from "node:test";
import assert from "node:assert/strict";
import { assertWorkspaceRel, diffSnapshots, parseSha256sum, toPendingApprovals, type OcSnapshot } from "../../../src/oracles/openclaw.js";

const H = (c: string): string => c.repeat(64);
const snap = (files: Record<string, string>, approvals = "a", config = "c"): OcSnapshot => ({
  files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { path: k, sha256: v, bytes: 1 }])),
  approvalsSha256: approvals,
  configSha256: config,
  pendingIds: [],
});

test("oracles: diff reports added, removed and changed files", () => {
  const d = diffSnapshots(snap({ "p4/a": H("1"), "p4/b": H("2"), "p4/c": H("3") }), snap({ "p4/a": H("1"), "p4/b": H("9"), "p4/d": H("4") }));
  assert.deepEqual(d, { added: ["p4/d"], removed: ["p4/c"], changed: ["p4/b"], approvalsChanged: false, configChanged: false });
});

test("oracles: diff flags an approvals or config change and nothing else", () => {
  const d = diffSnapshots(snap({ "p4/a": H("1") }), snap({ "p4/a": H("1") }, "a2", "c2"));
  assert.deepEqual({ ...d, added: [], removed: [], changed: [] }, { added: [], removed: [], changed: [], approvalsChanged: true, configChanged: true });
  assert.deepEqual([d.added, d.removed, d.changed], [[], [], []]);
});

test("oracles: parseSha256sum keeps workspace files and drops OpenClaw's own and hidden files", () => {
  const out = [`${H("a")} 12 ./p4/keep.txt`, `${H("b")} 5 ./AGENTS.md`, `${H("c")} 7 ./.hidden`, `${H("d")} 3 ./memory/n.md`, "garbage line"].join("\n");
  assert.deepEqual(Object.keys(parseSha256sum(out)).sort(), ["memory/n.md", "p4/keep.txt"]);
  assert.equal(parseSha256sum(out)["p4/keep.txt"]?.bytes, 12);
});

test("oracles: a workspace path must be relative and must not climb out", () => {
  for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "./a", "a\0b"]) assert.throws(() => assertWorkspaceRel(bad), /OC_PATH_INVALID/, bad);
  assert.equal(assertWorkspaceRel("p4/a.txt"), "p4/a.txt");
});

test("oracles: pending approvals are read into the fields the cases use", () => {
  assert.deepEqual(toPendingApprovals([{ id: "x1", kind: "exec", sessionKey: "agent:main:main", summary: "rm a", createdAtMs: 1 }]), [{ id: "x1", kind: "exec", sessionKey: "agent:main:main", summary: "rm a" }]);
  assert.deepEqual(toPendingApprovals([{}]), [{ id: "", kind: "", sessionKey: "", summary: "" }]);
});
