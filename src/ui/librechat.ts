// A small, reusable driver for LibreChat's own web UI. It is written against the minimal page and locator shapes below, which
// Playwright's Page and Locator satisfy, so this module needs no browser to be type-checked or unit tested (tests/l2/ui-*.test.ts
// drive it with a fake page). Locators are accessible-name locators only: role plus name, or the one test id LibreChat sets on the
// composer. Nothing here prints a token. The browser is launched by the caller (tests/l3/support/browser.ts).

export interface UiLocator {
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
  waitFor(options?: { state?: "attached" | "visible" | "hidden" | "detached"; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  innerText(options?: { timeout?: number }): Promise<string>;
  ariaSnapshot(options?: { timeout?: number }): Promise<string>;
  first(): UiLocator;
}

export interface UiRoute {
  fulfill(response: { status?: number; contentType?: string; body?: string }): Promise<void>;
  continue(): Promise<void>;
  request(): { method(): string };
}

export interface UiPage {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  url(): string;
  getByRole(role: string, options?: { name?: string | RegExp; exact?: boolean }): UiLocator;
  getByTestId(testId: string): UiLocator;
  locator(selector: string): UiLocator;
  route(url: string | RegExp, handler: (route: UiRoute) => Promise<void> | void): Promise<void>;
}

export type ApprovalDecision = "approve" | "reject";

/** Names LibreChat v0.8.9 gives the approval controls (client/src/locales/en/translation.json: com_ui_approve, com_ui_reject). The submit button is named "Continue" in the live UI (observed in the wave D probe, run 44589285958); it is disabled until a decision is selected. */
export const APPROVAL_NAMES = { approve: "Approve", reject: "Reject", submit: "Continue" } as const;

/** The composer test id (client/src/components/Chat/Input/ChatForm.tsx). */
export const COMPOSER_TEST_ID = "text-input";

/**
 * LibreChat's browser client gets its access token from POST /api/auth/refresh on every page load, using a refresh cookie it
 * received at login. The harness does not export the owner's password, so a test that holds only the API bearer token
 * answers that one call itself, with the token and the user it read from GET /api/user. Every other request goes to the real
 * server. The token is placed in the response body only and is never logged.
 */
export async function installAuth(page: UiPage, auth: { token: string; user: unknown }): Promise<void> {
  await page.route(/\/api\/auth\/refresh/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: auth.token, user: auth.user }) });
  });
}

/** Opens a new chat with the given agent selected. */
export async function openAgentChat(page: UiPage, baseUrl: string, agentId: string, timeoutMs = 60_000): Promise<void> {
  await page.goto(`${baseUrl}/c/new?agent_id=${encodeURIComponent(agentId)}`, { timeout: timeoutMs });
  await page.getByTestId(COMPOSER_TEST_ID).waitFor({ state: "visible", timeout: timeoutMs });
}

/** Types into the composer and sends with Enter. */
export async function sendMessage(page: UiPage, text: string, timeoutMs = 30_000): Promise<void> {
  const composer = page.getByTestId(COMPOSER_TEST_ID);
  await composer.fill(text, { timeout: timeoutMs });
  await composer.press("Enter", { timeout: timeoutMs });
}

/** Waits until an approve control is on screen. Returns false when none appeared within the time. */
export async function waitForApproval(page: UiPage, timeoutMs = 120_000): Promise<boolean> {
  try {
    await page.getByRole("button", { name: APPROVAL_NAMES.approve, exact: true }).first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Clicks one decision, then the submit button. */
export async function decide(page: UiPage, decision: ApprovalDecision, timeoutMs = 30_000): Promise<void> {
  await page.getByRole("button", { name: APPROVAL_NAMES[decision], exact: true }).first().click({ timeout: timeoutMs });
  await page.getByRole("button", { name: APPROVAL_NAMES.submit, exact: true }).first().click({ timeout: timeoutMs });
}

/** The accessibility tree of the whole page as text (role, name, level), the same text for the same DOM. */
export async function ariaTree(page: UiPage, timeoutMs = 15_000): Promise<string> {
  return page.locator("body").ariaSnapshot({ timeout: timeoutMs });
}

/** Text of every visible dialog, alert dialog and alert region: where a host would show an elicitation or approval notice. */
export async function dialogTexts(page: UiPage): Promise<string[]> {
  const out: string[] = [];
  for (const role of ["dialog", "alertdialog", "alert"]) {
    const l = page.getByRole(role);
    const n = await l.count();
    for (let i = 0; i < n; i += 1) {
      const text = await nth(l, i).innerText({ timeout: 5_000 }).catch(() => "");
      if (text.trim() !== "") out.push(`${role}: ${text.trim()}`);
    }
  }
  return out;
}

function nth(l: UiLocator, i: number): UiLocator {
  // Only first() is needed on the minimal shape; Playwright's nth(i) is used when present.
  const withNth = l as UiLocator & { nth?: (index: number) => UiLocator };
  return withNth.nth ? withNth.nth(i) : l.first();
}

/** True when `text` contains `needle`, ignoring case and runs of white space. A pure helper for the origin and name checks. */
export function mentions(text: string, needle: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ");
  return norm(text).includes(norm(needle));
}

/** Replaces each secret value in `text` with a marker, so a screenshot caption or log line cannot carry it. */
export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 6) out = out.split(s).join("[redacted]");
  return out;
}
