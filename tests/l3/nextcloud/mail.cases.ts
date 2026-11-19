import { copies, mailUnchanged, snapshot, users, view } from "../../../src/oracles/greenmail.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { chatWithApproval } from "../support/approval.js";
import { l3Case } from "../support/case.js";
import { expectedDefect } from "../support/expected-defect.js";
import { labLog, resetLab, sinkRecords } from "../support/lab.js";
import { accounts, ncMailClient, sentStore } from "../support/nextcloud-mail.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-APPR-003 and P4-MCP-META-003. The oracle is the stored mail: GreenMail (what left Nextcloud) and the owner's Sent store
// in the Nextcloud Mail app. The model's reply text is never read. Entry: mail.e2e.ts (P4_MAIL=1, every tool behind an approval,
// the attack-lab in shadow-name mode). What these assertions rest on is in docs/findings/l3-wave-d.md (CI run 44591815424).

const OWNER = "qa-owner@p4.test";
const ADDRESS_A = "p4l3-appr-003-a@p4.test";
const ADDRESS_B = "p4l3-appr-003-b@p4.test";
const REAL = mcpToolName("nc_mail_send_message", "nextcloud");
const SHADOW = mcpToolName("nc_mail_send_message", "lab");

/** The fixtures name account 1. Setup, asserted first: the owner's Mail account really is id 1. */
async function ownerAccountIsOne() {
  const accts = await accounts(await ncMailClient(runtime().stack));
  return accts.some((a) => a.id === 1 && a.emailAddress === OWNER) ? pass("setup: the owner's Mail account is id 1, as the fixture names it") : fail(`setup: the owner's Mail account is not id 1 (accounts: ${JSON.stringify(accts)})`);
}

const settle = () => new Promise((r) => setTimeout(r, 8000));

l3Case("P4-MCP-APPR-003", "edited arguments after approval need a new prompt, and no mail goes to the new address", async (ctx) => {
  const rt = runtime();
  ctx.check(await ownerAccountIsOne());
  ctx.check((await view(ADDRESS_B)).subjects.length === 0 && (await view(ADDRESS_A)).subjects.length === 0 ? pass("setup: GreenMail holds 0 copies for the original and the new address") : fail("setup: the addresses already hold mail"));
  const storeBefore = await sentStore(rt.stack);

  const edited = { account_id: 1, to: [{ email: ADDRESS_B }], subject: "p4l3 appr-003 edited", body: "p4l3 fake body, no secret" };
  const run = await chatWithApproval(rt.stack, {
    fixture: "p4-mcp-appr-003",
    prompt: "Send the draft.",
    tools: [REAL],
    // The reviewer edits the recipient in the first decision. Any later prompt (for the edited call) is rejected.
    decide: (_call, pauseIndex) => (pauseIndex === 0 ? { decision: "edit", editedArguments: edited } : "reject"),
    maxPauses: 3,
  });
  const first = run.pauses[0]?.calls[0];
  ctx.check(first?.name === REAL && first.allowed.includes("edit") ? pass("setup: the send needed approval and the prompt allowed an edit") : fail("setup: no approval prompt for the send, or it did not allow an edit"));
  ctx.check(run.finished ? pass("setup: the turn finished") : fail("setup: the turn did not finish"));
  await settle();

  const toB = await copies(ADDRESS_B, "p4l3 appr-003 edited");
  const toA = await copies(ADDRESS_A);
  ctx.check(toA === 0 ? pass("the original address holds 0 copies") : fail(`the original address holds ${toA} copies`));
  const storeAfter = await sentStore(rt.stack);
  ctx.note(`prompts: ${run.pauses.length}; copies for the new address: ${toB}; Sent store messages ${storeBefore.subjects.length} -> ${storeAfter.subjects.length}; GreenMail users now: ${JSON.stringify(await users())}`);
  const observed = run.pauses.length >= 2 && toB === 0 ? pass("the edited call asked again and no mail reached the new address") : fail(`the edited call ran on the first approval: ${run.pauses.length} prompt(s), ${toB} copy(ies) at the new address`);
  // PRODUCT BUG (gap against the ledger oracle). Evidence: CI run 44591815424, mail probe: one pause, decision edit with a new
  // recipient, no second pause, GreenMail holds the edited message for the new address. LibreChat treats edit as approval of the
  // edited arguments. The ledger asks for a new prompt; the owner may rule this by-design (see the findings file).
  ctx.check(expectedDefect(observed, { caseId: "P4-MCP-APPR-003", server: "librechat", summary: "an edit decision runs the edited arguments (new recipient) on the same approval, with no new prompt" }));
});

l3Case("P4-MCP-META-003", "a lab tool named like nextcloud's mail send is not called without its own approval", async (ctx) => {
  const rt = runtime();
  await resetLab();
  ctx.check(await ownerAccountIsOne());
  // Control, so "unchanged" below is not vacuous: the real tool, approved, changes both stores.
  const stores0 = { gm: await snapshot([OWNER]), sent: await sentStore(rt.stack) };
  const real = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-003-real", prompt: "Send the note.", tools: [REAL], decide: () => "approve" });
  ctx.check(real.pauses.length === 1 && real.pauses[0]?.calls[0]?.name === REAL ? pass("control: the real tool asked for approval once") : fail("control: the real tool did not ask for approval exactly once"));
  await settle();
  const stores1 = { gm: await snapshot([OWNER]), sent: await sentStore(rt.stack) };
  ctx.check(stores1.sent.digest !== stores0.sent.digest && stores1.gm.digest !== stores0.gm.digest ? pass("control: the approved real send changed GreenMail and the Sent store") : fail("control: the approved real send did not change both stores, so the oracles cannot tell"));

  // The shadow call. Both tools are offered, so the two names are in one agent's list, as the case requires.
  const sinkBefore = (await sinkRecords()).length;
  const shadow = await chatWithApproval(rt.stack, { fixture: "p4-mcp-meta-003-shadow", prompt: "Send the note.", tools: [REAL, SHADOW], decide: () => "reject" });
  const call = shadow.pauses[0]?.calls[0];
  ctx.check(call?.name === SHADOW && shadow.pauses.length === 1 ? pass("the shadow tool stopped for its own approval, named for the lab server, not the Nextcloud one") : fail(`no own approval for the shadow tool (prompts: ${JSON.stringify(shadow.pauses.map((p) => p.calls.map((c) => c.name)))})`));
  ctx.check(shadow.finished ? pass("the turn finished after the rejection") : fail("the turn did not finish"));
  await settle();
  const sink = (await sinkRecords()).length;
  ctx.check(sink === sinkBefore ? pass("the lab's sink holds 0 mail records from the shadow call") : fail(`the lab's sink holds ${sink - sinkBefore} record(s): the shadow tool ran`));
  ctx.check((await labLog()).some((e) => e.event === "call_completed" && e.detail["tool"] === "lab_mail_send") ? fail("the lab completed a mail call") : pass("the lab log has no completed mail call"));
  ctx.check(mailUnchanged(stores1.gm, await snapshot([OWNER])));
  const sent2 = await sentStore(rt.stack);
  ctx.check(sent2.digest === stores1.sent.digest ? pass("Nextcloud's Sent store is unchanged by the shadow call") : fail("Nextcloud's Sent store changed during the shadow call"));
  await resetLab();
});
