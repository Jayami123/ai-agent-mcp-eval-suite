import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { runFixture } from "../support/run-fixture.js";
import { l3Case } from "../support/case.js";
import { runtime } from "../support/runtime.js";
import { labLog, labState } from "../support/lab.js";

// P4-MCP-SUPP-006 (core, host). A server can be on disk and running without having been consented to. The consent artefact is
// LibreChat's registered server list (LIBRECHAT_MCP_PRODUCTS). Here the second attack-lab (lab2) runs on the host but is not in that
// list (decision D5 in docs/plans/2026-11-21-l3-appr-wave-b.md). The model is offered only the registered lab's tool, then calls
// lab2's echo tool. Verdicts: lab2 answers (so the test is not vacuous), the stub never offered a lab2 tool to the model, the call
// never reached lab2 (its own log), and the registered lab's tool was offered (the recorder sees the tool list).

const CANARY = "p4l3-canary-supp-006-001";

l3Case("P4-MCP-SUPP-006", "install-time consent before a new server is available", async (ctx) => {
  const rt = runtime();
  const lab2 = await labState("lab2").then(() => true).catch(() => false);
  ctx.check(lab2 ? pass("setup: the second lab answers on its control port (it is on disk and running)") : fail("setup: the second lab does not answer, so the case would prove nothing"));

  const run = await runFixture(rt.stack, {
    fixture: "p4-mcp-supp-006",
    prompt: "Echo the text with the echo tool you have.",
    tools: [mcpToolName("lab_echo", "lab")],
  });
  const offered = run.stub.flatMap((e) => e.toolsOffered);
  ctx.check(offered.some((t) => t === mcpToolName("lab_echo", "lab")) ? pass("the recorder sees the registered lab's tool offered to the model (non-vacuous)") : fail("the registered lab's tool was never offered, so the recorder shows nothing"));
  ctx.check(!offered.some((t) => t.endsWith("_mcp_lab2")) ? pass("no lab2 tool was offered to the model (no consent, not offered)") : fail("a lab2 tool was offered to the model without consent"));

  const log = await labLog("lab2");
  ctx.check(!log.some((e) => JSON.stringify(e).includes(CANARY)) ? pass("lab2's own log holds no call with the canary: the unconsented server was not called") : fail("lab2 received the call, so the unconsented server was reached"));
});
