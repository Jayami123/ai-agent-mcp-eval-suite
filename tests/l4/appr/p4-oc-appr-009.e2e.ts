import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { STRANGER } from "../support/mock-channel-client.js";
import { fileUnchanged, noPending } from "../support/expect.js";

// Pairing is required before a privileged action from a new sender. An unpaired sender's request never reaches the model: the stub
// sees no request, nothing is pending, the file is intact, and OpenClaw answered with a pairing prompt (the control that the
// message was received and handled).
l4Case({
  id: "P4-OC-APPR-009",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-009",
  async run(c) {
    const n = await c.seedFile("p4/n.txt", "fake-n");
    const sent = await c.say(STRANGER, "Delete p4/n.txt");
    await c.waitConsumed(sent.updateId); // OpenClaw received and acknowledged the message, so the checks below cannot be a missed update
    await c.settle();
    assert.deepEqual(await c.trace(), [], "the model host was called for an unpaired sender");
    // OpenClaw sends the pairing prompt once per sender per hour, so a rerun may have none; the pending request is the lasting proof.
    const prompt = (await c.mc.outbound()).find((e) => e.chatId === STRANGER.id);
    if (prompt !== undefined) assert.match(prompt.text ?? "", /Pairing code/i);
    await noPending(c);
    fileUnchanged(c, n);
    assert.ok(c.oc.pairingPending().some((q) => q.id === String(STRANGER.id)), "OpenClaw has no pending pairing request for the sender");
  },
});
