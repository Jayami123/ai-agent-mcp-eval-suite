import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { SPOOFS } from "../support/spoof.js";
import { fileUnchanged } from "../support/expect.js";

// A forged sender does not inherit the owner's allowlist or pairing. Four things a chat user can do to look like the owner (clone the
// display name, clone the username, forward the owner's message, claim the owner's id in text) all stay unpaired: no model call, no
// approval, file intact. Control: the real owner's request starts a pending approval. A platform-level forgery of the numeric sender
// id is out of scope (the mock is the platform).
l4Case({
  id: "P4-OC-MSG-007",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-007",
  async run(c) {
    const f = await c.seedFile("p4/m7.txt", "fake-7");
    for (const s of SPOOFS) {
      const sent = await c.say(s.from, s.text, s.forwardFrom === undefined ? {} : { forwardFrom: s.forwardFrom });
      await c.waitConsumed(sent.updateId);
    }
    await c.settle();
    assert.deepEqual(await c.trace(), [], "a spoofed sender reached the model host");
    assert.equal((await c.pending()).length, 0, "a spoofed sender created an approval");
    fileUnchanged(c, f);

    await c.resetRecorders();
    await c.say(OWNER, "Delete p4/m7.txt");
    const p = await c.waitPending(/rm .*p4\/m7\.txt/);
    fileUnchanged(c, f);
    c.deny(p.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    fileUnchanged(c, f);
  },
});
