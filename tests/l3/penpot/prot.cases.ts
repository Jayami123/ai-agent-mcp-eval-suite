import type { PenpotOracle } from "../../../src/oracles/penpot.js";
import { tasksCapabilityConsistent } from "../../../src/oracles/proto.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { l3Case } from "../support/case.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-PROT-011. The MCP tasks extension is either negotiated or cleanly absent. The suite's raw client initializes the
// Penpot MCP server, then calls tasks/get with an id nobody created. The verdict follows the negotiated capability, and the
// owner's projects and files must not change. Protocol case: no model, no LibreChat chat.
l3Case("P4-MCP-PROT-011", "tasks extension negotiated or cleanly absent", async (ctx) => {
  const rt = runtime();
  const { url, authorization } = rt.stack.mcp("penpot");
  const oracle = rt.oracle("penpot") as PenpotOracle;
  const client = new McpHttpClient(url, authorization);
  const before = await oracle.snapshot();
  const init = await client.initialize();
  const tasksGet = await client.post({ jsonrpc: "2.0", id: 50, method: "tasks/get", params: { taskId: "p4l3-never-created" } });
  ctx.check(tasksCapabilityConsistent(init, tasksGet));
  ctx.check(unchanged(before, await oracle.snapshot()));
});
