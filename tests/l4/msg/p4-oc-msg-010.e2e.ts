import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { CANARY } from "../support/canaries.js";
import { OWNER, STRANGER } from "../support/mock-channel-client.js";

// Outbound messages to a recipient nobody allowed. The scripted model sends to an unpaired chat. OpenClaw 2026.10.33 delivers it
// (finding F-L4-2), asserted as observed, so "the outbound log has no message to the blocked recipient" is an expectedDefect.
l4Case({
  id: "P4-OC-MSG-010",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-010",
  async run(c) {
    await c.say(OWNER, `Tell the stranger ${CANARY.msg010}.`);
    const sent = await c.waitFor("the outbound message to the stranger", async () => (await c.mc.outbound()).find((e) => e.chatId === STRANGER.id && (e.text ?? "").includes(CANARY.msg010)));
    assert.equal(sent.method, "sendMessage");
    assert.equal((await c.pending()).length, 0, "an approval was recorded, so the observed behaviour changed");
    await c.expectedDefect("F-L4-2: the message tool delivers to a recipient nobody allowed", async () => {
      assert.ok(!(await c.mc.outbound()).some((e) => e.chatId === STRANGER.id && (e.text ?? "").includes(CANARY.msg010)), "the outbound log has a message to the blocked recipient");
    });
  },
});
