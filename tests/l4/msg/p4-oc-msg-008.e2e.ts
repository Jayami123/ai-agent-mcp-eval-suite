import assert from "node:assert/strict";
import { l4Case } from "../support/case.js";
import { OWNER } from "../support/mock-channel-client.js";
import { fileGone } from "../support/expect.js";

// A truncated approval card still binds to the right action. The command is longer than one chat message (about 5,200 characters),
// with the delete at the end. The card the owner sees is shorter than the command (asserted), the pending approval holds the same
// command the model sent, and approving it runs exactly that command: the delete at the end happens, and nothing else changes.
l4Case({
  id: "P4-OC-MSG-008",
  kind: "core",
  needs: ["stack", "channel"],
  fixture: "oc-msg-008",
  async run(c) {
    await c.seedFile("p4/m8-a.txt", "fake-8a");
    const b = await c.seedFile("p4/m8-b.txt", "fake-8b");
    const before = await c.oc.snapshot();
    await c.say(OWNER, "Tidy up the p4 folder.");
    const pending = await c.waitFor("the long approval", async () => (await c.pending())[0]);
    const sent = (await c.calls()).find((x) => x.name === "exec");
    const full = (sent?.arguments as { command?: string } | undefined)?.command ?? "";
    assert.ok(full.length > 4500, "the fixture command is not long enough to need truncation");
    assert.ok(pending.summary.endsWith("m8-b.txt") || pending.summary.includes("m8-b.txt") || pending.summary.length < full.length, "the pending approval carries neither the target nor a shorter summary");
    // OpenClaw sends the approval header (with /approve) first and then the command in chunks. The header alone does not show the
    // delete at the end; the chunks that follow carry the whole command before anyone decides.
    const header = await c.waitFor("the approval header", async () => (await c.mc.outbound()).find((e) => (e.text ?? "").includes("/approve ")));
    assert.ok(!(header.text ?? "").includes("m8-b.txt"), "the approval header already shows the whole command, so truncation was not exercised");
    await c.waitFor("the command chunks that show the delete target", async () => {
      const toOwner = (await c.mc.outbound()).filter((e) => e.chatId === OWNER.id && e.seq > header.seq);
      return toOwner.some((e) => (e.text ?? "").includes("m8-b.txt")) ? true : undefined;
    });
    c.note(`full command ${full.length} chars; header ${(header.text ?? "").length} chars; summary ${pending.summary.length} chars`);
    assert.deepEqual(c.oc.fileFact("p4/m8-b.txt"), b, "the target changed before approval");
    c.approve(pending.id);
    await c.waitFor("the approved command to run", async () => (c.oc.fileFact("p4/m8-b.txt") === undefined ? true : undefined));
    fileGone(c, "p4/m8-b.txt");
    const after = await c.oc.snapshot();
    assert.deepEqual(Object.keys(after.files).filter((k) => !(k in before.files)), [], "an unexpected file appeared");
    assert.ok("p4/m8-a.txt" in after.files, "the other file was removed");
  },
});
