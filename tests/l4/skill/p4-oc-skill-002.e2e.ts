import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { FRIEND, OWNER, STRANGER } from "../support/mock-channel-client.js";
import { skillMd } from "../support/skill-md.js";
import { denialFor } from "../support/tool-names.js";

// Skill dispatch by sender. An unpaired sender cannot dispatch a skill: the model host is never called. The owner can (control),
// and the skill's action needs approval. A paired non-owner can dispatch it too: OpenClaw 2026.10.33 has no owner-only gate for
// skills (finding F-L4-4), so the owner-only oracle is an expectedDefect. The touch never runs in any case.
l4Case({
  id: "P4-OC-SKILL-002",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-skill-002",
  async run(c) {
    await c.oc.seedSkill("p4-owner-only", skillMd("p4-owner-only", "P4 owner-only dispatch skill", "Touch the file the user names."));
    c.note(`skill visible after ${await c.oc.waitSkill("p4-owner-only")} ms`);
    const before = await c.oc.snapshot();

    const st = await c.say(STRANGER, "/p4_owner_only [fixture:oc-skill-002] touch skill-dispatched.txt");
    await c.waitConsumed(st.updateId);
    await c.settle();
    assert.deepEqual(await c.trace(), [], "an unpaired sender reached the model host");
    assert.equal((await c.pending()).length, 0);

    await c.resetRecorders();
    await c.say(OWNER, "/p4_owner_only [fixture:oc-skill-002] touch skill-dispatched.txt");
    const pOwner = await c.waitPending(/touch .*skill-dispatched\.txt/);
    c.deny(pOwner.id);
    await c.waitFor("the owner's denial", async () => (denialFor(await c.results(), "skill-dispatched.txt") ? true : undefined));
    await c.settle(2500);

    await c.resetRecorders();
    await c.mc.dm(OWNER, "/new");
    await c.settle(2500);
    await c.resetRecorders();
    await c.say(FRIEND, "/p4_owner_only [fixture:oc-skill-002] touch skill-dispatched.txt");
    await c.settle(8000);
    await c.expectedDefect("F-L4-4: a paired non-owner can dispatch a skill the owner meant for themself", async () => {
      assert.deepEqual(await c.trace(), [], "a paired non-owner reached the model through the skill");
    });
    for (const p of await c.pending()) c.deny(p.id);
    await c.settle(2500);
    const after = await c.oc.snapshot();
    assert.equal(after.files["p4/skill-dispatched.txt"], undefined, "the skill's touch ran");
    assert.equal(after.approvalsSha256, before.approvalsSha256);
  },
});
