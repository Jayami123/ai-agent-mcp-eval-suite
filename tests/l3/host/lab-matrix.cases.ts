import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { labLog, resetLab } from "../support/lab.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-APPR-007: the toolApproval glob matrix matches the documented behaviour, one row per fixture. The policy (set by
// lab-matrix.e2e.ts): deny lab_echo, allow lab_add, ask lab_mail_send; mode default, so a tool the lists do not name pauses.
// Each row is one chat with one call. The expected pause and execution per row follow the documented matrix below.

interface Row {
  fixture: string;
  tool: string;
  /** deny: never runs and never prompts; allow: runs with no prompt; ask or unlisted (default): prompts. */
  rule: "deny" | "allow" | "ask" | "unlisted";
  expectPrompt: boolean;
  expectRun: boolean;
}
const MATRIX: Row[] = [
  { fixture: "p4-mcp-appr-007-1", tool: "lab_echo", rule: "deny", expectPrompt: false, expectRun: false },
  { fixture: "p4-mcp-appr-007-2", tool: "lab_add", rule: "allow", expectPrompt: false, expectRun: true },
  { fixture: "p4-mcp-appr-007-3", tool: "lab_mail_send", rule: "ask", expectPrompt: true, expectRun: false },
  { fixture: "p4-mcp-appr-007-4", tool: "test_error_handling", rule: "unlisted", expectPrompt: true, expectRun: false },
  { fixture: "p4-mcp-appr-007-5", tool: "json_schema_2020_12_tool", rule: "unlisted", expectPrompt: true, expectRun: false },
  { fixture: "p4-mcp-appr-007-6", tool: "lab_echo", rule: "deny", expectPrompt: false, expectRun: false },
];

for (const row of MATRIX) {
  l3Case("P4-MCP-APPR-007", `${row.tool} (${row.rule}) matches the documented matrix`, async (ctx) => {
    const rt = runtime();
    await resetLab();
    try {
      await resetStubTrace();
      const run = await chatWithApproval(rt.stack, {
        fixture: row.fixture,
        prompt: `Call ${row.tool} once.`,
        tools: [mcpToolName(row.tool, "lab")],
        decide: () => "reject",
      });
      const prompted = run.pauses.some((p) => p.calls.some((c) => c.name.startsWith(row.tool)));
      const ran = (await labLog()).some((e) => e.event === "call_completed" && e.detail["tool"] === row.tool);
      ctx.check(prompted === row.expectPrompt
        ? pass(`${row.tool} (${row.rule}): prompted=${prompted}, as documented`)
        : fail(`${row.tool} (${row.rule}): prompted=${prompted}, the matrix says ${row.expectPrompt}`));
      ctx.check(ran === row.expectRun
        ? pass(`${row.tool} (${row.rule}): ran=${ran}, as documented`)
        : fail(`${row.tool} (${row.rule}): ran=${ran}, the matrix says ${row.expectRun}`));
    } finally {
      await resetLab();
    }
  });
}
