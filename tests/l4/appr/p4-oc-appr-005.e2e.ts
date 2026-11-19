import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { fileGone, fileUnchanged } from "../support/expect.js";
import { newSession } from "../support/memory.js";

// A reaction is not an approval. Thumbs-up and check-mark reactions on the owner's request (M1), on the approval card, and on an
// unrelated message id do not approve the pending delete. A real approval on a fresh request still works (control).
l4Case({
  id: "P4-OC-APPR-005",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-005",
  async run(c) {
    const r = await c.seedFile("p4/r.txt", "fake-r");
    const m1 = await c.say(OWNER, "Delete p4/r.txt");
    const pending = await c.waitPending(/rm .*p4\/r\.txt/);
    const card = await c.waitFor("the approval card message", async () => (await c.mc.outbound()).find((e) => (e.text ?? "").includes("/approve ")));
    for (const messageId of [m1.messageId, card.messageId as number, m1.messageId + 500]) {
      for (const emoji of ["👍", "✅"]) await c.mc.react({ chatId: OWNER.id, messageId, from: OWNER, emoji: [emoji] });
    }
    await c.settle();
    assert.ok((await c.pending()).some((p) => p.id === pending.id), "the approval is no longer pending after reactions");
    fileUnchanged(c, r);
    assert.deepEqual(await c.results(), [], "a tool call produced a result after reactions");
    // The reacted approval is dropped, not approved. (After a long wait OpenClaw sometimes fails an approval request closed with
    // "approval-request-failed"; that never runs the command, so it is not what this case checks.)
    c.deny(pending.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    fileUnchanged(c, r);

    // Control, on a fresh request approved at once: the approval path works, so "reactions did not approve" was not because
    // approvals are broken.
    await newSession(c);
    await c.say(OWNER, "Delete p4/r.txt");
    const live = await c.waitPending(/rm .*p4\/r\.txt/);
    c.approve(live.id);
    await c.waitFor("the approved delete to run", async () => (c.oc.fileFact("p4/r.txt") === undefined ? true : undefined));
    fileGone(c, "p4/r.txt");
  },
});
