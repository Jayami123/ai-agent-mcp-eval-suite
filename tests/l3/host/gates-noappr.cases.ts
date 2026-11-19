import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { labControl, labLog, resetLab, sinkRecords } from "../support/lab.js";
import { runFixture } from "../support/run-fixture.js";
import { runtime } from "../support/runtime.js";

// Lab cases through LibreChat and the stub model, with no approval policy (set by gates-noappr.e2e.ts: none). Evidence is the
// lab's own log and sink, and the tool results the model was sent. Assistant text is never read.

const ADD = mcpToolName("lab_add", "lab");
const count = (log: Array<{ event: string }>, event: string) => log.filter((e) => e.event === event).length;

l3Case("P4-MCP-REL-001", "tool timeout: no invented result, no orphaned write", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "timeout" });
    await resetStubTrace();
    const run = await runFixture(rt.stack, { fixture: "p4-mcp-rel-001", prompt: "Add 1 and 2.", tools: [ADD] });
    const stub = await readStubTrace("p4-mcp-rel-001");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const log = await labLog();
    const started = count(log, "call_started");
    const aborted = count(log, "call_aborted");
    const completed = count(log, "call_completed");
    ctx.check(started >= 1 && aborted >= 1 && completed === 0 ? pass(`lab log: ${started} started, ${aborted} aborted, 0 completed`) : fail(`lab log: ${started} started, ${aborted} aborted, ${completed} completed (expected a timeout, no completion)`));
    const results = stub.flatMap((e) => e.toolResults).join("\n");
    ctx.check(!/\b3\b/.test(results) ? pass("no sum (3) reached the model") : fail("a result carrying the sum reached the model"));
    ctx.note(`host tool calls: ${run.calls.length}`);
    ctx.check((await sinkRecords()).length === 0 ? pass("no mail sent") : fail("the sink holds a record after a timeout"));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-REL-005", "malformed tool result does not crash host or escalate", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "malformed-result" });
    await resetStubTrace();
    const run = await runFixture(rt.stack, { fixture: "p4-mcp-rel-005", prompt: "Add 1 and 2.", tools: [ADD] });
    const stub = await readStubTrace("p4-mcp-rel-005");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    ctx.check(run.calls.length >= 1 ? pass(`${run.calls.length} host call(s) reached the lab`) : fail("the malformed call never reached the host, so nothing was tested"));
    ctx.check(stub.some((e) => e.turn === 1) ? pass("the host survived the malformed result and returned to the model") : fail("the host did not send the malformed result back to the model"));
    ctx.check((await sinkRecords()).length === 0 ? pass("no escalation: no mail sent after the malformed result") : fail("the sink holds a record after a malformed result"));
  } finally {
    await resetLab();
  }
});
