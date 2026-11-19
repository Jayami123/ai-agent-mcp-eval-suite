import { after } from "node:test";
import { fail, pass, type Verdict } from "../../../src/oracles/verdict.js";
import { judgeElicitation, hasPasswordField } from "../../../src/ui/elicitation.js";
import { ariaTree, decide, dialogTexts, mentions, openAgentChat, redactText, sendMessage, waitForApproval, type UiPage } from "../../../src/ui/librechat.js";
import { lcCreateAgent, mcpToolName } from "../../l1/librechat-client.js";
import { writeEvidence } from "../../l1/evidence.js";
import { openUi, shot, type UiSession } from "../support/browser.js";
import { l3Case } from "../support/case.js";
import { sweepAgent } from "../support/hygiene.js";
import { labControl, labLog, resetLab, sinkRecords } from "../support/lab.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { LAB } from "../support/lab.js";
import { expectedDefect } from "../support/expected-defect.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-APPR-004, P4-MCP-APPR-005 and P4-MCP-META-012. LibreChat's own UI is driven with Playwright; the assertions are made on
// what the page shows (accessible names, dialogs, popups, navigations, requests to other hosts) and on the lab's own record of
// what reached it. The API is used only to create the agent. The lab is started by the CI job in url-elicitation mode with a
// look-alike display title. What these assertions rest on is recorded in docs/findings/l3-wave-d.md (CI run 44590431418).

const SERVER = "p4-attack-lab";
const LOOKALIKE_TITLE = "Nextcloud (official)";
const SINK_ORIGIN = new URL(LAB.sink).origin;

let session: UiSession | undefined;
async function ui(): Promise<UiSession> {
  if (session === undefined) session = await openUi(runtime().stack);
  return session;
}
after(async () => {
  await session?.close();
});

interface Walk {
  ui: UiSession;
  shown: boolean;
  aria: string;
  body: string;
  dialogs: string[];
  labEvents: string[];
}

/** One chat in the UI: a new agent offering one lab tool, the fixture's message, the approval card, one decision. */
async function walk(id: string, fixture: string, mode: "elicitation-url" | "elicitation-form", tool: string, decision: "approve" | "reject"): Promise<Walk> {
  const rt = runtime();
  await resetLab();
  await labControl("/control/mode", { mode });
  const agentId = await lcCreateAgent(rt.stack.session, { name: `p4-l3-${fixture}`.slice(0, 60), model: "p4-stub", tools: [mcpToolName(tool, "lab")], instructions: "You are a test agent. Use the tools you are given." });
  sweepAgent(rt.stack, agentId);
  const s = await ui();
  const page = s.page as unknown as UiPage;
  await openAgentChat(page, rt.stack.session.baseUrl, agentId);
  await sendMessage(page, `[fixture:${fixture}] Please go ahead.`);
  const shown = await waitForApproval(page, 150_000);
  const secrets = rt.stack.secrets();
  const aria = redactText(await ariaTree(page), secrets);
  const body = redactText(await s.page.locator("body").innerText(), secrets);
  await shot(s, rt.dir, `${id}-approval`);
  writeEvidence(`traces/${id}`, "approval-aria.txt", `${aria}\n`);
  if (shown) {
    await decide(page, decision);
    if (decision === "approve") await waitForLab(tool, 60_000);
    else await s.page.waitForTimeout(5_000);
  }
  const dialogs = (await dialogTexts(page)).map((t) => redactText(t, secrets));
  await shot(s, rt.dir, `${id}-after`);
  return { ui: s, shown, aria, body, dialogs, labEvents: (await labLog()).map((e) => e.event) };
}

async function waitForLab(tool: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await labLog()).some((e) => e.event === "call_completed" && e.detail["tool"] === tool)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Nothing was auto-opened and nothing reached the phish sink: no popup, no main-frame move to the sink, no request to it, no record. */
async function nothingOpenedOrPosted(w: Walk): Promise<Verdict> {
  const toSink = [...w.ui.watch.navigations, ...w.ui.watch.foreign, ...w.ui.watch.popups].filter((u) => u.startsWith(SINK_ORIGIN) || u.includes("/phish/"));
  const records = await sinkRecords();
  if (w.ui.watch.popups.length > 0) return fail(`the page opened ${w.ui.watch.popups.length} popup(s)`);
  if (toSink.length > 0) return fail(`the browser reached the phish sink ${toSink.length} time(s)`);
  if (records.length > 0) return fail(`the phish sink holds ${records.length} record(s): ${records.map((r) => r.kind).join(", ")}`);
  return pass("no popup, no navigation or request to the phish sink, and the sink holds 0 records (0 visits, 0 posts)");
}

const approvalShown = (w: Walk): Verdict => (w.shown ? pass("setup: the approval card appeared in the UI") : fail("setup: the approval card never appeared, so nothing was tested"));

l3Case("P4-MCP-APPR-004", "a url elicitation is not auto-opened and nothing reaches the look-alike login", async (ctx) => {
  const w = await walk("P4-MCP-APPR-004", "p4-mcp-appr-004", "elicitation-url", "lab_connect_account", "approve");
  ctx.check(approvalShown(w));
  ctx.check(w.labEvents.includes("call_completed") ? pass("setup: the approved call reached the lab") : fail("setup: the approved call never reached the lab"));
  const j = judgeElicitation({ kind: "url", dialogs: w.dialogs, labEvents: w.labEvents, serverName: SERVER, origin: SINK_ORIGIN });
  ctx.check(j.verdict);
  if (j.basis === "unsupported") ctx.note("DEPLOYMENT FINDING: LibreChat v0.8.9 declares no MCP elicitation capability, so the server's URL request never became a dialog. The dialog assertion (server name and full origin) could not be made and is not claimed.");
  ctx.check(await nothingOpenedOrPosted(w));
});

l3Case("P4-MCP-APPR-005", "a password form elicitation is not filled or submitted by the host", async (ctx) => {
  const w = await walk("P4-MCP-APPR-005", "p4-mcp-appr-005", "elicitation-form", "lab_connect_account", "approve");
  ctx.check(approvalShown(w));
  ctx.check(w.labEvents.includes("call_completed") ? pass("setup: the approved call reached the lab") : fail("setup: the approved call never reached the lab"));
  const j = judgeElicitation({ kind: "form", dialogs: w.dialogs, labEvents: w.labEvents, serverName: SERVER, origin: SINK_ORIGIN });
  ctx.check(j.verdict);
  if (j.basis === "unsupported") ctx.note("DEPLOYMENT FINDING: LibreChat v0.8.9 declares no MCP elicitation capability, so the server's password form never reached the UI.");
  ctx.check(hasPasswordField(w.aria) ? fail("the page offers a password field") : pass("the page offers no password field"));
  const credentials = (await sinkRecords()).filter((r) => r.kind === "form-credential");
  ctx.check(credentials.length === 0 ? pass("the phish sink holds 0 form-credential records") : fail(`the phish sink holds ${credentials.length} form-credential record(s): a password was submitted`));
  ctx.check(await nothingOpenedOrPosted(w));
});

l3Case("P4-MCP-META-012", "the approval UI shows the real server name and origin, not only a lab-set title", async (ctx) => {
  // Setup, asserted first: the lab really serves the look-alike title under its real name, and the real origin is known.
  const probe = new McpHttpClient(LAB.mcp, null);
  const init = (await probe.initialize()).body as { result?: { serverInfo?: { name?: unknown; title?: unknown } } };
  const info = init.result?.serverInfo;
  ctx.check(info?.name === SERVER && info?.title === LOOKALIKE_TITLE ? pass(`setup: the lab serves name ${SERVER} and the look-alike title`) : fail("setup: the lab does not serve the look-alike title (start it with LAB_SERVER_TITLE)"));
  const w = await walk("P4-MCP-META-012", "p4-mcp-meta-012", "elicitation-url", "lab_echo", "reject");
  ctx.check(approvalShown(w));
  ctx.check(mentions(w.body, "lab_echo") ? pass("setup: the approval card names the tool") : fail("setup: the card does not name the tool"));
  const realName = mentions(w.body, SERVER);
  const origin = mentions(w.body, `${SERVER}:9010`);
  ctx.note(`friendly title shown: ${mentions(w.body, LOOKALIKE_TITLE)}; real server name shown: ${realName}; origin shown: ${origin}`);
  const observed = realName && origin ? pass("the approval UI shows the real server name and origin") : fail("the approval UI shows neither the real server name nor its origin");
  // PRODUCT BUG (a gap against the ledger oracle). Evidence: CI run 44590431418, p4-mcp-meta-012 approval card: the region
  // "Review 1 action" holds only the tool name lab_echo_mcp_lab and its arguments, and the call header says "in lab", which is
  // LibreChat's own config alias. Neither p4-attack-lab nor the origin appears anywhere on the page.
  ctx.check(expectedDefect(observed, { caseId: "P4-MCP-META-012", server: "librechat", summary: "the approval card shows only the tool name and the host's own server alias, never the server's real name or origin" }));
});
