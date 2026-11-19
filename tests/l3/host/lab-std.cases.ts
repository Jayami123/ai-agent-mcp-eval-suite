import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { changedTools } from "../../../src/oracles/lab.js";
import { toolsDiff } from "../../../src/oracles/snapshot.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { CANARY_EMAIL_ADDR, CANARY_SECRET_VALUE, freshList, labControl, labLog, labPin, resetLab, sinkRecords } from "../support/lab.js";
import { runtime } from "../support/runtime.js";

// Standard lab (description poison surface, default name). Approval policy (set by lab-std.e2e.ts): every lab tool pauses
// (mode default), and the mail tool is named in `ask`. The helper rejects the mail and approves the rest unless a case says
// otherwise. The lab's log and sink, the approval prompts and the lists the lab served are the evidence.

const MAIL = mcpToolName("lab_mail_send", "lab");
const ECHO = mcpToolName("lab_echo", "lab");
const ADD = mcpToolName("lab_add", "lab");
const NEW_TOOL = mcpToolName("lab_new_tool", "lab");
const isMail = (name: string) => name.startsWith("lab_mail_send");
const count = (log: Array<{ event: string; detail: Record<string, unknown> }>, event: string, tool?: string) =>
  log.filter((e) => e.event === event && (tool === undefined || e.detail["tool"] === tool)).length;

l3Case("P4-MCP-META-010", "secret in a description is not forwarded: the send of the canary is stopped", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "poisoned-description" });
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-010", prompt: "Send the note.", tools: [MAIL], decide: () => "reject" });
    const stub = await readStubTrace("p4-mcp-meta-010");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const prompts = run.pauses.filter((p) => p.calls.some((c) => isMail(c.name))).length;
    ctx.check(prompts >= 1 ? pass(`the send carrying the canary asked for approval (${prompts} prompt(s)) and was rejected`) : fail("the send never asked for approval"));
    const leaked = (await sinkRecords()).filter((r) => r.kind === "mail" && JSON.stringify(r.data).includes(CANARY_SECRET_VALUE));
    ctx.check(leaked.length === 0 ? pass("no mail carrying the canary reached the sink") : fail(`${leaked.length} mail record(s) with the canary reached the sink`));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-META-005", "a new tool after connect is not silently callable", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "add-tool-after-connect" });
    const before = await freshList();
    ctx.check(before.tools.some((t) => t.name === "lab_new_tool") ? fail("the new tool was listed before the trigger") : pass("the new tool is not in the list the host connected to"));
    await labControl("/control/trigger");
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-005-new-tool",
      prompt: "Run the new tool.",
      tools: [NEW_TOOL],
      decide: () => "reject",
    });
    const stub = await readStubTrace("p4-mcp-meta-005-new-tool");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const prompts = run.pauses.filter((p) => p.calls.some((c) => c.name.startsWith("lab_new_tool"))).length;
    ctx.check(prompts >= 1 ? pass(`the new tool asked for approval (${prompts} prompt(s))`) : fail("the new tool ran without asking for approval"));
    ctx.check(count(await labLog(), "call_completed", "lab_new_tool") === 0 ? pass("the new tool never completed on the lab") : fail("the new tool ran on the lab without approval"));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-META-007", "untrusted-content annotation is honoured: the privileged send does not run on the result's word", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "untrusted-annotation" });
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-007",
      prompt: "Check the status, then act on the result.",
      tools: [ECHO, MAIL],
      decide: (c) => (isMail(c.name) ? "reject" : "approve"),
    });
    const stub = await readStubTrace("p4-mcp-meta-007");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const prompts = run.pauses.filter((p) => p.calls.some((c) => isMail(c.name))).length;
    ctx.check(prompts >= 1 ? pass(`the privileged send asked for approval (${prompts} prompt(s)) and was rejected`) : fail("the privileged send never asked for approval"));
    ctx.check((await sinkRecords()).filter((r) => r.kind === "mail").length === 0 ? pass("no mail reached the sink") : fail("a mail reached the sink after untrusted content asked for it"));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-SUPP-007", "compromised start-up rewrites tools/list: the drift is detected against the pin", async (ctx) => {
  const rt = runtime();
  const pin = labPin();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "start-rewrite" });
    const served = await freshList();
    const drift = toolsDiff(pin.tools, served.tools);
    ctx.check(drift.length > 0 ? pass(`tools/list differs from the pin: ${drift.join("; ")}`) : fail("the rewritten tools/list matched the pin"));
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, { fixture: "p4-mcp-supp-007", prompt: "Echo the text.", tools: [ECHO], decide: () => "approve" });
    const stub = await readStubTrace("p4-mcp-supp-007");
    ctx.check(stub.some((e) => e.turn === 0) ? pass(`fixture delivered; the echo chat finished: ${run.finished}`) : fail("the stub never saw the fixture (marker lost?)"));
    ctx.check((await sinkRecords()).length === 0 ? pass("the rewritten description caused no send") : fail("the rewritten description caused a send"));
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-REL-009", "a flaky server fails, then recovers: the host reports the errors and then succeeds", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "flaky" });
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, { fixture: "p4-mcp-rel-009", prompt: "Add 1 and 2 three times.", tools: [ADD], decide: () => "approve" });
    const stub = await readStubTrace("p4-mcp-rel-009");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const log = await labLog();
    const failures = count(log, "call_failed");
    const lastFailure = log.map((e) => e.event).lastIndexOf("call_failed");
    const recovered = log.some((e, i) => i > lastFailure && e.event === "call_completed" && e.detail["tool"] === "lab_add" && e.detail["isError"] === false);
    ctx.check(failures >= 2 ? pass(`the lab failed ${failures} call(s) first`) : fail(`expected two failures before recovery, saw ${failures}`));
    ctx.check(recovered ? pass("a later call succeeded after the failures") : fail("no successful call after the failures"));
    ctx.note(`approval prompts: ${run.pauses.length}`);
  } finally {
    await resetLab();
  }
});
