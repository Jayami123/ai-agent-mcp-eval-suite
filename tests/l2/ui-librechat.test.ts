import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_NAMES,
  COMPOSER_TEST_ID,
  decide,
  dialogTexts,
  installAuth,
  mentions,
  openAgentChat,
  redactText,
  sendMessage,
  waitForApproval,
  type UiLocator,
  type UiPage,
  type UiRoute,
} from "../../src/ui/librechat.js";

// L2 unit tests for the LibreChat UI driver. A fake page records every call, so the tests check that the driver uses
// accessible-name locators, in the right order, and never touches a token it was given beyond the one refresh answer.

interface Call {
  what: string;
}

function fakePage(opts: { visible?: Record<string, boolean>; texts?: Record<string, string[]> } = {}): { page: UiPage; calls: Call[]; routes: Array<(r: UiRoute) => Promise<void> | void> } {
  const calls: Call[] = [];
  const routes: Array<(r: UiRoute) => Promise<void> | void> = [];
  const locator = (label: string, index = 0): UiLocator => ({
    click: async () => void calls.push({ what: `click ${label}` }),
    fill: async (v) => void calls.push({ what: `fill ${label} ${v}` }),
    press: async (k) => void calls.push({ what: `press ${label} ${k}` }),
    waitFor: async (o) => {
      calls.push({ what: `waitFor ${label} ${o?.state ?? ""}` });
      if (opts.visible?.[label] === false) throw new Error("timeout");
    },
    count: async () => opts.texts?.[label]?.length ?? 0,
    isVisible: async () => opts.visible?.[label] !== false,
    innerText: async () => opts.texts?.[label]?.[index] ?? "",
    ariaSnapshot: async () => `- document ${label}`,
    first: () => locator(label, 0),
    ...({ nth: (i: number) => locator(label, i) } as object),
  });
  const page: UiPage = {
    goto: async (u) => void calls.push({ what: `goto ${u}` }),
    url: () => "http://127.0.0.1/c/new",
    getByRole: (role, o) => locator(`role:${role}:${String(o?.name)}`),
    getByTestId: (id) => locator(`testid:${id}`),
    locator: (s) => locator(`css:${s}`),
    route: async (_u, h) => void routes.push(h),
  };
  return { page, calls, routes };
}

test("openAgentChat selects the agent in the URL and waits for the composer by its test id", async () => {
  const { page, calls } = fakePage();
  await openAgentChat(page, "http://127.0.0.1:3080", "agent_a b");
  assert.equal(calls[0]?.what, "goto http://127.0.0.1:3080/c/new?agent_id=agent_a%20b");
  assert.equal(calls[1]?.what, `waitFor testid:${COMPOSER_TEST_ID} visible`);
});

test("sendMessage fills the composer, then presses Enter", async () => {
  const { page, calls } = fakePage();
  await sendMessage(page, "hello");
  assert.deepEqual(calls.map((c) => c.what), [`fill testid:${COMPOSER_TEST_ID} hello`, `press testid:${COMPOSER_TEST_ID} Enter`]);
});

test("decide clicks the decision by its accessible name, then the submit button", async () => {
  const { page, calls } = fakePage();
  await decide(page, "reject");
  assert.deepEqual(calls.map((c) => c.what), [`click role:button:${APPROVAL_NAMES.reject}`, `click role:button:${String(APPROVAL_NAMES.submit)}`]);
});

test("waitForApproval is true when the approve button shows, false when it does not", async () => {
  assert.equal(await waitForApproval(fakePage().page, 10), true);
  assert.equal(await waitForApproval(fakePage({ visible: { "role:button:Approve": false } }).page, 10), false);
});

test("dialogTexts collects dialog, alertdialog and alert text, and skips empty ones", async () => {
  const { page } = fakePage({ texts: { "role:dialog:undefined": ["Open p4-attack-lab:9010?"], "role:alert:undefined": ["  ", "Oops"] } });
  assert.deepEqual(await dialogTexts(page), ["dialog: Open p4-attack-lab:9010?", "alert: Oops"]);
});

test("installAuth answers only POST /api/auth/refresh, with the token and user in the body", async () => {
  const { page, routes } = fakePage();
  await installAuth(page, { token: "tok-123456", user: { id: "u1" } });
  const seen: string[] = [];
  const route = (method: string): UiRoute => ({
    request: () => ({ method: () => method }),
    continue: async () => void seen.push("continue"),
    fulfill: async (r) => void seen.push(`fulfill ${String(r.status)} ${String(r.body)}`),
  });
  await routes[0]?.(route("GET"));
  await routes[0]?.(route("POST"));
  assert.equal(seen[0], "continue");
  assert.equal(seen[1], 'fulfill 200 {"token":"tok-123456","user":{"id":"u1"}}');
});

test("mentions ignores case and white space; redactText hides secrets of 6 characters or more", () => {
  assert.equal(mentions("Server:  P4-Attack-Lab\n at http://x:9010", "p4-attack-lab at"), true);
  assert.equal(mentions("nothing here", "p4-attack-lab"), false);
  assert.equal(redactText("Bearer abcdef123 and abc", ["abcdef123", "abc"]), "Bearer [redacted] and abc");
});
