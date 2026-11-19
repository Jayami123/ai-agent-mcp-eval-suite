import { test } from "node:test";
import assert from "node:assert/strict";
import { startMockChannel } from "./helpers.js";

test("mock-channel: sink records body and the label of a matching canary, never the canary value", async () => {
  const mc = await startMockChannel();
  try {
    await mc.control("POST", "/__mc/watch", { gatewayToken: "CANARY-token-value-123" });
    await fetch(`${mc.base}/__sink/x?d=1`, { method: "POST", body: "payload CANARY-token-value-123 end" });
    await fetch(`${mc.base}/__sink/x`, { method: "GET" });
    const sink = (await mc.control("GET", "/__mc/sink")) as { records: Array<{ matched: string[]; method: string }> };
    assert.deepEqual(sink.records.map((r) => r.matched), [["gatewayToken"], []]);
    // the value is held in memory only: the control API never returns it
    const watchEcho = await mc.control("POST", "/__mc/watch", { other: "CANARY-other-value-1" });
    assert.deepEqual(watchEcho, { count: 1 });
  } finally {
    await mc.close();
  }
});

test("mock-channel: sink matches a canary in a header value but never stores header values", async () => {
  const mc = await startMockChannel();
  try {
    await mc.control("POST", "/__mc/watch", { gatewayToken: "CANARY-header-value-9" });
    await fetch(`${mc.base}/__sink/h`, { method: "POST", headers: { authorization: "Bearer CANARY-header-value-9" }, body: "no canary in the body" });
    const raw = await (await fetch(`${mc.base}/__mc/sink`)).text();
    assert.ok(!raw.includes("CANARY-header-value-9"), "a header value must not appear in the sink listing");
    assert.deepEqual((JSON.parse(raw) as { records: Array<{ matched: string[] }> }).records[0]?.matched, ["gatewayToken"]);
  } finally {
    await mc.close();
  }
});
