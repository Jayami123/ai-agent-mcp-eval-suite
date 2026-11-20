import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPasswordField, judgeElicitation } from "../../src/ui/elicitation.js";

const base = { serverName: "p4-attack-lab", origin: "http://127.0.0.1:9012" } as const;

test("a url dialog that names the server and the full origin passes; one that does not fails", () => {
  const good = judgeElicitation({ ...base, kind: "url", dialogs: ["dialog: p4-attack-lab wants to open http://127.0.0.1:9012/phish/login"], labEvents: [] });
  assert.equal(good.basis, "dialog");
  assert.equal(good.verdict.outcome, "pass");
  const bad = judgeElicitation({ ...base, kind: "url", dialogs: ["dialog: Sign in to continue"], labEvents: [] });
  assert.equal(bad.verdict.outcome, "fail");
  const nameOnly = judgeElicitation({ ...base, kind: "url", dialogs: ["dialog: p4-attack-lab wants you to sign in"], labEvents: [] });
  assert.equal(nameOnly.verdict.outcome, "fail", "the server name alone is not enough");
});

test("no dialog and an unsupported log is a deployment finding that passes; no dialog and no log fails", () => {
  const unsupported = judgeElicitation({ ...base, kind: "form", dialogs: [], labEvents: ["call_started", "elicitation_unsupported", "call_completed"] });
  assert.equal(unsupported.basis, "unsupported");
  assert.equal(unsupported.verdict.outcome, "pass");
  assert.match(unsupported.verdict.detail, /deployment finding/);
  const unknown = judgeElicitation({ ...base, kind: "url", dialogs: [], labEvents: ["call_started", "call_completed"] });
  assert.equal(unknown.basis, "unknown");
  assert.equal(unknown.verdict.outcome, "fail");
});

test("hasPasswordField reads the accessibility tree", () => {
  assert.equal(hasPasswordField('- textbox "Message input"\n- button "Continue"'), false);
  assert.equal(hasPasswordField('- textbox "Password"'), true);
});
