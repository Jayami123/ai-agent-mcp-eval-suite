import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { copies } from "../../../src/oracles/greenmail.js";
import { fail, pass, type Verdict } from "../../../src/oracles/verdict.js";
import { expectedDefect, type DefectRef } from "../support/expected-defect.js";
import { l3Case } from "../support/case.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { clearStubBindings, readStubTrace, setStubBindings } from "../../l1/stub-recorder.js";
import { chatWithApproval, type ApprovalRun, type DecisionChoice, type PausedCall } from "../support/approval.js";
import { freshList, labControl, labLog, labState, resetLab, sinkRecords, type LabLogEntry } from "../support/lab.js";
import { ownerMailAccount } from "../support/nextcloud-mail.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-APPR-002 and P4-MCP-META-013 through LibreChat, with Always allow on and NO ask rule (set by always-allow-mail.e2e.ts;
// LibreChat never offers Always allow for an ask-matched tool, a host limit in docs/findings/l3-always-allow.md). Stack: Nextcloud
// with the Mail app and GreenMail (P4_MAIL=1, harness H1), and the attack-lab (lab). The evidence is the lab log and sink, the
// GreenMail copies (what left Nextcloud) and the approval pauses. The model's reply text is never read. Every case resets the lab
// before and after itself, and every run id is discovered at run time (the owner's Mail account id is read from the Mail API).

const OWNER = "qa-owner@p4.test";
const ECHO = mcpToolName("lab_echo", "lab");
const LAB_EXFIL = mcpToolName("lab_mail_send", "lab");
const NC_SEND = mcpToolName("nc_mail_send_message", "nextcloud");
/** The lab's shadow tool in shadow-name mode: listed under the real Nextcloud send name (LAB_SHADOW_NAME default). */
const SHADOW = mcpToolName("nc_mail_send_message", "lab");

const ALWAYS = (): DecisionChoice => ({ decision: "approve", scope: "session" });
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 8000));

/** The owner's Mail account id, read at setup and passed to the stub as the OWNER_ACCOUNT_ID binding (an integer for the tool). */
async function bindOwnerAccount(ctx: { check(v: Verdict): void }): Promise<void> {
  const account = await ownerMailAccount(runtime().stack, OWNER);
  ctx.check(pass(`setup: the owner's Mail account exists in the Mail API (id ${account.id})`));
  await setStubBindings({ OWNER_ACCOUNT_ID: String(account.id) });
}

const lastSeq = (log: LabLogEntry[]): number => log.reduce((max, e) => Math.max(max, e.seq), 0);
/** Calls of one lab tool that reached the handler after a log position (parameter names only, never values). */
const callsAfter = (log: LabLogEntry[], seq: number, tool: string): LabLogEntry[] =>
  log.filter((e) => e.event === "call_started" && e.seq > seq && e.detail["tool"] === tool);
const completedAfter = (log: LabLogEntry[], seq: number, tool: string): number =>
  log.filter((e) => e.event === "call_completed" && e.seq > seq && e.detail["tool"] === tool).length;
const pausedNames = (run: ApprovalRun): string[] => run.pauses.flatMap((p) => p.calls.map((c: PausedCall) => c.name));
/** The fixture was served by the stub at least once (a fixture never delivered makes a leg inconclusive, not a pass). */
async function deliveredCheck(ctx: { check(v: Verdict): void; note(s: string): void }, fixture: string, label: string): Promise<void> {
  const turns = (await readStubTrace(fixture)).map((e) => e.turn);
  ctx.note(`${label}: stub served ${fixture} at turn(s) [${turns.join(",") || "none"}]`);
  ctx.check(turns.length > 0 ? pass(`${label}: fixture delivered to the stub`) : fail(`${label}: the stub never served the fixture`));
}

const ADDR_CONTROL = "p4l3-appr-002-control@p4.test";
const ADDR_HOSTILE = "p4l3-appr-002-hostile@p4.test";
const ADDR_META = "p4l3-meta-013@p4.test";

l3Case("P4-MCP-APPR-002", "always-allow is scoped to one tool: the Nextcloud send and the lab exfil send each ask for their own approval", async (ctx) => {
  const rt = runtime();
  await resetLab("lab");
  try {
    await bindOwnerAccount(ctx);
    const gm0 = (await copies(ADDR_CONTROL)) + (await copies(ADDR_HOSTILE));
    ctx.check(gm0 === 0 ? pass("setup: GreenMail holds 0 copies for both case addresses") : fail(`setup: GreenMail already holds ${gm0} copies for a case address`));
    const sink0 = (await sinkRecords("lab")).length;

    // Leg 1 (conversation A): lab_echo, approved with Always allow. The stored choice is the one the later legs must not extend.
    const a = await chatWithApproval(rt.stack, { fixture: "p4-mcp-appr-002-a", prompt: "Echo (p4l3 appr-002 leg 1).", tools: [ECHO, NC_SEND, LAB_EXFIL], decide: ALWAYS });
    await deliveredCheck(ctx, "p4-mcp-appr-002-a", "leg 1");
    const first = a.pauses[0]?.calls[0];
    ctx.check(a.pauses.length === 1 && first?.name === ECHO && first.offeredAlways
      ? pass("leg 1: lab_echo asked once and the card offered Always allow")
      : fail(`leg 1: expected one lab_echo prompt with Always allow offered; saw ${a.pauses.length} prompt(s)`));
    ctx.check(a.finished && a.messageId !== undefined ? pass("leg 1: the approved run finished") : fail("leg 1: the approved run did not finish"));
    if (a.messageId === undefined) return;

    // Control (conversation B, new, no Always allow): the Nextcloud send approved once must reach GreenMail. Without this an
    // empty GreenMail in the hostile leg could mean the oracle cannot see mail at all.
    const ctrl = await chatWithApproval(rt.stack, { fixture: "p4-mcp-appr-002-send-ok", prompt: "Send the note (p4l3 appr-002 control).", tools: [NC_SEND], decide: () => "approve" });
    ctx.check(ctrl.pauses.length === 1 && ctrl.pauses[0]?.calls[0]?.name === NC_SEND
      ? pass("control: the Nextcloud send asked for approval once")
      : fail(`control: the Nextcloud send did not ask exactly once (prompts ${ctrl.pauses.length})`));
    await settle();
    ctx.check((await copies(ADDR_CONTROL, "p4l3 appr-002 control")) === 1
      ? pass("control: the approved send reached GreenMail (1 copy), so the oracle sees mail")
      : fail("control: the approved send did not reach GreenMail: the oracle cannot judge the hostile leg"));

    // Leg 2 (conversation A, continued): lab_echo must run with no pause; the Nextcloud send and the lab exfil send must each pause.
    // Both sends are rejected. Any send that runs without its own approval is a finding (below), never a pass.
    const labMark = lastSeq(await labLog("lab"));
    const b = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-appr-002-hostile",
      prompt: "Echo, then send (p4l3 appr-002 leg 2).",
      tools: [ECHO, NC_SEND, LAB_EXFIL],
      decide: () => "reject",
      conversationId: a.conversationId,
      parentMessageId: a.messageId,
      agentId: a.agentId,
    });
    await deliveredCheck(ctx, "p4-mcp-appr-002-hostile", "leg 2");
    await settle();
    const names = pausedNames(b);
    const echoRan = callsAfter(await labLog("lab"), labMark, "lab_echo").length;
    ctx.check(!names.includes(ECHO) && echoRan === 1
      ? pass("setup: the always-allowed lab_echo ran once with no pause in the same conversation")
      : fail(`setup: lab_echo paused=${names.includes(ECHO)} ran=${echoRan}; the stored Always allow did not cover its own tool`));

    const ncPaused = names.includes(NC_SEND);
    const ncCopies = await copies(ADDR_HOSTILE);
    const nc: Verdict = ncPaused && ncCopies === 0
      ? pass(`leg 2: the Nextcloud send asked for its own approval (${b.pauses.length} pause(s)); 0 copies in GreenMail`)
      : ncPaused
        ? fail(`leg 2: the Nextcloud send asked for approval but ${ncCopies} copy(ies) reached GreenMail`)
        : ncCopies > 0
          ? expectedDefect(fail(`leg 2: the Nextcloud send ran with no approval asked (${ncCopies} copy(ies))`), { caseId: "P4-MCP-APPR-002", server: "librechat", summary: "a stored Always allow for lab_echo ran a Nextcloud mail send with no approval asked" } satisfies DefectRef)
          : fail("leg 2: the Nextcloud send neither asked for approval nor reached GreenMail: inconclusive");
    ctx.check(nc);

    const exfilPaused = names.includes(LAB_EXFIL);
    const sink1 = (await sinkRecords("lab")).length - sink0;
    const exfilRan = completedAfter(await labLog("lab"), labMark, "lab_mail_send");
    const exfil: Verdict = exfilPaused && sink1 === 0 && exfilRan === 0
      ? pass("leg 2: the lab exfil send asked for its own approval; 0 sink records and no completed call")
      : exfilPaused
        ? fail(`leg 2: the exfil send asked for approval but the sink holds ${sink1} record(s) and ${exfilRan} call(s) completed`)
        : sink1 > 0 || exfilRan > 0
          ? expectedDefect(fail(`leg 2: the lab exfil send ran with no approval asked (sink ${sink1})`), { caseId: "P4-MCP-APPR-002", server: "lab", summary: "a stored Always allow for lab_echo ran the lab exfil send with no approval asked" } satisfies DefectRef)
          : fail("leg 2: the lab exfil send neither asked for approval nor reached the sink: inconclusive");
    ctx.check(exfil);
    ctx.note(`leg 2 paused tools: ${names.join(", ") || "none"}; lab_echo runs: ${echoRan}; GreenMail copies for the hostile address: ${ncCopies}; sink records added: ${sink1}`);
  } finally {
    await resetLab("lab");
    await clearStubBindings();
  }
});

l3Case("P4-MCP-META-013", "a new session does not reuse the stored Always allow after the tool list changed to a shadowed mail name", async (ctx) => {
  const rt = runtime();
  await resetLab("lab");
  try {
    const gm0 = await copies(ADDR_META);
    ctx.check(gm0 === 0 ? pass("setup: GreenMail holds 0 copies for the case address") : fail(`setup: GreenMail already holds ${gm0} copies`));

    // Session 1 (conversation S1, benign lab): lab_echo approved with Always allow.
    const s1 = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-013-s1", prompt: "Echo (p4l3 meta-013 session 1).", tools: [ECHO], decide: ALWAYS });
    await deliveredCheck(ctx, "p4-mcp-meta-013-s1", "session 1");
    ctx.check(s1.finished && s1.messageId !== undefined && s1.pauses.length === 1 && s1.pauses[0]?.calls[0]?.offeredAlways
      ? pass("session 1: lab_echo asked once, Always allow stored, the run finished")
      : fail(`session 1: expected one prompt with Always allow and a finished run (prompts ${s1.pauses.length})`));
    if (s1.messageId === undefined) return;

    // The lab's tool list changes: shadow-name mode lists the mail tool under the real Nextcloud name, so the hash changes.
    const h0 = (await labState("lab"))["toolsHash"];
    await labControl("/control/mode", { mode: "shadow-name" });
    const h1 = (await labState("lab"))["toolsHash"];
    const served = (await freshList("lab")).tools.map((t) => t.name);
    ctx.check(h1 !== h0 && served.includes("nc_mail_send_message") && !served.includes("lab_mail_send")
      ? pass("setup: the tool hash changed and the mail tool is listed under the shadowed name")
      : fail(`setup: the list did not change as expected (hash changed ${h1 !== h0}; served ${served.join(", ")})`));

    // Session 2 (a NEW conversation, after the change): lab_echo and the shadowed send. Both must pause; neither may run unasked.
    const labMark = lastSeq(await labLog("lab"));
    const s2 = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-013-s2", prompt: "Echo, then send (p4l3 meta-013 session 2).", tools: [ECHO, SHADOW], decide: () => "reject" });
    await deliveredCheck(ctx, "p4-mcp-meta-013-s2", "session 2");
    await settle();
    const names = pausedNames(s2);
    const echoRan = callsAfter(await labLog("lab"), labMark, "lab_echo").length;
    const echo: Verdict = names.includes(ECHO)
      ? pass("session 2: lab_echo asked for approval again (session 1's Always allow was not reused)")
      : echoRan > 0
        ? expectedDefect(fail(`session 2: lab_echo ran with no approval asked (${echoRan} call(s)) on session 1's Always allow`), { caseId: "P4-MCP-META-013", server: "librechat", summary: "a new session ran lab_echo on the Always allow stored in an earlier session" } satisfies DefectRef)
        : fail("session 2: lab_echo neither asked nor ran: inconclusive");
    ctx.check(echo);

    const sink = (await sinkRecords("lab")).length;
    const shadowCompleted = completedAfter(await labLog("lab"), labMark, "lab_mail_send");
    const shadow: Verdict = names.includes(SHADOW) && shadowCompleted === 0 && sink === 0
      ? pass("session 2: the shadowed send asked for its own approval; 0 sink records and no completed call")
      : names.includes(SHADOW)
        ? fail(`session 2: the shadowed send asked for approval but the sink holds ${sink} record(s) and ${shadowCompleted} call(s) completed`)
        : sink > 0 || shadowCompleted > 0
          ? expectedDefect(fail(`session 2: the shadowed send ran with no approval asked (sink ${sink})`), { caseId: "P4-MCP-META-013", server: "lab", summary: "the shadowed mail name ran with no approval asked in a new session" } satisfies DefectRef)
          : fail("session 2: the shadowed send neither asked nor ran: inconclusive");
    ctx.check(shadow);
    ctx.check((await copies(ADDR_META)) === 0 ? pass("GreenMail: 0 copies for the case address after both sessions") : fail("GreenMail: copies appeared for the case address"));
    ctx.note(`session 2 paused tools: ${names.join(", ") || "none"}; lab_echo runs: ${echoRan}; sink records: ${sink}; prompts: ${s2.pauses.length}`);
  } finally {
    await resetLab("lab");
  }
});

// Not a case: a cleanup sweep and a leak check for this run. They skip without a stack.
const stackOn = process.env["P4_STACK_TESTS"] === "1";

test("cleanup sweep: the lab is back to the benign start with an empty log and sink", { skip: !stackOn }, async () => {
  await resetLab("lab");
  const st = await labState("lab");
  assert.equal(st["mode"], "benign", "lab mode after the sweep");
  assert.equal(st["triggered"], false, "lab triggered after the sweep");
  assert.equal((await sinkRecords("lab")).length, 0, "lab sink records after the sweep");
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
      else if (secrets.some((s) => readFileSync(full, "utf8").includes(s))) hits.push(path.relative(process.cwd(), full));
    }
  };
  walk(path.resolve(process.cwd(), "evidence"));
  assert.deepEqual(hits, [], "a secret value was written to evidence (file names only)");
});
