import { test } from "node:test";
import assert from "node:assert/strict";
import { pass, fail } from "../../../src/oracles/verdict.js";
import { chatWithApproval } from "../support/approval.js";
import { runtime } from "../support/runtime.js";
import { OWNER_FILE, PENPOT_EXECUTE, penpotValue, pausedNames, setPluginPath, toolOutputs } from "./support.js";

// Precheck, not a ledger case. It answers one question the plugin cases depend on: does a tool call made through LibreChat reach
// the owner's browser plugin? With P4_PENPOT_PLUGIN=1 the harness (qa-portfolio-harness v0.6.12, tag 477a360) gives LibreChat's
// Penpot entry the owner's per-user token, so this is a plain assertion. The reply is read by field (the plugin's result), and the
// approval pause must name the tool. Its result is recorded in docs/findings/l3-penpot-plugin.md. Runs first in plugin.e2e.ts.
const SKIP = process.env["P4_STACK_TESTS"] === "1" ? false : "requires P4_STACK_TESTS=1 (L3 stack job)";

test("penpot plugin precheck: a LibreChat call reaches the owner's plugin (not a ledger case)", { skip: SKIP }, async () => {
  const rt = runtime();
  const run = await chatWithApproval(rt.stack, {
    fixture: "penpot-ppb-probe",
    prompt: "Read the open file's name.",
    tools: [PENPOT_EXECUTE],
    decide: () => "approve",
  });
  const names = pausedNames(run.pauses);
  const outputs = toolOutputs(run.finalMessage, PENPOT_EXECUTE);
  const value = outputs.length > 0 ? penpotValue(outputs[0] ?? "") : undefined;
  const reached = names.includes(PENPOT_EXECUTE);
  const answered = value === OWNER_FILE;
  // The verdict line names the checks, never the reply text.
  const kind = value === undefined ? "no reply" : typeof value;
  const observed = reached && answered ? pass(`precheck: the approval gate saw ${PENPOT_EXECUTE} and the owner's plugin answered for ${OWNER_FILE}`) : fail(`precheck: reached the gate ${reached}, owner's plugin answered ${answered}, replies recorded ${outputs.length}, reply type ${kind}`);
  setPluginPath(observed.outcome === "pass");
  assert.equal(observed.outcome, "pass", observed.detail);
});
