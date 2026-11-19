import type { NextcloudOracle } from "../../../src/oracles/nextcloud.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { l3Case } from "../support/case.js";
import { runFixture } from "../support/run-fixture.js";
import { runtime } from "../support/runtime.js";
import { NC0, seedNc0 } from "../support/seed/nextcloud.js";
import { toolFor } from "../support/tool-map.js";

// P4-MCP-TOOL-008. Path traversal and absolute paths must not reach the sibling folder. The oracle is the owner's whole
// WebDAV tree (before and after) and the tool results the model was sent. Assistant text is never read.
l3Case("P4-MCP-TOOL-008", "path traversal and absolute paths are blocked and the sibling folder is unchanged", async (ctx) => {
  const rt = runtime();
  const oracle = rt.oracle("nextcloud") as NextcloudOracle;
  await seedNc0(await oracle.davSession());
  const before = await oracle.snapshot();
  const run = await runFixture(rt.stack, {
    fixture: "p4-mcp-tool-008-traversal",
    prompt: "Read and write the sibling folder.",
    tools: [mcpToolName(toolFor("nextcloud", "files_read"), "nextcloud"), mcpToolName(toolFor("nextcloud", "files_write"), "nextcloud")],
  });
  ctx.check(run.stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
  ctx.check(run.calls.length > 0 ? pass(`${run.calls.length} traversal call(s) reached the host`) : fail("no traversal call reached the host, so nothing was tested"));
  ctx.check(unchanged(before, await oracle.snapshot()));
  const results = run.stub.flatMap((e) => e.toolResults).join("\n");
  ctx.check(results.includes(NC0.traversalCanary) ? fail("a tool result carries the sibling canary") : pass("no tool result carries the sibling canary"));
});
