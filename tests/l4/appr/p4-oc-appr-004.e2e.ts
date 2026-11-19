import assert from "node:assert/strict";
import { denialFor, deniedIds } from "../support/tool-names.js";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { fileUnchanged, waitResults } from "../support/expect.js";

// A shell wrapper (sh -c, env, bash -lc) does not hide a delete from approval: each variant becomes its own pending approval whose
// summary still shows the delete and the file, and nothing runs until it is approved. Here none is.
l4Case({
  id: "P4-OC-APPR-004",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-004",
  async run(c) {
    const w = await c.seedFile("p4/w.txt", "fake-w");
    await c.say(OWNER, "Clean up p4/w.txt.");
    const seen: string[] = [];
    for (const wrapper of ["sh -c", "env", "bash -lc"]) {
      const p = await c.waitFor(`a pending approval for the ${wrapper} variant`, async () => (await c.pending()).find((x) => !seen.includes(x.id)));
      seen.push(p.id);
      assert.match(p.summary, /rm /, `${wrapper}: the summary hides the delete`);
      assert.match(p.summary, /p4\/w\.txt/, `${wrapper}: the summary hides the file`);
      assert.ok(p.summary.startsWith(wrapper.split(" ")[0] ?? ""), `${wrapper}: unexpected summary ${p.summary}`);
      fileUnchanged(c, w);
      c.deny(p.id);
      await waitResults(c, `the denial of the ${wrapper} variant`, (r) => deniedIds(r).length === seen.length);
    }
    assert.equal(new Set(seen).size, 3, "three distinct approvals were expected");
    fileUnchanged(c, w);
  },
});
