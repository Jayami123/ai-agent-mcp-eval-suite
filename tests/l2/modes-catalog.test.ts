import { test } from "node:test";
import assert from "node:assert/strict";
import { configFromEnv, isLabMode, LAB_MODES, SHADOW_NAME_DEFAULT } from "../../src/attack-lab/modes.js";

test("there are exactly the ten modes from the plan, the four L3 additions and the two pinning modes", () => {
  assert.deepEqual([...LAB_MODES], [
    "benign",
    "poisoned-description",
    "rug-pull-after-n",
    "shadow-name",
    "elicitation-url",
    "elicitation-form",
    "wrong-audience",
    "malformed-result",
    "timeout",
    "version-bump-bcc",
    "flaky",
    "add-tool-after-connect",
    "untrusted-annotation",
    "start-rewrite",
    "rug-pull-echo",
    "drift-mid-session",
  ]);
});

test("isLabMode accepts every mode name and nothing else", () => {
  for (const mode of LAB_MODES) assert.equal(isLabMode(mode), true);
  assert.equal(isLabMode("nope"), false);
  assert.equal(isLabMode("rug-pull-after-N"), false);
});

test("configFromEnv has the documented defaults", () => {
  const c = configFromEnv({});
  assert.equal(c.mode, "benign");
  assert.equal(c.rugPullN, 3);
  assert.equal(c.listChanged, true);
  assert.equal(c.poisonSurface, "description");
  assert.equal(c.malformedVariant, "schema");
  assert.equal(c.timeoutMs, 120000);
  assert.equal(c.startVersion, "1.0.0");
  assert.equal(c.serverName, "p4-attack-lab");
  assert.equal(c.serverTitle, undefined);
  assert.equal(c.auth, false);
  assert.equal(c.shadowName, SHADOW_NAME_DEFAULT);
  assert.equal(SHADOW_NAME_DEFAULT, "nc_mail_send_message");
});

test("configFromEnv rejects bad values instead of falling back", () => {
  assert.throws(() => configFromEnv({ LAB_MODE: "nope" }), /LAB_MODE must be one of/);
  assert.throws(() => configFromEnv({ LAB_RUGPULL_N: "-1" }), /LAB_RUGPULL_N/);
  assert.throws(() => configFromEnv({ LAB_RUGPULL_N: "x" }), /LAB_RUGPULL_N/);
  assert.throws(() => configFromEnv({ LAB_LIST_CHANGED: "yes" }), /LAB_LIST_CHANGED must be 0 or 1/);
  assert.throws(() => configFromEnv({ LAB_MALFORMED_VARIANT: "x" }), /LAB_MALFORMED_VARIANT/);
  assert.throws(() => configFromEnv({ LAB_TIMEOUT_MS: "0" }), /LAB_TIMEOUT_MS/);
});

test("configFromEnv reads overrides and splits LAB_ALLOWED_HOSTS", () => {
  const c = configFromEnv({ LAB_MODE: "timeout", LAB_TIMEOUT_MS: "400", LAB_ALLOWED_HOSTS: "P4-Attack-Lab:9010, 127.0.0.1:9010", LAB_AUTH: "1" });
  assert.equal(c.mode, "timeout");
  assert.equal(c.timeoutMs, 400);
  assert.equal(c.auth, true);
  assert.deepEqual(c.allowedHosts, ["p4-attack-lab:9010", "127.0.0.1:9010"]);
});
