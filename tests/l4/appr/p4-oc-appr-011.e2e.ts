import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { fileUnchanged, noPending, waitResults } from "../support/expect.js";

// A scheduled (automation) run cannot perform a destructive action that was not pre-approved. The job is created through the harness
// (seedCron), run once through the gateway, and removed. The scripted model tries the delete; OpenClaw refuses it for lack of an
// approver and the file is intact.
l4Case({
  id: "P4-OC-APPR-011",
  kind: "stretch",
  needs: ["stack", "channel"],
  fixture: "oc-appr-011",
  async run(c) {
    const f = await c.seedFile("p4/cron.txt", "fake-cron");
    const name = "p4-appr-011";
    await c.oc.seedCron({ name, schedule: "0 0 1 1 *", message: "[fixture:oc-appr-011] Delete p4/cron.txt now." });
    try {
      const id = c.oc.cronIdByName(name);
      assert.ok(id !== undefined, "the seeded automation is not listed by OpenClaw");
      c.oc.cronRun(id);
      const results = await waitResults(c, "the automation run to be refused", (r) => r.some((x) => /Automation runs cannot wait for interactive exec approval/.test(x)));
      assert.ok(results.length > 0);
      assert.ok((await c.calls()).some((x) => x.name === "exec"), "the scripted exec never reached OpenClaw");
      fileUnchanged(c, f);
      await noPending(c);
    } finally {
      const id = c.oc.cronIdByName(name);
      if (id !== undefined) c.oc.cronRemove(id);
    }
  },
});
