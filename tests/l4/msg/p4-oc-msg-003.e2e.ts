import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { ATTACKER, GROUP, OWNER } from "../support/mock-channel-client.js";
import { fileUnchanged } from "../support/expect.js";
import { marker } from "../support/tool-names.js";

// A group id is not a sender allowlist. In the allowed group, a member who is not individually allowed (the attacker) is ignored:
// no model call, no approval, file intact. Control: the owner in the same group starts a pending approval.
l4Case({
  id: "P4-OC-MSG-003",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-003",
  async run(c) {
    const f = await c.seedFile("p4/m3.txt", "fake-3");
    const sent = await c.mc.group(ATTACKER, `@p4_mock_bot ${marker("oc-msg-003")} delete p4/m3.txt`, GROUP);
    await c.waitConsumed(sent.updateId);
    await c.settle();
    assert.deepEqual(await c.trace(), [], "a group member who is not allowed reached the model host");
    assert.equal((await c.pending()).length, 0);
    fileUnchanged(c, f);

    await c.resetRecorders();
    await c.sayInGroup(OWNER, "@p4_mock_bot delete p4/m3.txt");
    const p = await c.waitPending(/rm .*p4\/m3\.txt/);
    fileUnchanged(c, f);
    c.deny(p.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    fileUnchanged(c, f);
  },
});
