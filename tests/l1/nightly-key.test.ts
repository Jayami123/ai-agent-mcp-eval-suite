import { test } from "node:test";
import assert from "node:assert/strict";
import { nightlyKeyName, nightlyProvider, requireNightlyKey } from "./nightly-key.js";

test("provider: blank and gemma are gemma; deepseek is deepseek; anything else throws without echoing it", () => {
  assert.equal(nightlyProvider({}), "gemma");
  assert.equal(nightlyProvider({ P4_NIGHTLY_PROVIDER: "" }), "gemma");
  assert.equal(nightlyProvider({ P4_NIGHTLY_PROVIDER: "gemma" }), "gemma");
  assert.equal(nightlyProvider({ P4_NIGHTLY_PROVIDER: " deepseek " }), "deepseek");
  assert.throws(() => nightlyProvider({ P4_NIGHTLY_PROVIDER: "SECRETVAL-xyz" }), (e: Error) => {
    assert.match(e.message, /P4_NIGHTLY_PROVIDER/);
    assert.doesNotMatch(e.message, /SECRETVAL/);
    return true;
  });
});

test("key name: deepseek reads DEEPSEEK_API_KEY, gemma reads GEMINI_API_KEY", () => {
  assert.equal(nightlyKeyName("deepseek"), "DEEPSEEK_API_KEY");
  assert.equal(nightlyKeyName("gemma"), "GEMINI_API_KEY");
});

test("requireNightlyKey: deepseek with its key returns it", () => {
  assert.equal(requireNightlyKey({ P4_NIGHTLY_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "k-1" }), "k-1");
});

test("requireNightlyKey: deepseek with only the Gemini key fails, naming DEEPSEEK_API_KEY (never a skip)", () => {
  assert.throws(
    () => requireNightlyKey({ P4_NIGHTLY_PROVIDER: "deepseek", GEMINI_API_KEY: "g-1" }),
    (e: Error) => {
      assert.match(e.message, /DEEPSEEK_API_KEY is not set/);
      assert.doesNotMatch(e.message, /g-1/);
      return true;
    },
  );
});

test("requireNightlyKey: gemma (blank) with a missing GEMINI_API_KEY fails, naming GEMINI_API_KEY", () => {
  assert.throws(() => requireNightlyKey({ P4_NIGHTLY_PROVIDER: "" }), /GEMINI_API_KEY is not set/);
});

test("requireNightlyKey: an empty key counts as missing", () => {
  assert.throws(() => requireNightlyKey({ P4_NIGHTLY_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "" }), /DEEPSEEK_API_KEY is not set/);
});
