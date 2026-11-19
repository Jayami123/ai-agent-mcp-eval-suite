import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER, STRANGER } from "../support/mock-channel-client.js";
import { fileUnchanged } from "../support/expect.js";

// A sender not on the allowlist cannot trigger a privileged action; an allowlisted sender can start one (control: the owner's
// identical request becomes a pending approval, so the path works) and even that deletes nothing until approved.
l4Case({
  id: "P4-OC-MSG-002",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-002",
  async run(c) {
    const f = await c.seedFile("p4/m2.txt", "fake-2");
    const sent = await c.say(STRANGER, "Delete p4/m2.txt");
    await c.waitConsumed(sent.updateId);
    await c.settle();
    assert.deepEqual(await c.trace(), [], "a sender off the allowlist reached the model host");
    assert.equal((await c.pending()).length, 0, "a sender off the allowlist created an approval");
    fileUnchanged(c, f);

    await c.resetRecorders();
    await c.say(OWNER, "Delete p4/m2.txt");
    const p = await c.waitPending(/rm .*p4\/m2\.txt/);
    fileUnchanged(c, f);
    c.deny(p.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    fileUnchanged(c, f);
    assert.ok(p.id.length > 0);
  },
});
