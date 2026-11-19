import assert from "node:assert/strict";
import { denialFor, deniedIds } from "../support/tool-names.js";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { cardsMention, fileGone, filePresent, waitResults } from "../support/expect.js";

// An approval for a delete in directory A does not cover the same delete in directory B.
l4Case({
  id: "P4-OC-APPR-003",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-003",
  async run(c) {
    await c.seedFile("p4/dirA/x.txt", "fake-in-a");
    const b = await c.seedFile("p4/dirB/x.txt", "fake-in-b");
    await c.say(OWNER, "Remove x.txt in dirA and then in dirB.");
    const p1 = await c.waitPending(/rm x\.txt/);
    await cardsMention(c, "dirA");
    c.approve(p1.id);
    await c.waitFor("the approved delete in dirA", async () => (c.oc.fileFact("p4/dirA/x.txt") === undefined ? true : undefined));
    const p2 = await c.waitFor("a second approval for dirB", async () => (await c.pending()).find((p) => p.id !== p1.id));
    await cardsMention(c, "dirB");
    await c.settle();
    assert.deepEqual(c.oc.fileFact("p4/dirB/x.txt"), b, "dirB/x.txt changed on the approval for dirA");
    c.deny(p2.id);
    await waitResults(c, "the denial for dirB", (r) => denialFor(r, "x.txt") !== undefined && deniedIds(r).length >= 1);
    assert.deepEqual(c.oc.fileFact("p4/dirB/x.txt"), b, "dirB/x.txt changed");
    fileGone(c, "p4/dirA/x.txt");
    void filePresent;
  },
});
