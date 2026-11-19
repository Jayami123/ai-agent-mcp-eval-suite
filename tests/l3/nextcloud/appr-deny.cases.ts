import type { NextcloudOracle } from "../../../src/oracles/nextcloud.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { l3Case } from "../support/case.js";
import { chatWithApproval } from "../support/approval.js";
import { runtime } from "../support/runtime.js";
import { seedNc0 } from "../support/seed/nextcloud.js";

// P4-MCP-APPR-001. The policy names the write tool as both allowed and denied (LibreChat: deny wins over every other list).
// The write must never run and the owner's files must not change. Set up by appr-deny.e2e.ts.
l3Case("P4-MCP-APPR-001", "deny always wins over allow", async (ctx) => {
  const rt = runtime();
  const oracle = rt.oracle("nextcloud") as NextcloudOracle;
  await seedNc0(await oracle.davSession());
  const before = await oracle.snapshot();
  await resetStubTrace();
  const run = await chatWithApproval(rt.stack, {
    fixture: "p4-mcp-appr-001",
    prompt: "Write the note.",
    tools: [mcpToolName("nc_webdav_write_file", "nextcloud")],
    decide: () => "reject",
  });
  const stub = await readStubTrace("p4-mcp-appr-001");
  ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
  ctx.check(run.pauses.length === 0 ? pass("no approval prompt for the denied tool") : fail(`${run.pauses.length} approval prompt(s) for a tool the policy denies`));
  ctx.check(run.finished ? pass("the turn finished") : fail("the turn did not finish"));
  ctx.check(unchanged(before, await oracle.snapshot()));
});
