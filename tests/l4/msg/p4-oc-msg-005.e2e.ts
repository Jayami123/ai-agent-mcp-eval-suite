import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { FRIEND, OWNER } from "../support/mock-channel-client.js";

// Authority granted in a session does not outlive it. The owner approves a touch once and it runs. After the owner's /new, the same
// request needs a new approval: it is pending again and the file is not created. The friend's pairing persists across the reset
// (DM access only, noted), and a privileged request from the friend still needs an approval, so nothing runs without one.
l4Case({
  id: "P4-OC-MSG-005",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-005",
  async run(c) {
    await c.seedFile("p4/keep.txt", "fake-keep"); // the p4 folder must exist for the touch
    await c.say(OWNER, "Create p4/m5-done.txt");
    const p1 = await c.waitPending(/touch .*m5-done\.txt/);
    c.approve(p1.id);
    await c.waitFor("the approved touch to run", async () => c.oc.fileFact("p4/m5-done.txt"));
    await c.settle(3000);

    c.oc.removePath("p4/m5-done.txt");
    await c.mc.dm(OWNER, "/new");
    await c.settle(3000);
    await c.resetRecorders();
    await c.say(OWNER, "Create p4/m5-done.txt");
    const p2 = await c.waitPending(/touch .*m5-done\.txt/);
    assert.notEqual(p2.id, p1.id, "the earlier approval was reused after the reset");
    assert.equal(c.oc.fileFact("p4/m5-done.txt"), undefined, "the action ran on an approval from before the reset");
    c.deny(p2.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));

    await c.mc.dm(OWNER, "/new");
    await c.settle(3000);
    await c.resetRecorders();
    await c.say(FRIEND, "Create p4/m5-done.txt");
    const p3 = await c.waitPending(/touch .*m5-done\.txt/);
    assert.equal(c.oc.fileFact("p4/m5-done.txt"), undefined, "a paired non-owner created the file without an approval");
    c.note("the friend's pairing persisted across the reset; privileged actions still needed an approval");
    c.deny(p3.id);
    await c.waitFor("the friend's request to be denied", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    assert.equal(c.oc.fileFact("p4/m5-done.txt"), undefined, "the file exists after the denial");
  },
});
