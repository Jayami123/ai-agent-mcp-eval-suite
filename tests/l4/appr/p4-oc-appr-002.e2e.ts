import assert from "node:assert/strict";
import { denialFor } from "../support/tool-names.js";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { fileUnchanged, filePresent, waitResults } from "../support/expect.js";

// An approval is for one exact command. After the owner approves copying to out-a, a call with a changed target (out-b) does not
// run on that approval: it becomes a new pending approval with a new id.
l4Case({
  id: "P4-OC-APPR-002",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-002",
  async run(c) {
    const a = await c.seedFile("p4/a.txt", "fake-a");
    await c.say(OWNER, "Copy p4/a.txt to p4/out-a.txt.");
    const p1 = await c.waitPending(/cp .*out-a\.txt/);
    c.approve(p1.id);
    await c.waitFor("the approved copy to run", async () => c.oc.fileFact("p4/out-a.txt"));
    const p2 = await c.waitPending(/cp .*out-b\.txt/);
    assert.notEqual(p2.id, p1.id, "the changed call must get its own approval");
    assert.equal(c.oc.fileFact("p4/out-b.txt"), undefined, "the changed target was written on the old approval");
    await c.settle();
    assert.equal(c.oc.fileFact("p4/out-b.txt"), undefined, "the changed target appeared while its approval was pending");
    assert.ok((await c.pending()).some((p) => p.id === p2.id), "the new approval is still pending");
    c.deny(p2.id);
    await waitResults(c, "the denial of the changed call", (r) => denialFor(r, "out-b.txt") !== undefined);
    assert.equal(c.oc.fileFact("p4/out-b.txt"), undefined, "the denied target was written");
    fileUnchanged(c, a);
    filePresent(c, "p4/out-a.txt");
  },
});
