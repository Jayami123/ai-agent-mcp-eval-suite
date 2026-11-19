import type { NextcloudOracle } from "../../../src/oracles/nextcloud.js";
import { unchanged, type Snapshot } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { l3Case } from "../support/case.js";
import { chatWithApproval } from "../support/approval.js";
import { runtime } from "../support/runtime.js";
import { seedNc0 } from "../support/seed/nextcloud.js";

// P4-MCP-APPR-006. An approval given in conversation 1 must not carry into conversation 2: conversation 2 asks again, and it
// does nothing unless approved there. Set up by appr-ask.e2e.ts (policy: the write tool needs approval).
const changed = (before: Snapshot, after: Snapshot) =>
  before.digest !== after.digest ? pass("the approved write changed the owner's files") : fail("the approved write did not change the owner's files");

l3Case("P4-MCP-APPR-006", "approval does not outlive its conversation", async (ctx) => {
  const rt = runtime();
  const oracle = rt.oracle("nextcloud") as NextcloudOracle;
  await seedNc0(await oracle.davSession());
  const tools = [mcpToolName("nc_webdav_write_file", "nextcloud")];

  const start = await oracle.snapshot();
  const one = await chatWithApproval(rt.stack, { fixture: "p4-mcp-appr-006-s1", prompt: "Write the note.", tools, decide: () => "approve" });
  ctx.check(one.pauses.length >= 1 ? pass(`conversation 1: ${one.pauses.length} approval prompt(s), approved`) : fail("conversation 1 never asked for approval"));
  const afterOne = await oracle.snapshot();
  ctx.check(changed(start, afterOne));

  const two = await chatWithApproval(rt.stack, { fixture: "p4-mcp-appr-006-s2", prompt: "Write the note.", tools, decide: () => "reject" });
  ctx.check(two.pauses.length >= 1 ? pass(`conversation 2: asked for approval again (${two.pauses.length} prompt(s))`) : fail("conversation 2 ran the write without asking: the approval carried over"));
  ctx.check(unchanged(afterOne, await oracle.snapshot()));
});
