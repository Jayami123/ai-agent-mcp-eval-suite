import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { resetStubTrace } from "../../l1/stub-recorder.js";
import { editDistance, freshList, labPin, resetLab } from "../support/lab.js";
import { runFixture } from "../support/run-fixture.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-SUPP-004: a server whose name is one character off the pinned name (the attack-lab started with
// LAB_SERVER_NAME set to a one-character typo, by lab-typo.e2e.ts). The verdict has two parts. (a) The identity check flags
// the served name as one edit from the pin. (b) The host makes no call to a typo-named server. Part (b) is a config-level check,
// not a runtime defence: the LibreChat config names only the real `lab` product, so no typo server is connected; the check records
// the calls the host made, which is the evidence.

l3Case("P4-MCP-SUPP-004", "a typo-squat server name is flagged; a config-level check finds no call to it", async (ctx) => {
  const rt = runtime();
  const pin = labPin();
  await resetLab();
  try {
    const served = await freshList();
    const distance = editDistance(served.serverName, pin.serverName);
    ctx.check(served.serverName !== pin.serverName && distance === 1
      ? pass(`served name ${served.serverName} is one edit from the pin ${pin.serverName}`)
      : fail(`served name ${served.serverName} is ${distance} edit(s) from the pin ${pin.serverName}`));
    await resetStubTrace();
    const run = await runFixture(rt.stack, { fixture: "p4-mcp-supp-004", prompt: "Echo the text.", tools: [mcpToolName("lab_echo", "lab")] });
    const typo = run.calls.filter((c) => !c.tool.startsWith("lab_echo"));
    ctx.check(run.calls.length >= 1 && typo.length === 0 ? pass(`${run.calls.length} host call(s), none to a typo-named server`) : fail(`unexpected host calls: ${typo.map((c) => c.tool).join(", ") || "none ran"}`));
  } finally {
    await resetLab();
  }
});
