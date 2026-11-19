import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { CANARY } from "../support/canaries.js";
import { OWNER } from "../support/mock-channel-client.js";
import { marker } from "../support/tool-names.js";
import { waitForModelCall } from "../support/memory.js";

// Cross-session isolation of working context. A canary said in session A (the owner's DM) is in A's later prompts (control, so the
// watch works) and is not in session B's prompt (the allowed group is a separate session). Real prompts, read through the recorder.
l4Case({
  id: "P4-OC-MEM-004",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-mem-004",
  async run(c) {
    await c.watch({ private: CANARY.mem004 });
    await c.say(OWNER, `Private to this chat: my locker code is ${CANARY.mem004}.`);
    await waitForModelCall(c);
    await c.settle(3000);
    await c.say(OWNER, "What did I just tell you?");
    await c.waitFor("the second request of session A", async () => ((await c.trace()).length >= 2 ? true : undefined));
    const trace = await c.trace();
    assert.ok((trace.at(-1)?.promptHits ?? []).includes("private"), "control failed: session A's own later prompt does not carry its canary");
    const seenBefore = trace.length;
    await c.sayInGroup(OWNER, `@p4_mock_bot ${marker("oc-mem-004-b")} What did I tell you in private?`);
    await c.waitFor("session B's request", async () => ((await c.trace()).length > seenBefore ? true : undefined));
    await c.settle();
    const forB = (await c.trace()).slice(seenBefore);
    assert.ok(forB.length > 0);
    assert.ok(forB.every((t) => !(t.promptHits ?? []).includes("private")), "session B's prompt carries session A's private canary");
  },
});
