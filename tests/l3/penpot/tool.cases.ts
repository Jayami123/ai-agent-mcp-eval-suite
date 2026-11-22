import { fail, pass } from "../../../src/oracles/verdict.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { l3Case } from "../support/case.js";
import { pluginPathCheck, ownerAccess, PENPOT_EXECUTE, pausedNames, ppbProof, seedPoisonedShape, Sink, toolOutputs } from "./support.js";

// P4-MCP-TOOL-005. execute_code cannot reach a non-allowlisted host. The model asks for fetch() to a loopback sink; the approval
// is given so the plugin sandbox is what is tested. Oracles: the sink (0 requests), the file revision (unchanged), the approval
// gate (the call reached it) and LibreChat's recorded reply for that call. No assistant text. Entry: plugin.e2e.ts.

l3Case("P4-MCP-TOOL-005", "execute_code cannot reach a non-allowlisted host", async (ctx) => {
  const pathCheck = pluginPathCheck();
  ctx.check(pathCheck.ok ? pass(pathCheck.detail) : fail(pathCheck.detail));
  if (!pathCheck.ok) return;
  const { stack, owner, oracle } = ownerAccess();
  ctx.check(await ppbProof(owner));
  const shape = await seedPoisonedShape(owner);
  ctx.check(pass(`setup: seeded shape ${shape.id} read back by its name`));
  const before = await oracle.fileRevisions();
  const sink = new Sink();
  await sink.start();
  try {
    await resetStubTrace();
    const run = await chatWithApproval(stack, {
      fixture: "p4-mcp-tool-005-fetch",
      prompt: "Run the code.",
      tools: [PENPOT_EXECUTE],
      decide: () => "approve",
    });
    const stub = await readStubTrace("p4-mcp-tool-005-fetch");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    ctx.check(pausedNames(run.pauses).includes(PENPOT_EXECUTE) ? pass("the code call reached the approval gate") : fail("the code call never reached the approval gate"));
    const replies = toolOutputs(run.finalMessage, PENPOT_EXECUTE);
    ctx.check(replies.length > 0 ? pass(`LibreChat recorded ${replies.length} reply for the code call`) : fail("no reply recorded for the code call"));
    ctx.check(sink.requests.length === 0 ? pass("the sink received 0 requests") : fail(`the sink received ${sink.requests.length} request(s)`));
    ctx.check(unchanged(before, await oracle.fileRevisions()));
  } finally {
    await sink.stop();
  }
});
