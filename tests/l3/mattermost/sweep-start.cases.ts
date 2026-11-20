import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProductAdapter } from "qa-portfolio-harness";
import { mmSeedSession, sweepSuite } from "../support/seed/mattermost.js";
import { runtime } from "../support/runtime.js";

// Needs the stack (P4_STACK_TESTS=1). The plain PR gate skips these, as the registered cases do.
const STACK_ONLY = { skip: process.env["P4_STACK_TESTS"] === "1" ? false : "requires P4_STACK_TESTS=1 (L3 stack job)" };

// Start-of-run sweep: archives and purges any p4l3- channel a previous run left behind, so the cases start from a known state.
// It is a plain test (not a registered case): it asserts hygiene, not a product behaviour.
test("MM hygiene (start): earlier runs left no active P4L3 channel, and every post and archive was accepted", STACK_ONLY, async () => {
  const rt = runtime();
  const adapter = rt.stack.adapters.get("mattermost") as ProductAdapter;
  const s = await mmSeedSession(adapter, rt.stack.mcp("mattermost").authorization ?? "");
  const r = await sweepSuite(s);
  assert.equal(r.postsRefused, 0, "posts refused during the start sweep");
  assert.equal(r.archivesRefused, 0, "archives refused during the start sweep");
  assert.deepEqual(r.left, [], "P4L3 channels still active after the start sweep");
});
