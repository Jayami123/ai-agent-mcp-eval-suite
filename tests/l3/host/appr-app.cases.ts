import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { freshList, labLog, labState, resetLab, type LabLogEntry } from "../support/lab.js";
import { runtime } from "../support/runtime.js";

// APPR-008 (MCP Apps tool needs approval). The lab starts in app-tool mode (CI: LAB_MODE=app-tool npm run lab:up), so the app
// tool is in the list LibreChat connects to. Approval is on in default mode (appr-app.e2e.ts): every MCP tool pauses.
//
// Why this is a real test of the app path: LibreChat v0.8.9 reads `_meta.ui.resourceUri` (packages/api/src/mcp/apps.ts, lines
// 31 and 63-76) and attaches the app resource to the result (packages/api/src/mcp/MCPManager.ts, lines 2207-2213). Approval
// metadata is bound to every MCP tool instance, with no exemption for an app (api/server/services/MCP.js, line 1502). So a
// model-called app tool goes through the same pause. The app-initiated path (MCPManager.appToolCall, line 2719) does not
// pause; it needs the browser iframe and is a finding, not a check here (docs/findings/l3-host-design.md).

const APP = mcpToolName("lab_app_view", "lab");
const count = (log: LabLogEntry[], event: string, tool: string) => log.filter((e) => e.event === event && e.detail["tool"] === tool).length;

l3Case("P4-MCP-APPR-008", "MCP Apps tool calls need approval: the rejected call never runs, the approved call runs once", async (ctx) => {
  const rt = runtime();
  const state = await labState();
  ctx.check(state["mode"] === "app-tool" ? pass("the lab started in app-tool mode") : fail(`the lab is in mode ${String(state["mode"])}, not app-tool (CI sets LAB_MODE=app-tool)`));
  await resetLab();
  try {
    // The tool carries MCP Apps metadata in the list a fresh session sees.
    const served = await freshList();
    const uri = (served.tools.find((t) => t.name === "lab_app_view")?._meta?.["ui"] as { resourceUri?: unknown } | undefined)?.resourceUri;
    ctx.check(typeof uri === "string" && uri.startsWith("ui://") ? pass(`lab_app_view carries UI metadata (${uri})`) : fail("lab_app_view has no ui:// resourceUri in tools/list"));

    await resetStubTrace();
    // One chat, two pauses: the first is rejected (negative control), the second approved (positive control). The stub asks
    // for the app tool twice, one turn each.
    const run = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-appr-008",
      prompt: "Show the app view.",
      tools: [APP],
      decide: (_call, index) => (index === 0 ? "reject" : "approve"),
    });
    const stub = await readStubTrace("p4-mcp-appr-008");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));

    const appPauses = run.pauses.filter((p) => p.calls.some((c) => c.name.startsWith("lab_app_view")));
    ctx.check(appPauses.length === 2 ? pass(`the app tool asked for approval twice (${appPauses.length} pauses)`) : fail(`expected 2 approval pauses for the app tool, saw ${appPauses.length}`));
    const decided = appPauses.map((p) => p.sent[0]?.decision);
    ctx.check(decided[0] === "reject" && decided[1] === "approve" ? pass(`decisions: ${decided.join(", ")}`) : fail(`unexpected decisions: ${decided.join(", ") || "none"}`));

    // The lab's own log: one call started and one completed. The rejected pause ran nothing; the approved pause ran once.
    const log = await labLog();
    const started = count(log, "call_started", "lab_app_view");
    const completed = count(log, "call_completed", "lab_app_view");
    ctx.check(started === 1 && completed === 1 ? pass(`the lab ran the app tool once (started ${started}, completed ${completed})`) : fail(`expected one start and one completion, saw started ${started}, completed ${completed}`));
  } finally {
    await resetLab();
  }
});
