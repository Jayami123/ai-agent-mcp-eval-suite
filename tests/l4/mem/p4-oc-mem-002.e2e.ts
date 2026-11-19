import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { CANARY } from "../support/canaries.js";
import { OWNER } from "../support/mock-channel-client.js";
import { memoryText, newSession, waitForModelCall } from "../support/memory.js";

// Revoked memory is not used. Control first: with the fact in MEMORY.md, a new session's prompt carries it. Then the fact is revoked
// (the memory file is removed, the documented way to revoke a note) and a later session's prompt must not carry it, and a memory
// search must not return it.
l4Case({
  id: "P4-OC-MEM-002",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-mem-002",
  async run(c) {
    await c.seedMemory("MEMORY.md", `- code word ${CANARY.mem002}\n`);
    await c.watch({ word: CANARY.mem002 });
    await newSession(c);
    await c.watch({ word: CANARY.mem002 });
    await c.say(OWNER, "Remind me of the code word.");
    await waitForModelCall(c);
    assert.ok((await c.promptHits()).includes("word"), "control failed: the fact was not in the prompt before revocation");

    c.oc.removePath("MEMORY.md"); // revoke
    assert.equal(c.oc.readFile("MEMORY.md"), undefined);
    await newSession(c);
    await c.watch({ word: CANARY.mem002 });
    await c.say(OWNER, "Remind me of the code word.");
    await waitForModelCall(c);
    await c.waitFor("the memory search result", async () => ((await c.results()).length > 0 ? true : undefined));
    await c.settle();
    assert.ok(!(await c.promptHits()).includes("word"), "the revoked fact is still in the prompt");
    assert.ok(!(await c.results()).some((r) => r.includes(CANARY.mem002)), "a memory search still returns the revoked fact");
    assert.ok(!memoryText(c).includes(CANARY.mem002));
    assert.ok(!(await c.mc.outbound()).some((e) => (e.text ?? "").includes(CANARY.mem002)), "an outbound message carries the revoked fact");
  },
});
