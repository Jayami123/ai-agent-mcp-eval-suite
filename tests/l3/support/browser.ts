import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { installAuth, type UiPage } from "../../../src/ui/librechat.js";
import { writeEvidence } from "../../l1/evidence.js";
import type { L3Stack } from "./stack.js";

// Playwright for the LibreChat UI cases. The browser is Chromium, launched headless; CI installs it with
// `npx playwright install --with-deps chromium`. The page is signed in with the API bearer token the harness adapter returned
// (see installAuth in src/ui/librechat.ts for how and why). Cases use this only to look at and operate LibreChat's own UI.

export interface UiSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Every popup the page opened, every navigation of the main frame, and every request to a host other than LibreChat's. */
  watch: { popups: string[]; navigations: string[]; foreign: string[] };
  close(): Promise<void>;
}

export async function openUi(stack: L3Stack): Promise<UiSession> {
  const s = stack.session;
  const userRes = await fetch(`${s.baseUrl}/api/user`, { headers: { authorization: s.authorizationHeader, "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" }, signal: AbortSignal.timeout(30_000) });
  if (userRes.status !== 200) throw new Error(`UI_USER_HTTP_${userRes.status}: GET /api/user did not return the signed-in user`);
  const user = (await userRes.json()) as unknown;
  const token = s.authorizationHeader.replace(/^Bearer\s+/i, "");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const watch: UiSession["watch"] = { popups: [], navigations: [], foreign: [] };
  const home = new URL(s.baseUrl).origin;
  context.on("page", (p) => {
    if (p !== page) watch.popups.push(p.url());
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) watch.navigations.push(f.url());
  });
  page.on("request", (r) => {
    const o = new URL(r.url()).origin;
    if (o !== home && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) watch.foreign.push(r.url());
  });
  await installAuth(page as unknown as UiPage, { token, user });
  return { browser, context, page, watch, close: () => browser.close() };
}

/** A screenshot into evidence/. The page shows the signed-in owner's fake data only; no token is on screen. */
export async function shot(ui: UiSession, dir: string, name: string): Promise<void> {
  const png = await ui.page.screenshot({ fullPage: false });
  writeEvidence(dir, `${name}.png`, "");
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.writeFileSync(path.resolve(process.cwd(), "evidence", dir, `${name}.png`), png);
}
