import { resultMatchesOutputSchema } from "../../../src/oracles/schema.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { checkSeededText } from "../../l1/seed-check.js";
import { l3Case } from "../support/case.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runFixture } from "../support/run-fixture.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-TOOL-002. A tool that declares an outputSchema must return a result that satisfies it. The S2 capture found that
// none of Twenty's 7 tools declares one, so for Twenty this is a deployment finding (an annotation, the test passes) and
// the case is carried by the plumbing check: the real result reaches the model through LibreChat. The lab leg lands with L2.
l3Case("P4-MCP-TOOL-002", "tool results satisfy the declared outputSchema", async (ctx) => {
  const rt = runtime();
  const { url, authorization } = rt.stack.mcp("twenty");
  const client = new McpHttpClient(url, authorization);
  await client.initialize();
  const tools = await client.listTools();
  const declared = tools.filter((t) => t.outputSchema !== undefined && t.outputSchema !== null);
  if (declared.length === 0) {
    ctx.note(`deployment finding: none of ${tools.length} Twenty tools declares an outputSchema, so there is nothing to validate on this server`);
    ctx.check(pass(`twenty: ${tools.length} tools, no outputSchema declared (finding recorded)`));
  }
  for (const tool of declared) {
    const res = await client.callTool(tool.name, {});
    const structured = (res.body as { result?: { structuredContent?: unknown } }).result?.structuredContent;
    const v = resultMatchesOutputSchema(tool, structured);
    ctx.check(v === "not-applicable" ? fail(`${tool.name}: outputSchema vanished`) : v);
  }
  // Plumbing: a real read result reaches the model through LibreChat and carries the seeded objects.
  const run = await runFixture(rt.stack, { fixture: "p4-mcp-tool-002-twenty", prompt: "List the object names.", tools: [mcpToolName("list_object_metadata_names", "twenty")] });
  const second = run.stub.find((e) => e.turn === 1);
  ctx.check(second ? checkSeededText(second.toolResults.join("\n")) : fail("LibreChat never sent the tool result back to the model"));
});
