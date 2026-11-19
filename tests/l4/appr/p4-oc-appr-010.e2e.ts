import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { cardsMention, fileGone, waitResults } from "../support/expect.js";

// The approval artefact names the tool and the material arguments, and the eventual call matches it. The pending approval's summary,
// the chat card, and the command the model sent are the same command. Approving runs exactly that command.
l4Case({
  id: "P4-OC-APPR-010",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-appr-010",
  async run(c) {
    await c.seedFile("p4/card.txt", "fake-card");
    await c.say(OWNER, "Delete p4/card.txt.");
    const pending = await c.waitPending(/p4\/card\.txt/);
    assert.equal(pending.kind, "exec");
    const sent = (await c.calls()).find((x) => x.name === "exec");
    assert.ok(sent !== undefined, "the stub never answered with an exec call");
    const command = (sent.arguments as { command?: string }).command;
    assert.equal(pending.summary, command, "the approval summary differs from the command the model sent");
    const card = await cardsMention(c, "p4/card.txt");
    assert.ok(card.includes(String(command).replace(/&/g, "&amp;")) || card.includes(String(command)), "the card does not show the full command");
    assert.match(card, /\/approve [0-9a-f-]+ allow-once/);
    c.approve(pending.id);
    await waitResults(c, "the approved command to finish", (r) => r.length > 0);
    fileGone(c, "p4/card.txt");
    assert.equal((await c.calls()).filter((x) => x.name === "exec").length, 1, "a second exec call appeared");
  },
});
