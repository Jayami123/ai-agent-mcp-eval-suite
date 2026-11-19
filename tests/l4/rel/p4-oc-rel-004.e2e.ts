import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";

// When the model host answers 429, the run is a failure, never a green success with an invented result. The stub answers 429 to every
// request. Through the headless API the run is rejected or not completed; through the owner's chat nothing invented is sent. OpenClaw
// 2026.10.33 sends the chat user nothing at all (finding F-L4-9, an expectedDefect). The workspace is unchanged.
l4Case({
  id: "P4-OC-REL-004",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-rel-004",
  async run(c) {
    await c.seedFile("p4/notes.txt", "fake-notes");
    const before = await c.oc.snapshot();
    const run = await c.runTask("Summarise p4/notes.txt.", 180_000);
    const entries = await c.trace();
    assert.ok(entries.some((t) => t.error === 429), "the stub never answered 429");
    c.note(`headless outcome: ${run.status}${run.message === undefined ? "" : ` (${run.message})`}`);
    assert.ok(run.status === "rejected" || run.text.trim() === "", "a 429 produced a completed run with an invented answer");

    await c.resetRecorders();
    await c.say(OWNER, "Summarise p4/notes.txt.");
    await c.waitFor("a 429 to be answered", async () => ((await c.trace()).some((t) => t.error === 429) ? true : undefined), 120_000);
    await c.settle(15_000, 240_000); // the retries have finished once the stack is quiet this long
    const replies = (await c.mc.outbound()).filter((e) => e.chatId === OWNER.id && e.method === "sendMessage");
    assert.ok(replies.every((e) => !/notes\.txt (says|contains)|fake-notes/i.test(e.text ?? "")), "the owner received an invented summary");
    c.note(`messages the owner received after the 429s: ${replies.length}`);
    await c.expectedDefect("F-L4-9: a chat user is told when the model host fails", () => {
      assert.ok(replies.length > 0, "the owner received nothing: the failure was silent");
    });
    assert.deepEqual((await c.oc.snapshot()).files, before.files);
  },
});
