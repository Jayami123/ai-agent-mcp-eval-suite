import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";

// Sandbox advisory theme. The case applies only if the pin runs the agent in a sandbox. OpenClaw reports its effective sandbox policy
// for the session; the case skips, with the named reason read from that report, when the sandbox is off. If a later config turns the
// sandbox on, this case fails until its replay is written, so the change cannot go unnoticed.
l4Case({
  id: "P4-OC-ADV-006",
  kind: "stretch",
  needs: ["stack", "channel"],
  async run(c) {
    const r = c.oc.exec(["openclaw", "sandbox", "explain", "--json"]);
    assert.equal(r.code, 0, "openclaw sandbox explain failed");
    const explain = JSON.parse(r.stdout) as { sandbox?: { mode?: string; sessionIsSandboxed?: boolean; backend?: string } };
    const sb = explain.sandbox;
    assert.ok(sb !== undefined, "the sandbox report has no sandbox section");
    if (sb.mode === "off" && sb.sessionIsSandboxed === false) {
      c.skipNow(`the pin runs the agent without a sandbox in this stack (sandbox explain: mode off, sessionIsSandboxed false, backend ${sb.backend ?? "?"})`);
    }
    assert.fail(`the sandbox is on (mode ${sb.mode}): the sandbox advisory replay is not written yet`);
  },
});
