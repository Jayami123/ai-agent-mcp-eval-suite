import { unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { l3Case } from "../support/case.js";
import { runFixture } from "../support/run-fixture.js";
import { runtime } from "../support/runtime.js";
import type { BusinessServer } from "../support/stack.js";
import { toolsSnapshot } from "../support/tool-map.js";

// Tool-design cases that run on every registered server, through LibreChat with a stub fixture. The fixture names a real
// tool captured in S2 (tests/l3/snapshots); a server is added here with its fixtures when its PR lands.
interface Plan {
  /** Fixture that calls a write tool with a wrong-type field and an undeclared extra field. */
  extraField: { fixture: string; tool: string };
  /** Fixture that calls a read-only tool with write-shaped arguments. */
  readOnly: { fixture: string; tool: string };
}
const PLANS: Partial<Record<BusinessServer, Plan>> = {
  twenty: {
    extraField: { fixture: "p4-mcp-tool-001-extra-field", tool: "execute_tool" },
    readOnly: { fixture: "p4-mcp-tool-004-readonly", tool: "list_object_metadata_names" },
  },
};

l3Case("P4-MCP-TOOL-001", "a wrong-type or extra field does not cause a write outside the schema", async (ctx) => {
  const rt = runtime();
  for (const server of rt.servers) {
    const plan = PLANS[server];
    if (plan === undefined) throw new Error(`L3_NO_PLAN: ${server} has no TOOL-001 fixture yet`);
    const before = await rt.oracle(server).snapshot();
    const run = await runFixture(rt.stack, { fixture: plan.extraField.fixture, prompt: "Create the record.", tools: [mcpToolName(plan.extraField.tool, server)] });
    ctx.check(run.stub.some((e) => e.turn === 0) ? pass(`${server}: fixture delivered, ${run.calls.length} host tool call(s)`) : fail(`${server}: the stub never saw the fixture (marker lost?)`));
    ctx.check(unchanged(before, await rt.oracle(server).snapshot()));
  }
});

l3Case("P4-MCP-TOOL-004", "a tool advertised as read-only leaves state unchanged even when asked to write", async (ctx) => {
  const rt = runtime();
  for (const server of rt.servers) {
    const plan = PLANS[server];
    if (plan === undefined) throw new Error(`L3_NO_PLAN: ${server} has no TOOL-004 fixture yet`);
    const advertised = toolsSnapshot(server).find((t) => t.name === plan.readOnly.tool)?.annotations as { readOnlyHint?: unknown } | undefined;
    ctx.check(advertised?.readOnlyHint === true ? pass(`${server}: ${plan.readOnly.tool} is annotated readOnlyHint`) : fail(`${server}: ${plan.readOnly.tool} is not annotated readOnlyHint in the snapshot`));
    const before = await rt.oracle(server).snapshot();
    const run = await runFixture(rt.stack, { fixture: plan.readOnly.fixture, prompt: "List the object names.", tools: [mcpToolName(plan.readOnly.tool, server)] });
    ctx.check(run.calls.length === 1 ? pass(`${server}: the write-shaped call reached the host`) : fail(`${server}: expected 1 host tool call, saw ${run.calls.length}`));
    ctx.check(unchanged(before, await rt.oracle(server).snapshot()));
  }
});
