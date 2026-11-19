import { discoveryStatuses, metadataAdvertised } from "../../../src/oracles/oauth.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { writeEvidence } from "../../l1/evidence.js";
import { l3Case } from "../support/case.js";
import { runtime } from "../support/runtime.js";

l3Case("P4-MCP-OAUTH-001", "an unauthenticated 401 carries a resource-metadata hint", async (ctx) => {
  const rt = runtime();
  for (const server of rt.servers) {
    const { url } = rt.stack.mcp(server);
    const oracle = rt.oracle(server);
    const before = await oracle.snapshot();
    // Spike S3 evidence: which discovery documents the origin serves (status only, no secrets).
    writeEvidence(rt.dir, `oauth-discovery-${server}.json`, `${JSON.stringify(await discoveryStatuses(new URL(url).origin), null, 2)}\n`);
    for (const v of await metadataAdvertised(url)) ctx.check({ ...v, detail: `${server}: ${v.detail}` });
    ctx.check(unchanged(before, await oracle.snapshot()));
  }
});
