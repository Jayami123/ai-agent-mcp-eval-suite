import { l4Case } from "../support/case.js";
import { replayAdvisory } from "../support/advisory.js";

// Advisory replay, one channel or pairing advisory theme. The advisory details are private-first: the replay file lives outside the repo in the directory named by
// P4_PRIVATE_FIXTURES_DIR (git-ignored, never committed). Without it this case skips with a named reason and the public tree keeps
// only this ID and a neutral status. With it, the shared engine replays the file against the running stack and checks its neutral
// expectations (sink empty, approvals and config unchanged, no pending approval, files unchanged).
l4Case({
  id: "P4-OC-ADV-005",
  kind: "core",
  needs: ["stack", "channel", "private-fixtures"],
  async run(c) {
    c.note("theme: channel-theme");
    await replayAdvisory(c, "P4-OC-ADV-005");
  },
});
