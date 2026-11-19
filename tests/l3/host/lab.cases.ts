import { readFileSync } from "node:fs";
import path from "node:path";
import { changedTools, descriptionFindings, linterVerdict, versionDrift } from "../../../src/oracles/lab.js";
import { toolsDiff, toolsMatchPin, type PinnedTool } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { l3Case } from "../support/case.js";
import { labControl, labState, resetLab, stdioListTools } from "../support/lab.js";
import { McpHttpClient, type ToolDef } from "../support/mcp-client.js";

// Lab cases that need only the attack-lab (no model, no LibreChat chat): PROT-005, PROT-006, META-009, SUPP-002. Each starts
// and ends from the start mode (benign). The lab's state, tool lists and version are the evidence; no assistant text is read.

interface Pin {
  serverName: string;
  serverVersion: string;
  tools: PinnedTool[];
}
const PIN = JSON.parse(readFileSync(path.resolve(process.cwd(), "tests", "l3", "snapshots", "lab.tools.json"), "utf8")) as Pin;

/** A fresh MCP session against the lab: initialize, then tools/list. Returns the serverInfo and the tools. */
async function freshList(): Promise<{ serverName: unknown; serverVersion: unknown; tools: ToolDef[] }> {
  const { LAB } = await import("../support/lab.js");
  const c = new McpHttpClient(LAB.mcp, null);
  const init = await c.initialize();
  const info = (init.body as { result?: { serverInfo?: { name?: unknown; version?: unknown } } }).result?.serverInfo;
  const tools = await c.listTools();
  return { serverName: info?.name, serverVersion: info?.version, tools };
}

l3Case("P4-MCP-PROT-005", "cache hint does not serve stale tools/list", async (ctx) => {
  await resetLab();
  try {
    const before = await freshList();
    ctx.check(toolsMatchPin(PIN.tools, before.tools));
    await labControl("/control/mode", { mode: "rug-pull-after-n" });
    await labControl("/control/trigger");
    // Same session as the first list would reuse, and a new session: both must show the served change, not an old list.
    const sameSession = new McpHttpClient((await import("../support/lab.js")).LAB.mcp, null);
    await sameSession.initialize();
    const afterSame = await sameSession.listTools();
    const afterNew = await freshList();
    for (const [label, tools] of [
      ["same session", afterSame],
      ["new session", afterNew.tools],
    ] as const) {
      const diff = changedTools(PIN.tools, tools as ToolDef[]);
      const bccAdded = (tools as ToolDef[]).find((t) => t.name === "lab_mail_send")?.inputSchema;
      const hasBcc = JSON.stringify(bccAdded ?? {}).includes('"bcc"');
      ctx.check(diff.some((d) => d.startsWith("lab_mail_send")) && hasBcc ? pass(`${label}: lab_mail_send changed after the switch (bcc parameter served)`) : fail(`${label}: the list still shows the old lab_mail_send (${diff.join("; ") || "no diff"})`));
    }
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-PROT-006", "streamable HTTP and stdio both work from the host", async (ctx) => {
  await resetLab();
  try {
    const http = await freshList();
    const stdio = await stdioListTools();
    const httpNames = http.tools.map((t) => t.name).sort();
    const stdioNames = [...stdio.toolNames].sort();
    ctx.check(httpNames.length > 0 && JSON.stringify(httpNames) === JSON.stringify(stdioNames) ? pass(`http and stdio serve the same ${httpNames.length} tools`) : fail(`transports differ: http [${httpNames.join(",")}] stdio [${stdioNames.join(",")}]`));
    ctx.check(http.serverName === stdio.serverName && stdio.serverName === PIN.serverName ? pass(`both name the server ${PIN.serverName}`) : fail(`server name differs: http ${String(http.serverName)}, stdio ${String(stdio.serverName)}`));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-META-009", "static scanner gate flags a poisoned description", async (ctx) => {
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "poisoned-description" });
    const poisoned = await freshList();
    ctx.check(linterVerdict(poisoned.tools, "flagged"));
    ctx.note(`poisoned findings: ${descriptionFindings(poisoned.tools).length}`);
    await resetLab();
    const clean = await freshList();
    ctx.check(linterVerdict(clean.tools, "clean"));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-SUPP-002", "manifest drift vs pin detected", async (ctx) => {
  await resetLab();
  try {
    const benign = await freshList();
    ctx.check(toolsMatchPin(PIN.tools, benign.tools));
    ctx.check(String(benign.serverVersion) === PIN.serverVersion && benign.serverName === PIN.serverName
      ? pass(`serverInfo matches the pin (${PIN.serverName} ${PIN.serverVersion})`)
      : fail(`serverInfo differs from the pin before any switch`));
    await labControl("/control/mode", { mode: "version-bump-bcc" });
    await labControl("/control/trigger");
    const bumped = await freshList();
    const drift = versionDrift({ serverVersion: PIN.serverVersion }, { serverVersion: bumped.serverVersion });
    ctx.check(drift !== undefined ? pass(`version drift detected at initialize: ${drift}`) : fail("the version bump was not detected at initialize"));
    // The documented gap: tool metadata is unchanged, so a metadata hash pin cannot see this drift. Recorded, not a verdict.
    const metadataChanged = toolsDiff(PIN.tools, bumped.tools);
    ctx.note(`tool metadata changes against the pin: ${metadataChanged.length === 0 ? "none (a hash pin alone cannot see this drift)" : metadataChanged.join("; ")}`);
    ctx.note(`lab state mode: ${String((await labState()).mode)}`);
  } finally {
    await resetLab();
  }
});
