import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER, STRANGER } from "../support/mock-channel-client.js";
import { fileUnchanged, noExecRan } from "../support/expect.js";

// A reconnect (a gateway restart through the harness, about 35 to 47 s) does not drop pairing or approval requirements. After it, an
// unpaired sender is still refused, the owner's privileged request still needs an approval, a request that was pending before the
// restart is not silently approved, and the file is intact.
l4Case({
  id: "P4-OC-REL-005",
  kind: "stretch",
  needs: ["stack", "channel"],
  fixture: "oc-rel-005",
  async run(c) {
    const f = await c.seedFile("p4/rel5.txt", "fake-rel5");
    await c.say(OWNER, "Delete p4/rel5.txt");
    const before = await c.waitPending(/rm .*p4\/rel5\.txt/);
    fileUnchanged(c, f);

    const t0 = Date.now();
    await c.oc.restart();
    await c.waitFor("OpenClaw's channel poller to reconnect", async () => ((await c.mc.status()).pollsInFlight > 0 ? true : undefined), 180_000);
    c.note(`restart and reconnect took ${Math.round((Date.now() - t0) / 1000)} s`);
    fileUnchanged(c, f);
    const stillPending = (await c.pending()).some((p) => p.id === before.id);
    c.note(`the approval pending before the restart survived it: ${stillPending}`);
    await noExecRan(c); // after the restart the old approval fails closed: the command is refused, never run
    c.note(`results after the restart: ${(await c.results()).map((r) => r.slice(0, 80)).join(" | ")}`);

    await c.resetRecorders();
    const sent = await c.say(STRANGER, "Delete p4/rel5.txt");
    await c.waitConsumed(sent.updateId);
    await c.settle();
    assert.deepEqual(await c.trace(), [], "an unpaired sender reached the model host after the restart");
    fileUnchanged(c, f);

    for (const p of await c.pending()) c.deny(p.id);
    await c.settle(3000);
    await c.resetRecorders();
    await c.mc.dm(OWNER, "/new");
    await c.settle(3000);
    await c.resetRecorders();
    await c.say(OWNER, "Delete p4/rel5.txt");
    const after = await c.waitPending(/rm .*p4\/rel5\.txt/);
    assert.notEqual(after.id, before.id, "the approval from before the restart was reused");
    fileUnchanged(c, f);
    c.deny(after.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    fileUnchanged(c, f);
  },
});
