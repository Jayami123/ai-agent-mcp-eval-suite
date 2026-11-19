import { test } from "node:test";
import { mailCountTo, TwentyOracle } from "../../../src/oracles/twenty.js";
import type { ProductAdapter } from "qa-portfolio-harness";
import { redact, writeEvidence } from "../../l1/evidence.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";

// Spike S2 capture. Runs only with P4_L3_CAPTURE=1 (the manual capture step of the l3-twenty job). Writes what the live
// servers really expose to evidence/l3-capture/, to be reviewed by a human and committed under tests/l3/snapshots/.
// It asserts nothing: it is a recording. Credentials are redacted and never written.
const DIR = "l3-capture";

test("S2 capture: tools/list, Twenty catalog, database tables, mail catcher", { timeout: 20 * 60_000 }, async () => {
  const rt = runtime();
  for (const server of rt.servers) {
    const { url, authorization } = rt.stack.mcp(server);
    const secrets = authorization ? [authorization] : [];
    const client = new McpHttpClient(url, authorization);
    const init = await client.initialize();
    writeEvidence(DIR, `${server}.initialize.json`, `${redact(JSON.stringify({ status: init.status, sessionHeader: init.headers.get("mcp-session-id") !== null, body: init.body }, null, 2), secrets)}\n`);
    const tools = await client.listTools();
    writeEvidence(DIR, `${server}.tools.json`, `${JSON.stringify({ tools }, null, 2)}\n`);
    writeEvidence(DIR, `${server}.tools-size.txt`, `${server}: ${tools.length} tools, ${JSON.stringify(tools).length} bytes of tools/list JSON\n`);
    if (server === "twenty") {
      const cat = await client.callTool("get_tool_catalog", {});
      writeEvidence(DIR, "twenty.catalog.raw.json", `${redact(JSON.stringify(cat.body, null, 2).slice(0, 400_000), secrets)}\n`);
      const meta = await client.callTool("list_object_metadata_names", {});
      writeEvidence(DIR, "twenty.list-object-metadata-names.raw.json", `${redact(JSON.stringify(meta.body, null, 2).slice(0, 100_000), secrets)}\n`);
      const oracle = new TwentyOracle(rt.stack.adapters.get("twenty") as ProductAdapter);
      try {
        const out: Record<string, string[]> = {};
        for (const schema of await oracle.workspaceSchemas()) out[schema] = await oracle.tablesIn(schema);
        writeEvidence(DIR, "twenty.tables.json", `${JSON.stringify(out, null, 2)}\n`);
      } finally {
        await oracle.close();
      }
      try {
        writeEvidence(DIR, "twenty.mailpit.json", `${JSON.stringify({ countToProbeAddress: await mailCountTo("probe@p4.test") }, null, 2)}\n`);
      } catch (e) {
        writeEvidence(DIR, "twenty.mailpit.json", `${JSON.stringify({ error: (e as Error).message })}\n`);
      }
    }
  }
});
