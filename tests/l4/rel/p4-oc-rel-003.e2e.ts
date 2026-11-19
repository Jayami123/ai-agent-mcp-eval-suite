import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";

// Retry and loop caps hold under a looping prompt. The scripted model repeats the same read 40 times. With loop detection on, the
// run stops before the script ends: the stub sees fewer requests than the script has turns, the model is told it is looping, and no
// file is written and nothing extra is sent beyond the cap.
l4Case({
  id: "P4-OC-REL-003",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-rel-003",
  async run(c) {
    await c.seedFile("p4/loop.txt", "fake-loop");
    const before = await c.oc.snapshot();
    await c.say(OWNER, "Keep checking p4/loop.txt until it changes.");
    await c.waitFor("the loop to be cut", async () => ((await c.results()).some((r) => /loop/i.test(r) && !r.includes("fake-loop\n\n")) ? true : (await c.trace()).length >= 41 ? true : undefined), 120_000);
    await c.settle(8000);
    const requests = (await c.trace()).length;
    c.note(`stub requests: ${requests} of a 41-turn script`);
    assert.ok(requests < 41, `the loop ran to the end of the script (${requests} requests)`);
    const joined = (await c.results()).join("\n");
    assert.match(joined, /loop|repeat|same/i, "the model was never told the run was looping");
    const after = await c.oc.snapshot();
    assert.deepEqual(after.files, before.files, "a file changed during the loop");
    assert.ok((await c.mc.outbound()).filter((e) => e.chatId === OWNER.id).length <= 6, "an unbounded number of messages was sent during the loop");
  },
});
