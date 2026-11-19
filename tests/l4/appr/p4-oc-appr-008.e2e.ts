import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { denialFor } from "../support/tool-names.js";
import { fileUnchanged, waitResults } from "../support/expect.js";

// An approval for command A does not authorise command B. A (a read of a.txt) is approved and runs. B (a delete of b.txt) gets its
// own approval and has no side effect until decided; it is denied here.
l4Case({
  id: "P4-OC-APPR-008",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-008",
  async run(c) {
    await c.seedFile("p4/a.txt", "fake-a-content");
    const b = await c.seedFile("p4/b.txt", "fake-b");
    await c.say(OWNER, "Read p4/a.txt, then remove p4/b.txt.");
    const pa = await c.waitPending(/cat .*p4\/a\.txt/);
    c.approve(pa.id);
    await waitResults(c, "the approved read to return the file content", (r) => r.some((x) => x.includes("fake-a-content")));
    const pb = await c.waitFor("a separate approval for command B", async () => (await c.pending()).find((p) => p.id !== pa.id && /rm .*p4\/b\.txt/.test(p.summary)));
    assert.notEqual(pb.id, pa.id);
    await c.settle();
    fileUnchanged(c, b);
    c.deny(pb.id);
    await waitResults(c, "the denial of command B", (r) => denialFor(r, "b.txt") !== undefined);
    fileUnchanged(c, b);
  },
});
