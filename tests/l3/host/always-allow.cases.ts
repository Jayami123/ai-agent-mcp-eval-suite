import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdapter } from "qa-portfolio-harness";
import { changedTools } from "../../../src/oracles/lab.js";
import { fail, pass, type Verdict } from "../../../src/oracles/verdict.js";
import { expectedDefect, type DefectRef } from "../support/expected-defect.js";
import { l3Case, type CaseCtx } from "../support/case.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval, type ApprovalRun, type Decision, type DecisionChoice, type PausedCall } from "../support/approval.js";
import { freshList, labControl, labLog, labPin, labState, type LabLogEntry, resetLab, sinkRecords } from "../support/lab.js";
import type { ToolDef } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";

// Always-allow and pinning cases through LibreChat (harness v0.6.7). Set by always-allow.e2e.ts: Always allow on, mode default,
// NO ask rule (LibreChat never offers Always allow for an ask-matched tool: a host limit, recorded in
// docs/findings/l3-always-allow.md). The evidence is the lab's call log, the served tool list and the approval pauses. The
// model's reply text is never read. Every case resets both labs before and after itself (the cleanup sweep checks it).
//
// Legs of one case share a conversation only where the case needs the stored Always allow (Always allow is kept per
// conversation). A leg that starts a conversation or a login is recorded with a note. The stub picks its turn by counting
// the tool messages already in a conversation, so a continued leg's fixture starts with placeholder turns.

const ECHO = mcpToolName("lab_echo", "lab");
const ECHO_LAB2 = mcpToolName("lab_echo", "lab2");
const ALWAYS = (): DecisionChoice => ({ decision: "approve", scope: "session" });
const REJECT = (): Decision => "reject";

/** Both labs back to the start mode with empty logs. */
async function resetBoth(): Promise<void> {
  await resetLab("lab");
  await resetLab("lab2");
}

/** The stub served this fixture at least once. Padded fixtures serve their call at turn N, so any turn counts (not turn 0). */
const delivered = async (fixture: string): Promise<boolean> => (await readStubTrace(fixture)).length > 0;
/** The fixture's delivery check, with the turns the stub served as a note (the evidence for an inconclusive leg). */
async function deliveredCheck(ctx: CaseCtx, fixture: string, label: string): Promise<void> {
  const turns = (await readStubTrace(fixture)).map((e) => e.turn);
  ctx.note(`${label}: stub served ${fixture} at turn(s) [${turns.join(",") || "none"}]`);
  ctx.check(turns.length > 0 ? pass(`${label}: fixture delivered to the stub`) : fail(`${label}: the stub never served the fixture`));
}
/** A silent run: a lab_echo call ran in a leg where the host asked for no approval. Only this shape is recorded as an expected defect. */
const silentRun = (run: ApprovalRun, ran: string[]): boolean => ran.length > 0 && run.pauses.length === 0;
/** A product finding: a stored Always allow was honoured after the tool changed. */
const stale = (caseId: string, what: string): DefectRef => ({ caseId, server: "librechat", summary: `stored Always allow honoured after a tool change: ${what}` });
const offeredAlways = (run: ApprovalRun, tool: string): boolean => run.pauses.some((p) => p.calls.some((c) => c.name === tool && c.offeredAlways));
const pauseCount = (run: ApprovalRun, tool: string): number => run.pauses.filter((p) => p.calls.some((c: PausedCall) => c.name === tool)).length;
const lastSeq = (log: LabLogEntry[]): number => log.reduce((max, e) => Math.max(max, e.seq), 0);
/** lab_echo calls that reached the lab's handler after a log position, with the parameter names they carried (never values). */
const callsAfter = (log: LabLogEntry[], seq: number): string[] =>
  log.filter((e) => e.event === "call_started" && e.seq > seq && e.detail["tool"] === "lab_echo").map((e) => String(e.detail["params"] ?? ""));
const withBcc = (params: string[]): string[] => params.filter((p) => p.split(",").includes("bcc"));

/** One leg verdict: approval was asked and no call ran (pass); a call ran with no approval asked (fail, silent run); neither (fail, inconclusive). */
function legVerdict(label: string, run: ApprovalRun, callsRan: string[]) {
  if (callsRan.length > 0 && run.pauses.length === 0) return fail(`${label}: ${callsRan.length} lab_echo call(s) ran with no approval asked (silent run)`);
  if (run.pauses.length >= 1 && callsRan.length === 0) return pass(`${label}: the host asked for approval again (${run.pauses.length} pause(s)) and no call ran`);
  if (run.pauses.length >= 1) return fail(`${label}: approval was asked but a call still ran (${callsRan.length})`);
  return fail(`${label}: no approval was asked and no call ran; the leg is inconclusive`);
}

l3Case("P4-MCP-META-002", "rug pull after always-allow: the changed tool with a new parameter does not go through", async (ctx) => {
  const rt = runtime();
  await resetBoth();
  try {
    await labControl("/control/mode", { mode: "rug-pull-echo" });

    // Leg 1: the first call on lab_echo, approved with Always allow in conversation A.
    const a1 = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-002-control", prompt: "Echo the text (p4l3 meta-002).", tools: [ECHO], decide: ALWAYS });
    await deliveredCheck(ctx, "p4-mcp-meta-002-control", "leg 1");
    ctx.check(offeredAlways(a1, ECHO) ? pass("leg 1: the approval card offered Always allow") : fail("leg 1: the card did not offer Always allow (see the host limit in the findings)"));
    ctx.check(a1.finished && a1.messageId !== undefined ? pass("leg 1: the approved run finished") : fail("leg 1: the approved run did not finish"));
    if (a1.messageId === undefined) return;

    // Leg 2: same conversation, same tool, nothing changed. The stored Always allow must run it with no pause (setup).
    const a2 = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-002-control-b",
      prompt: "Echo the text again (p4l3 meta-002).",
      tools: [ECHO],
      decide: REJECT,
      conversationId: a1.conversationId,
      parentMessageId: a1.messageId,
      agentId: a1.agentId,
    });
    ctx.check(a2.pauses.length === 0 && a2.finished && a2.messageId !== undefined
      ? pass("setup: the stored Always allow ran the unchanged call with no pause")
      : fail(`setup: the unchanged second call paused ${a2.pauses.length} time(s); the Always allow was not stored`));
    if (a2.messageId === undefined) return;

    // Scope probe (notes only, no verdict): the same unchanged tool in a NEW conversation, and after a NEW LibreChat login.
    const newConv = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-002-control", prompt: "Echo (scope probe, new conversation).", tools: [ECHO], decide: REJECT });
    ctx.note(`scope probe, unchanged tool, new conversation: pauses=${newConv.pauses.length}`);
    const login2 = await getAdapter("librechat").authenticate();
    const newLogin = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-002-control", prompt: "Echo (scope probe, new login).", tools: [ECHO], decide: REJECT, session: login2 });
    ctx.note(`scope probe, unchanged tool, new LibreChat login: pauses=${newLogin.pauses.length}`);

    // The rug pull: the served lab_echo gets a new description and a bcc parameter.
    const h0 = (await labState()).toolsHash;
    await labControl("/control/trigger");
    const h1 = (await labState()).toolsHash;
    ctx.check(h1 !== h0 ? pass("setup: the rug pull changed the tool hash") : fail("setup: the tool hash did not change after the trigger"));

    // Leg 3: conversation A again, with the new parameter. The host must not run it on the old Always allow.
    const mark = lastSeq(await labLog());
    await resetStubTrace();
    const hostile = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-002-hostile",
      prompt: "Echo the status (p4l3 meta-002).",
      tools: [ECHO],
      decide: REJECT,
      conversationId: a1.conversationId,
      parentMessageId: a2.messageId,
      agentId: a1.agentId,
    });
    await deliveredCheck(ctx, "p4-mcp-meta-002-hostile", "leg 3");
    const ran = callsAfter(await labLog(), mark);
    const bccRan = withBcc(ran).length;
    const leg3: Verdict = bccRan === 0
      ? pass(`leg 3: no call carrying the new bcc parameter reached the lab (approval asked ${hostile.pauses.length} time(s))`)
      : fail(`leg 3: ${bccRan} call(s) with the new bcc parameter ran with no approval asked (pauses ${hostile.pauses.length})`);
    ctx.check(silentRun(hostile, withBcc(ran)) ? expectedDefect(leg3, stale("P4-MCP-META-002", "a call with a new bcc parameter ran with no new approval")) : leg3);
    ctx.note(`leg 3: pauses=${hostile.pauses.length}; lab_echo calls after the rug pull=${ran.length}; with bcc=${withBcc(ran).length}`);

    // Snapshot diff: the served lab_echo differs from the committed pin (the diff is logged here, names only).
    const served = await freshList("lab");
    const diff = changedTools(labPin().tools, served.tools as ToolDef[]);
    ctx.note(`snapshot diff: ${diff.join("; ") || "none"}`);
    ctx.check(diff.some((d) => d.startsWith("lab_echo")) ? pass("snapshot: the served lab_echo differs from the pin after the rug pull") : fail("snapshot: the served lab_echo still matches the pin"));
  } finally {
    await resetBoth();
  }
});

l3Case("P4-MCP-META-004", "re-approval is required when the tool hash changes, on every host path that pins", async (ctx) => {
  const rt = runtime();
  await resetBoth();
  try {
    await labControl("/control/mode", { mode: "rug-pull-echo" });
    const a = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-004-a", prompt: "Echo (p4l3 meta-004 leg a).", tools: [ECHO], decide: ALWAYS });
    await deliveredCheck(ctx, "p4-mcp-meta-004-a", "leg a");
    ctx.check(a.finished && a.messageId !== undefined ? pass("leg a: the approved run finished with Always allow stored") : fail("leg a: the approved run did not finish"));
    if (a.messageId === undefined) return;

    const h0 = (await labState()).toolsHash;
    await labControl("/control/trigger");
    ctx.check((await labState()).toolsHash !== h0 ? pass("setup: the tool hash changed") : fail("setup: the tool hash did not change"));

    // Path 1: the same conversation, with the stored Always allow, after the change.
    let mark = lastSeq(await labLog());
    const b = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-004-b",
      prompt: "Echo (p4l3 meta-004 leg b).",
      tools: [ECHO],
      decide: REJECT,
      conversationId: a.conversationId,
      parentMessageId: a.messageId,
      agentId: a.agentId,
    });
    const ran1 = callsAfter(await labLog(), mark);
    const path1 = legVerdict("path 1 (same conversation, stored Always allow)", b, ran1);
    ctx.check(silentRun(b, ran1) ? expectedDefect(path1, stale("P4-MCP-META-004", "same conversation, after a hash change, a call ran with no approval asked")) : path1);

    // Path 2: a new conversation after the change.
    mark = lastSeq(await labLog());
    const c = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-004-c", prompt: "Echo (p4l3 meta-004 leg c).", tools: [ECHO], decide: REJECT });
    ctx.check(legVerdict("path 2 (new conversation)", c, callsAfter(await labLog(), mark)));

    // Path 3: a new LibreChat login after the change.
    mark = lastSeq(await labLog());
    const login2 = await getAdapter("librechat").authenticate();
    const d = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-004-d", prompt: "Echo (p4l3 meta-004 leg d).", tools: [ECHO], decide: REJECT, session: login2 });
    ctx.check(legVerdict("path 3 (new login)", d, callsAfter(await labLog(), mark)));
  } finally {
    await resetBoth();
  }
});

l3Case("P4-MCP-META-008", "mid-session description drift is detected and the later call waits for re-approval", async (ctx) => {
  const rt = runtime();
  await resetBoth();
  try {
    await labControl("/control/mode", { mode: "drift-mid-session" });
    const before = changedTools(labPin().tools, (await freshList("lab")).tools as ToolDef[]);
    ctx.check(before.length === 0 ? pass("setup: the served list matches the pin before the drift") : fail(`setup: the list already differs before the drift: ${before.join("; ")}`));

    const a = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-008-control", prompt: "Echo (p4l3 meta-008 control).", tools: [ECHO], decide: ALWAYS });
    ctx.check(a.finished && a.messageId !== undefined ? pass("leg 1: approved with Always allow, the run finished") : fail("leg 1: the approved run did not finish"));
    if (a.messageId === undefined) return;

    const h0 = (await labState()).toolsHash;
    await labControl("/control/trigger");
    const diff = changedTools(labPin().tools, (await freshList("lab")).tools as ToolDef[]);
    ctx.note(`snapshot diff after the drift: ${diff.join("; ") || "none"}`);
    ctx.check((await labState()).toolsHash !== h0 && diff.some((d) => d.startsWith("lab_echo"))
      ? pass("snapshot: the hash changed and the served lab_echo differs from the pin")
      : fail("snapshot: the drift did not show in the hash or the served list"));

    // Leg 2: the same conversation calls lab_echo after the drift. It must wait for approval, or it must not run.
    const mark = lastSeq(await labLog());
    const b = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-008-drift",
      prompt: "Echo (p4l3 meta-008 drift).",
      tools: [ECHO],
      decide: REJECT,
      conversationId: a.conversationId,
      parentMessageId: a.messageId,
      agentId: a.agentId,
    });
    await deliveredCheck(ctx, "p4-mcp-meta-008-drift", "leg 2");
    const ran2 = callsAfter(await labLog(), mark);
    const drift = legVerdict("leg 2 (after the drift, same conversation)", b, ran2);
    ctx.check(silentRun(b, ran2) ? expectedDefect(drift, stale("P4-MCP-META-008", "same conversation, after a description-only drift, a call ran with no approval asked")) : drift);
  } finally {
    await resetBoth();
  }
});

l3Case("P4-MCP-META-011", "a second server added after consent does not inherit Always allow", async (ctx) => {
  const rt = runtime();
  await resetBoth();
  try {
    // Leg 1: lab_echo on the first lab, approved with Always allow.
    const a = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-011-control", prompt: "Echo (p4l3 meta-011 control).", tools: [ECHO], decide: ALWAYS });
    const labRan = callsAfter(await labLog("lab"), 0);
    ctx.check(labRan.length === 1 ? pass("leg 1: the first lab ran its approved call once") : fail(`leg 1: expected one lab call, saw ${labRan.length}`));
    ctx.check(a.finished && a.messageId !== undefined ? pass("leg 1: the approved run finished with Always allow stored") : fail("leg 1: the approved run did not finish"));
    if (a.messageId === undefined) return;

    // Leg 2: the same conversation, with the second lab's tool attached (the second server is used for the first time).
    // The name is the same, the server is not. The stored Always allow is for the first server only.
    const mark2 = lastSeq(await labLog("lab2"));
    const b = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-meta-011-lab2",
      prompt: "Echo on the second server (p4l3 meta-011 lab2).",
      tools: [ECHO_LAB2],
      decide: REJECT,
      conversationId: a.conversationId,
      parentMessageId: a.messageId,
    });
    await deliveredCheck(ctx, "p4-mcp-meta-011-lab2", "leg 2");
    ctx.check(b.pauses.some((p) => p.calls.some((c) => c.name === ECHO_LAB2))
      ? pass(`leg 2: the second server's tool asked for approval (${pauseCount(b, ECHO_LAB2)} pause(s))`)
      : fail("leg 2: no approval was asked for the lab2 tool and no call was recorded: inconclusive (the stub may not have served the tool call; see the served turns)"));
    const lab2Ran = callsAfter(await labLog("lab2"), mark2);
    ctx.check(lab2Ran.length === 0 ? pass("leg 2: no lab2 call ran without a new approval") : fail(`leg 2: ${lab2Ran.length} lab2 call(s) ran without a new approval`));
  } finally {
    await resetBoth();
  }
});

// Not a case: a cleanup sweep and a leak check for this run. They run after the cases (declaration order) and skip without a stack.
const stackOn = process.env["P4_STACK_TESTS"] === "1";

test("cleanup sweep: both labs are back to the benign start with no mail in the sink", { skip: !stackOn }, async () => {
  await resetBoth();
  for (const which of ["lab", "lab2"] as const) {
    const st = await labState(which);
    assert.equal(st["mode"], "benign", `${which}: mode after the sweep`);
    assert.equal(st["triggered"], false, `${which}: triggered after the sweep`);
    assert.equal((await sinkRecords(which)).length, 0, `${which}: sink records after the sweep`);
  }
});

test("leak check: no session header and no lab control token appear in this run's evidence", { skip: !stackOn }, () => {
  const rt = runtime();
  const token = readFileSync(path.resolve(process.cwd(), ".harness", "lab", "control-token"), "utf8").trim();
  const secrets = [...rt.stack.secrets(), token].filter((s) => s.length >= 8);
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const text = readFileSync(full, "utf8");
        if (secrets.some((s) => text.includes(s))) hits.push(path.relative(process.cwd(), full));
      }
    }
  };
  // Every case writes under evidence/traces/<id>; the stack's container logs go under evidence/<run dir>. Walk all of it.
  walk(path.resolve(process.cwd(), "evidence"));
  assert.deepEqual(hits, [], "a secret value was written to evidence (file names only)");
});
