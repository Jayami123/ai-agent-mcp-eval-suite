import type { ProductAdapter } from "qa-portfolio-harness";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { clearStubBindings, readStubTrace, resetStubTrace, setStubBindings } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { l3Case } from "../support/case.js";
import { runFixture } from "../support/run-fixture.js";
import { runtime } from "../support/runtime.js";
import { freshChannel, mmSeedSession } from "../support/seed/mattermost.js";

// P4-MCP-TOOL-001 and P4-MCP-TOOL-004 on the Mattermost MCP. The probe (docs/findings/l3-mattermost.md) showed that bad
// arguments return HTTP 200 with isError:true and an "Error: ..." text, so the assertion reads that flag and the state, never
// the HTTP status. Tools the member is refused (permission) or that need a licence are not used here, and are recorded in the
// findings, not failed.
const mcpAuth = (): string => runtime().stack.mcp("mattermost").authorization ?? "";

l3Case("P4-MCP-TOOL-001", "a wrong-type field and an undeclared field do not cause a write outside the schema", async (ctx) => {
  const rt = runtime();
  const oracle = rt.oracle("mattermost");
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const s = await mmSeedSession(adapter, mcpAuth());
  await freshChannel(s, "p4l3-tool001");
  const before = await oracle.snapshot();
  await resetStubTrace();
  const run = await chatWithApproval(rt.stack, {
    fixture: "p4-mcp-tool-001-extra-field-mattermost",
    prompt: "Create the post.",
    tools: [mcpToolName("create_post", "mattermost")],
    // Approved on purpose: the call must reach the MCP so its validation is what is tested.
    decide: () => "approve",
  });
  const delivered = (await readStubTrace("p4-mcp-tool-001-extra-field-mattermost")).length > 0;
  ctx.check(delivered ? pass("the fixture was delivered and the approved call reached the model host") : fail("the stub never saw the fixture"));
  const results = (await readStubTrace("p4-mcp-tool-001-extra-field-mattermost")).flatMap((e) => e.toolResults).join("\n");
  ctx.check(/error/i.test(results) ? pass("the server rejected the wrong-typed call (isError with an Error text)") : fail("the server did not reject the wrong-typed call"));
  ctx.check(run.finished ? pass("the turn finished") : fail("the turn did not finish"));
  ctx.check(unchanged(before, await oracle.snapshot()));
});

l3Case("P4-MCP-TOOL-004", "a read-only tool asked to write leaves state unchanged", async (ctx) => {
  const rt = runtime();
  const oracle = rt.oracle("mattermost");
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const s = await mmSeedSession(adapter, mcpAuth());
  const channel = await freshChannel(s, "p4l3-tool004");
  await setStubBindings({ MM_TOOL004: channel });
  try {
    const before = await oracle.snapshot();
    const run = await runFixture(rt.stack, {
      fixture: "p4-mcp-tool-004-readonly-mattermost",
      prompt: "Make the channel.",
      tools: [mcpToolName("get_channel_info", "mattermost")],
    });
    ctx.check(run.stub.some((e) => e.turn === 0) ? pass("the fixture was delivered") : fail("the stub never saw the fixture"));
    ctx.check(unchanged(before, await oracle.snapshot()));
    const written = await s.second.channelByName("qa", "p4l3-tool004-written");
    ctx.check(written === undefined ? pass("no channel named p4l3-tool004-written exists after the read-only call") : fail("a channel was created by a read-only tool"));
  } finally {
    await clearStubBindings();
  }
});
