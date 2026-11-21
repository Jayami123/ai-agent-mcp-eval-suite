import { test } from "node:test";
import assert from "node:assert/strict";
import { pass, fail } from "../../../src/oracles/verdict.js";
import { chatWithApproval } from "../support/approval.js";
import { runtime } from "../support/runtime.js";
import { OWNER_FILE, PENPOT_EXECUTE, penpotValue, pausedNames, setPluginPath, toolOutputs } from "./support.js";

// Precheck, not a ledger case. It answers one question the plugin cases depend on: does a tool call made through LibreChat reach
// the owner's browser plugin? The harness's LibreChat entry for Penpot carries no per-user token (harness librechat-env.ts), so
// this is checked, not assumed. The reply is read by field (the plugin's result), and the approval pause must name the tool.
// Its result is recorded in docs/findings/l3-penpot-plugin.md. Runs first in plugin.e2e.ts.
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
  const verdict = reached && answered ? pass(`precheck: the approval gate saw ${PENPOT_EXECUTE} and the owner's plugin answered for ${OWNER_FILE}`) : fail(`precheck: reached the gate ${reached}, owner's plugin answered ${answered}, replies recorded ${outputs.length}`);
  setPluginPath(verdict.outcome === "pass");
  assert.equal(verdict.outcome, "pass", verdict.detail);
});
