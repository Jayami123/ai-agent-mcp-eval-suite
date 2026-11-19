import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { denialFor } from "../support/tool-names.js";
import { fileUnchanged, noPending, waitResults } from "../support/expect.js";

// After an approval is denied (revoked), replaying its id as an approval does not run the tool.
l4Case({
  id: "P4-OC-APPR-012",
  kind: "stretch",
  needs: ["stack", "channel"],
  fixture: "oc-appr-012",
  async run(c) {
    const e = await c.seedFile("p4/e.txt", "fake-e");
    await c.say(OWNER, "Delete p4/e.txt.");
    const p = await c.waitPending(/p4\/e\.txt/);
    c.deny(p.id);
    await waitResults(c, "the denial", (r) => denialFor(r, "e.txt") !== undefined);
    const mark = (await c.mc.log()).length;
    await c.ownerApprove(p.id); // the replay
    const reply = await c.waitFor("a reply to the replayed approval", async () => (await c.mc.log()).slice(mark).find((x) => x.dir === "outbound"));
    c.note(`replay reply: ${(reply.text ?? "").slice(0, 160)}`);
    await c.settle();
    await noPending(c);
    fileUnchanged(c, e);
    assert.equal((await c.results()).filter((x) => !/Exec denied/.test(x)).length, 0, "a result other than the denial appeared after the replay");
  },
});
