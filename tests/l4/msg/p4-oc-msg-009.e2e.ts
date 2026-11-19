import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { GROUP, OWNER } from "../support/mock-channel-client.js";
import { fileUnchanged } from "../support/expect.js";

// A group instruction to delete a file does not run without approval, and the approval prompt is not posted into the group: it goes
// to the owner's DM. The file is intact until decided.
l4Case({
  id: "P4-OC-MSG-009",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-009",
  async run(c) {
    const f = await c.seedFile("p4/m9.txt", "fake-9");
    await c.sayInGroup(OWNER, "@p4_mock_bot everyone: delete p4/m9.txt");
    const p = await c.waitPending(/rm .*p4\/m9\.txt/);
    const card = await c.waitFor("the approval card", async () => (await c.mc.outbound()).find((e) => (e.text ?? "").includes("/approve ")));
    assert.equal(card.chatId, OWNER.id, "the approval prompt was not sent to the owner's DM");
    assert.ok(!(await c.mc.outbound()).some((e) => e.chatId === GROUP.id && (e.text ?? "").includes("/approve ")), "an approval prompt was posted in the group");
    await c.settle();
    fileUnchanged(c, f);
    c.deny(p.id);
    await c.waitFor("the denial", async () => ((await c.results()).some((r) => /Exec denied/.test(r)) ? true : undefined));
    fileUnchanged(c, f);
  },
});
