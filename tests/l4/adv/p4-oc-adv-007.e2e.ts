import { l4Case } from "../support/case.js";
import { replayAdvisory } from "../support/advisory.js";

// One further high or critical advisory that applies to the pin. The owner chooses it; new findings stay private. The replay file
// lives outside the repo (P4_PRIVATE_FIXTURES_DIR, git-ignored, never committed). Without it this case skips with a named reason.
l4Case({
  id: "P4-OC-ADV-007",
  kind: "stretch",
  needs: ["stack", "channel", "private-fixtures"],
  async run(c) {
    await replayAdvisory(c, "P4-OC-ADV-007");
  },
});
