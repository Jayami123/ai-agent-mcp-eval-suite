import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER } from "../../../src/mock-channel/types.js";
import { startMockChannel } from "./helpers.js";

const dm = { chat: { id: OWNER.id, type: "private" as const }, from: OWNER };

test("mock-channel: getUpdates returns an injected message", async () => {
  const mc = await startMockChannel();
  try {
    const { messageId } = await mc.inbound({ ...dm, text: "hello" });
    const res = await mc.bot("getUpdates", { offset: 0, timeout: 1 });
    const updates = res.body["result"] as Array<{ message: { text: string; message_id: number; from: { id: number } } }>;
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.message.text, "hello");
    assert.equal(updates[0]?.message.message_id, messageId);
    assert.equal(updates[0]?.message.from.id, OWNER.id);
  } finally {
    await mc.close();
  }
});

test("mock-channel: getUpdates with no updates returns [] after the timeout", async () => {
  const mc = await startMockChannel();
  try {
    const started = Date.now();
    const res = await mc.bot("getUpdates", { offset: 0, timeout: 1 });
    assert.deepEqual(res.body["result"], []);
    assert.ok(Date.now() - started >= 900, "long poll waited for the timeout");
  } finally {
    await mc.close();
  }
});

test("mock-channel: getUpdates with an offset drops confirmed updates", async () => {
  const mc = await startMockChannel();
  try {
    const first = await mc.inbound({ ...dm, text: "one" });
    await mc.inbound({ ...dm, text: "two" });
    const res = await mc.bot("getUpdates", { offset: first.updateId + 1, timeout: 0 });
    const updates = res.body["result"] as Array<{ message: { text: string } }>;
    assert.deepEqual(updates.map((u) => u.message.text), ["two"]);
  } finally {
    await mc.close();
  }
});

test("mock-channel: sendMessage is recorded in /__mc/outbound with chat id and text", async () => {
  const mc = await startMockChannel();
  try {
    const res = await mc.bot("sendMessage", { chat_id: OWNER.id, text: "reply text" });
    assert.equal(res.status, 200);
    const out = (await mc.control("GET", "/__mc/outbound")) as { entries: Array<{ chatId: number; text: string; method: string }> };
    assert.equal(out.entries.length, 1);
    assert.equal(out.entries[0]?.chatId, OWNER.id);
    assert.equal(out.entries[0]?.text, "reply text");
    assert.equal(out.entries[0]?.method, "sendMessage");
  } finally {
    await mc.close();
  }
});

test("mock-channel: an unknown method returns 404 and is logged as unknown-method", async () => {
  const mc = await startMockChannel();
  try {
    const res = await mc.bot("doSomethingNew", {});
    assert.equal(res.status, 404);
    const log = (await mc.control("GET", "/__mc/log")) as { entries: Array<{ dir: string; method?: string }> };
    assert.ok(log.entries.some((e) => e.dir === "unknown-method" && e.method === "doSomethingNew"));
  } finally {
    await mc.close();
  }
});

test("mock-channel: a wrong token returns 401 and is logged as rejected", async () => {
  const mc = await startMockChannel();
  try {
    const res = await mc.bot("getMe", {}, "0:wrong");
    assert.equal(res.status, 401);
    const log = (await mc.control("GET", "/__mc/log")) as { entries: Array<{ dir: string }> };
    assert.ok(log.entries.some((e) => e.dir === "rejected"));
  } finally {
    await mc.close();
  }
});

test("mock-channel: a mention and a bot command get entities, a quote and a forward origin are carried", async () => {
  const mc = await startMockChannel();
  try {
    await mc.inbound({ ...dm, text: "/new" });
    await mc.inbound({ ...dm, text: "@p4_mock_bot hi", quote: { text: "quoted line" }, forwardFrom: { id: 1001, firstName: "Owner" } });
    const res = await mc.bot("getUpdates", { offset: 0, timeout: 0 });
    const updates = res.body["result"] as Array<{ message: { entities?: Array<{ type: string }>; quote?: { text: string }; forward_origin?: { type: string } } }>;
    assert.equal(updates[0]?.message.entities?.[0]?.type, "bot_command");
    assert.equal(updates[1]?.message.entities?.[0]?.type, "mention");
    assert.equal(updates[1]?.message.quote?.text, "quoted line");
    assert.equal(updates[1]?.message.forward_origin?.type, "user");
  } finally {
    await mc.close();
  }
});
