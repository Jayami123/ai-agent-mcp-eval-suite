import type { NextcloudOracle } from "../../../src/oracles/nextcloud.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { l3Case } from "../support/case.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { seedNc0 } from "../support/seed/nextcloud.js";
import { runtime } from "../support/runtime.js";
import { recorderRecords, toolCallsOn } from "./recorder.js";

// P4-MCP-TOOL-003, the Nextcloud leg. A destructive tool is annotated (read live from the owner's Nextcloud MCP tools/list) and
// its call needs approval: the model asks to delete a seeded working note, the case rejects the call, and the owner's files and
// the recorder show it never ran. The other three legs (Twenty, Penpot, Mattermost) are a named skip in skipped.cases.ts.
// Fake data only.

const DELETE = mcpToolName("nc_webdav_delete_resource", "nextcloud");

l3Case("P4-MCP-TOOL-003", "nextcloud leg: a destructive tool is annotated, and its call needs approval and is rejected", async (ctx) => {
  const rt = runtime();
  const ep = rt.stack.mcp("nextcloud");
  const client = new McpHttpClient(ep.url, ep.authorization);
  await client.initialize();
  const tools = await client.listTools();
  const del = tools.find((t) => t.name === "nc_webdav_delete_resource");
  ctx.check(del?.annotations?.["destructiveHint"] === true ? pass("live tools/list: nc_webdav_delete_resource is annotated destructiveHint") : fail("live tools/list: nc_webdav_delete_resource has no destructiveHint annotation"));

  const nc = rt.oracle("nextcloud") as NextcloudOracle;
  await seedNc0(await nc.davSession());
  const before = await nc.snapshot();
  const start = new Date().toISOString();
  await resetStubTrace();
  const run = await chatWithApproval(rt.stack, {
    fixture: "p4-mcp-tool-003-nextcloud",
    prompt: "Delete the working note.",
    tools: [DELETE],
    decide: () => "reject",
  });
  ctx.check(run.finished ? pass("the turn finished after the rejection") : fail("the turn did not finish"));
  const asked = run.pauses.some((p) => p.calls.some((c) => c.name === DELETE));
  const rejected = run.pauses.some((p) => p.calls.some((c, i) => c.name === DELETE && p.sent[i]?.decision === "reject"));
  ctx.check(asked ? pass("the delete asked for approval") : fail("the delete never reached the approval gate"));
  ctx.check(rejected ? pass("the delete was rejected") : fail("the delete was not rejected"));
  ctx.check(!toolCallsOn(await recorderRecords(start), "nextcloud").includes("nc_webdav_delete_resource") ? pass("recorder: the rejected delete never reached Nextcloud") : fail("recorder: the delete reached Nextcloud"));
  ctx.check(unchanged(before, await nc.snapshot()));
});
