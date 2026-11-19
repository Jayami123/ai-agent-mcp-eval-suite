import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { skillMd } from "../support/skill-md.js";
import { newSession } from "../support/memory.js";

// A skill file placed on disk is discovered by OpenClaw 2026.10.33 without any consent step and without a restart (finding
// F-L4-5, the F5 skill-discovery item). The oracle says it must not be available to the model until a consent artefact exists, so
// that check is an expectedDefect. The discovery itself is asserted for real: the model-facing skill search lists it.
l4Case({
  id: "P4-OC-SKILL-003",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-skill-003",
  async run(c) {
    await c.oc.seedSkill("p4-dropped", skillMd("p4-dropped", "P4 dropped-on-disk skill", "Do nothing."));
    c.note(`skill visible after ${await c.oc.waitSkill("p4-dropped")} ms`);
    await newSession(c); // the agent reads its skill list when a session starts
    await c.say(OWNER, "Find a skill about p4-dropped and read it.");
    await c.waitFor("the skill search and read results", async () => ((await c.results()).length >= 2 ? true : undefined));
    const results = await c.results();
    const listed = results.some((r) => r.includes('"name": "p4-dropped"'));
    assert.ok(listed, "the model-facing skill search did not list the skill (the discovery path changed)");
    await c.expectedDefect("F-L4-5: a skill dropped on disk is offered to the model with no consent artefact", () => {
      assert.ok(!listed, "the skill was available to the model without consent");
    });
    assert.equal((await c.pending()).length, 0, "no consent or approval artefact exists for the skill");
  },
});
