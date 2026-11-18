import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../../src/stub/canonical.js";
import { postChat, startStub } from "./helpers.js";

// P4-STAT-001: the same fixture always yields the same tool_calls.
// Oracle (ledger, verbatim): k repeated stub runs produce byte-identical tool-call traces
// for a fixed fixture. Any difference fails the PR gate.
const FIXTURE_ID = "smoke-search-001";
const K = 5; // ledger requires repeated runs; the plan uses k=5
const REQUEST = { model: "p4-stub", messages: [{ role: "user", content: "run" }] };

test("P4-STAT-001: same fixture, k repeated stub runs, byte-identical tool_calls", async () => {
  const stub = await startStub();
  try {
    const rawBodies: string[] = [];
    const traces: string[] = [];
    for (let i = 0; i < K; i++) {
      const r = await postChat(stub.port, REQUEST, FIXTURE_ID);
      assert.equal(r.status, 200, `run ${i} status`);
      rawBodies.push(r.raw);
      const parsed = JSON.parse(r.raw) as {
        choices: Array<{ message: { tool_calls?: unknown } }>;
      };
      traces.push(canonicalJson(parsed.choices[0]?.message.tool_calls ?? null));
    }

    for (let i = 1; i < K; i++) {
      assert.equal(traces[i], traces[0], `tool_calls trace ${i} differs from trace 0`);
      assert.equal(rawBodies[i], rawBodies[0], `raw response ${i} differs from response 0`);
    }
    assert.match(traces[0] ?? "", /"name":"search_records"/);
  } finally {
    await stub.close();
  }
});
