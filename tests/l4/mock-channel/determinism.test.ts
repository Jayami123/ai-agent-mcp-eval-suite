import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER, STRANGER } from "../../../src/mock-channel/types.js";
import { startMockChannel } from "./helpers.js";

test("mock-channel: the same inject sequence gives a byte-identical log (k = 5)", async () => {
  const logs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const mc = await startMockChannel();
    try {
      const a = await mc.inbound({ chat: { id: OWNER.id, type: "private" }, from: OWNER, text: "one" });
      await mc.inbound({ chat: { id: STRANGER.id, type: "private" }, from: STRANGER, text: "two" });
      await mc.react({ chatId: OWNER.id, messageId: a.messageId, from: OWNER, emoji: ["👍"] });
      await mc.bot("sendMessage", { chat_id: OWNER.id, text: "out" });
      logs.push(JSON.stringify(((await mc.control("GET", "/__mc/log")) as { entries: unknown[] }).entries));
    } finally {
      await mc.close();
    }
  }
  for (const l of logs) assert.equal(l, logs[0]);
});
