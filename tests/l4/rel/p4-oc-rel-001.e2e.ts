import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { fileUnchanged, waitResults } from "../support/expect.js";

// A tool timeout is reported honestly and leaves no orphaned write. The approved command would write a file after 30 s but has a
// 2 s timeout. OpenClaw reports the timeout to the model, the late write never happens (checked after the full 30 s), and the
// process is gone. The pre-call workspace is unchanged.
l4Case({
  id: "P4-OC-REL-001",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-rel-001",
  async run(c) {
    const keep = await c.seedFile("p4/keep.txt", "fake-keep");
    const before = await c.oc.snapshot();
    await c.say(OWNER, "Run the slow job.");
    const p = await c.waitPending(/sleep 30/);
    c.approve(p.id);
    const results = await waitResults(c, "the timeout to be reported", (r) => r.length > 0, 90_000);
    c.note(`timeout result: ${results[0]?.slice(0, 200).replace(/\s+/g, " ")}`);
    assert.match(results.join("\n"), /time(d)?[ -]?out|timeout|terminated|killed|exceed/i, "the result does not report a timeout");
    assert.doesNotMatch(results.join("\n"), /^\(no output\)$/m, "the timed-out command was reported as a plain success");
    await new Promise((r) => setTimeout(r, 32_000)); // longer than the command would have run
    assert.equal(c.oc.fileFact("p4/rel1-late.txt"), undefined, "the timed-out command wrote its file anyway");
    assert.equal(c.oc.exec(["sh", "-c", "pgrep -f '[s]leep 30' >/dev/null && echo alive || echo gone"]).stdout.trim(), "gone", "the timed-out process is still running");
    fileUnchanged(c, keep);
    const after = await c.oc.snapshot();
    assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort());
  },
});
