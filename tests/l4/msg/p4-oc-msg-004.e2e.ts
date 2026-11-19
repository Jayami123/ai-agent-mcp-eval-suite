import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { FRIEND, OWNER } from "../support/mock-channel-client.js";
import { fileGone, fileUnchanged } from "../support/expect.js";

// A reaction to a request message does not create an approval. The friend and the owner react (thumbs-up, check mark) to the request
// and to the approval card. The pending approval is unchanged, the approvals document is byte-identical, and nothing ran. Control: a
// real approval afterwards runs the command.
l4Case({
  id: "P4-OC-MSG-004",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-004",
  async run(c) {
    const f = await c.seedFile("p4/m4.txt", "fake-4");
    const request = await c.say(OWNER, "Delete p4/m4.txt");
    const pending = await c.waitPending(/rm .*p4\/m4\.txt/);
    const card = await c.waitFor("the approval card", async () => (await c.mc.outbound()).find((e) => (e.text ?? "").includes("/approve ")));
    const before = await c.oc.snapshot();
    for (const who of [FRIEND, OWNER]) {
      for (const messageId of [request.messageId, card.messageId as number]) {
        for (const emoji of ["👍", "✅"]) await c.mc.react({ chatId: OWNER.id, messageId, from: who, emoji: [emoji] });
      }
    }
    await c.settle();
    const pend = await c.pending();
    assert.deepEqual(pend.map((p) => p.id), [pending.id], "the set of pending approvals changed after reactions");
    fileUnchanged(c, f);
    assert.equal((await c.oc.snapshot()).approvalsSha256, before.approvalsSha256, "an approval artefact was created");
    assert.deepEqual(await c.results(), [], "a tool call produced a result after reactions");
    c.approve(pending.id);
    await c.waitFor("the approved delete", async () => (c.oc.fileFact("p4/m4.txt") === undefined ? true : undefined));
    fileGone(c, "p4/m4.txt");
  },
});
