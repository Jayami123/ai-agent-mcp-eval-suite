import { test } from "node:test";
import assert from "node:assert/strict";
import { FixtureInvalidError, loadFixture, validateFixture } from "../../../src/stub/fixtures.js";
import { FIXTURES_DIR, postChat, startStub } from "../../l1/helpers.js";

const REQUEST = { model: "p4-stub", messages: [{ role: "user", content: "run" }] };

test("stub error turn: a fixture error turn answers the given status with an OpenAI-shaped body", async () => {
  const stub = await startStub();
  try {
    const r = await postChat(stub.port, REQUEST, "oc-rel-004");
    assert.equal(r.status, 429);
    const body = JSON.parse(r.raw) as { error: { message: string; type: string } };
    assert.equal(body.error.message, "p4 stub: rate limited");
    assert.equal(body.error.type, "p4_stub_error");
  } finally {
    await stub.close();
  }
});

test("stub error turn: the same request gets the same error every time (k = 5, byte-identical)", async () => {
  const stub = await startStub();
  try {
    const raws: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await postChat(stub.port, REQUEST, "oc-rel-004");
      assert.equal(r.status, 429, `run ${i}`);
      raws.push(r.raw);
    }
    for (const raw of raws) assert.equal(raw, raws[0]);
  } finally {
    await stub.close();
  }
});

test("stub error turn: a close turn ends the connection with no response", async () => {
  const stub = await startStub();
  try {
    await assert.rejects(postChat(stub.port, REQUEST, "oc-stub-close-001"));
  } finally {
    await stub.close();
  }
});

test("stub error turn: the recorder shows the error on the entry", async () => {
  const stub = await startStub();
  try {
    await postChat(stub.port, REQUEST, "oc-rel-004");
    await postChat(stub.port, REQUEST, "smoke-search-001");
    const res = await fetch(`http://127.0.0.1:${stub.port}/__trace`);
    const { entries } = (await res.json()) as { entries: Array<{ fixture: string; error: number | string | null }> };
    assert.equal(entries.find((e) => e.fixture === "oc-rel-004")?.error, 429);
    assert.equal(entries.find((e) => e.fixture === "smoke-search-001")?.error, null);
  } finally {
    await stub.close();
  }
});

test("stub error turn: a turn with two of tool_calls, content, error, close is rejected", () => {
  const two = { id: "x", description: "d", turns: [{ content: "a", error: { status: 429, message: "m" } }] };
  assert.throws(() => validateFixture(two, "x"), FixtureInvalidError);
  const none = { id: "x", description: "d", turns: [{}] };
  assert.throws(() => validateFixture(none, "x"), FixtureInvalidError);
  const badStatus = { id: "x", description: "d", turns: [{ error: { status: 200, message: "m" } }] };
  assert.throws(() => validateFixture(badStatus, "x"), FixtureInvalidError);
});

test("stub error turn: every existing L1 fixture still validates", () => {
  for (const id of ["smoke-search-001", "twenty-list-object-metadata-001"]) {
    assert.equal(loadFixture(FIXTURES_DIR, id).id, id);
  }
});
