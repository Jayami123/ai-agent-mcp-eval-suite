import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER } from "../../../src/mock-channel/types.js";
import { startMockChannel } from "./helpers.js";

test("mock-channel: reset clears log, queue, sink and watched values", async () => {
  const mc = await startMockChannel();
  try {
    await mc.inbound({ chat: { id: OWNER.id, type: "private" }, from: OWNER, text: "x" });
    await mc.control("POST", "/__mc/watch", { canary: "CANARY-reset-value" });
    await fetch(`${mc.base}/__sink/a`, { method: "POST", body: "CANARY-reset-value" });
    await mc.control("DELETE", "/__mc/reset");
    assert.deepEqual(((await mc.control("GET", "/__mc/log")) as { entries: unknown[] }).entries, []);
    assert.deepEqual((await mc.bot("getUpdates", { offset: 0, timeout: 0 })).body["result"], []);
    await fetch(`${mc.base}/__sink/a`, { method: "POST", body: "CANARY-reset-value" });
    const sink = (await mc.control("GET", "/__mc/sink")) as { records: Array<{ matched: string[] }> };
    assert.equal(sink.records.length, 1, "the earlier sink record is gone");
    assert.deepEqual(sink.records[0]?.matched, [], "the watched value was forgotten by reset");
  } finally {
    await mc.close();
  }
});

test("mock-channel: a reaction update names the message it targets", async () => {
  const mc = await startMockChannel();
  try {
    const { messageId } = await mc.inbound({ chat: { id: OWNER.id, type: "private" }, from: OWNER, text: "m1" });
    await mc.react({ chatId: OWNER.id, messageId, from: OWNER, emoji: ["👍"] });
    const updates = (await mc.bot("getUpdates", { offset: 0, timeout: 0 })).body["result"] as Array<{ message_reaction?: { message_id: number; new_reaction: Array<{ emoji: string }> } }>;
    const reaction = updates.find((u) => u.message_reaction !== undefined)?.message_reaction;
    assert.equal(reaction?.message_id, messageId);
    assert.equal(reaction?.new_reaction[0]?.emoji, "👍");
  } finally {
    await mc.close();
  }
});

test("mock-channel: raw-update delivers a malformed update unchanged", async () => {
  const mc = await startMockChannel();
  try {
    await mc.control("POST", "/__mc/raw-update", { update_id: 7, message: { text: { not: "a string" }, chat: null } });
    const updates = (await mc.bot("getUpdates", { offset: 0, timeout: 0 })).body["result"] as Array<{ update_id: number; message: { chat: unknown } }>;
    assert.equal(updates[0]?.update_id, 7);
    assert.equal(updates[0]?.message.chat, null);
  } finally {
    await mc.close();
  }
});

test("mock-channel: a registered page is served and an unknown page is 404", async () => {
  const mc = await startMockChannel();
  try {
    await mc.control("POST", "/__mc/page", { id: "p1", html: "<p>fake page</p>" });
    assert.equal(await (await fetch(`${mc.base}/__pages/p1`)).text(), "<p>fake page</p>");
    assert.equal((await fetch(`${mc.base}/__pages/nope`)).status, 404);
  } finally {
    await mc.close();
  }
});

test("mock-channel: status reports the poller (a getUpdates call in flight) and nothing else about the run", async () => {
  const mc = await startMockChannel();
  try {
    const before = (await mc.control("GET", "/__mc/status")) as { polls: number; pollsInFlight: number; maxOffset: number };
    assert.deepEqual(before, { polls: 0, pollsInFlight: 0, maxOffset: 0 });
    const poll = mc.bot("getUpdates", { offset: 0, timeout: 2 });
    await new Promise((r) => setTimeout(r, 300));
    const during = (await mc.control("GET", "/__mc/status")) as { polls: number; pollsInFlight: number; maxOffset: number };
    assert.deepEqual(during, { polls: 1, pollsInFlight: 1, maxOffset: 0 });
    await poll;
    const after = (await mc.control("GET", "/__mc/status")) as { polls: number; pollsInFlight: number; maxOffset: number };
    assert.deepEqual(after, { polls: 1, pollsInFlight: 0, maxOffset: 0 });
  } finally {
    await mc.close();
  }
});

test("mock-channel: status reports the highest offset a client confirmed, which proves it consumed earlier updates", async () => {
  const mc = await startMockChannel();
  try {
    const { updateId } = await mc.inbound({ chat: { id: OWNER.id, type: "private" }, from: OWNER, text: "x" });
    assert.equal(((await mc.control("GET", "/__mc/status")) as { maxOffset: number }).maxOffset, 0);
    await mc.bot("getUpdates", { offset: updateId + 1, timeout: 0 });
    assert.equal(((await mc.control("GET", "/__mc/status")) as { maxOffset: number }).maxOffset, updateId + 1);
  } finally {
    await mc.close();
  }
});
