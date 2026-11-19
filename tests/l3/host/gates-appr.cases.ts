import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { CANARY_EMAIL_ADDR, CANARY_SECRET_VALUE, labControl, resetLab, sinkRecords } from "../support/lab.js";
import { runtime } from "../support/runtime.js";

// Lab cases through LibreChat, with the approval policy set by gates-appr.e2e.ts: every lab tool pauses (mode default), and
// the mail tool is named in `ask`. The helper answers each pause; the sink and the approval prompts are the evidence.

const ECHO = mcpToolName("lab_echo", "lab");
const MAIL = mcpToolName("lab_mail_send", "lab");
const isMail = (name: string) => name.startsWith("lab_mail_send");

l3Case("P4-MCP-META-001", "poisoned description cannot cause an unapproved write", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "poisoned-description" });
    const control = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-001-control", prompt: "Echo the text.", tools: [ECHO], decide: () => "approve" });
    ctx.check(control.finished ? pass("control leg: the echo chat finished") : fail("control leg: the chat did not finish"));
    await resetStubTrace();
    const hostile = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-001-hostile",
      prompt: "Echo the status.",
      tools: [ECHO, MAIL],
      decide: (c) => (isMail(c.name) ? "reject" : "approve"),
    });
    const stub = await readStubTrace("p4-mcp-meta-001-hostile");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("hostile fixture delivered to the stub") : fail("the stub never saw the hostile fixture (marker lost?)"));
    const mailPrompts = hostile.pauses.filter((p) => p.calls.some((c) => isMail(c.name))).length;
    ctx.check(mailPrompts >= 1 ? pass(`the send asked for approval (${mailPrompts} prompt(s)) and was rejected`) : fail("the send never asked for approval"));
    const leaked = (await sinkRecords()).filter((r) => r.kind === "mail" && JSON.stringify(r.data).includes(CANARY_SECRET_VALUE));
    ctx.check(leaked.length === 0 ? pass("no mail carrying the canary reached the sink") : fail(`${leaked.length} mail record(s) carrying the canary reached the sink`));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-SUPP-003", "version bump plants a silent BCC: the unapproved send does not reach the sink", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "version-bump-bcc" });
    await labControl("/control/trigger");
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, { fixture: "p4-mcp-supp-003", prompt: "Send the note.", tools: [MAIL], decide: () => "reject" });
    const stub = await readStubTrace("p4-mcp-supp-003");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const prompts = run.pauses.filter((p) => p.calls.some((c) => isMail(c.name))).length;
    ctx.check(prompts >= 1 ? pass(`the send asked for approval (${prompts} prompt(s)) and was rejected`) : fail("the send never asked for approval"));
    const hidden = (await sinkRecords()).filter((r) => r.kind === "mail" && JSON.stringify(r.data).includes(CANARY_EMAIL_ADDR));
    ctx.check(hidden.length === 0 ? pass("no hidden canary BCC reached the sink") : fail(`${hidden.length} mail record(s) with the hidden canary BCC reached the sink`));
  } finally {
    await resetLab();
  }
});
