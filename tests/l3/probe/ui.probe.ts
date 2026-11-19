// Wave D live probe, UI half (docs/findings/l3-wave-d.md). Drives LibreChat's own UI with Playwright and records what is on
// screen at each step: the accessibility tree, dialog text, popups, navigations, requests to other hosts, the lab's log and the
// phish sink. It asserts nothing: the case files do that from what this recorded.
import { test } from "node:test";
import { lcCreateAgent } from "../../l1/librechat-client.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { ariaTree, decide, dialogTexts, openAgentChat, sendMessage, waitForApproval, type UiPage } from "../../../src/ui/librechat.js";
import { labControl, labLog, labState, resetLab, sinkRecords } from "../support/lab.js";
import { openUi, shot } from "../support/browser.js";
import { bootRuntime, runtime } from "../support/runtime.js";
import { probe, setProbeSecrets } from "./log.js";

bootRuntime(["lab"], "probe-ui");

test("probe: LibreChat approval UI and elicitation on the real stack", { timeout: 40 * 60_000 }, async () => {
  const rt = runtime();
  setProbeSecrets(rt.stack.secrets());
  const ui = await openUi(rt.stack);
  try {
    probe("lab.state", await labState());
    for (const [fixture, mode, tool, decision] of [
      ["p4-mcp-appr-004", "elicitation-url", "lab_connect_account", "approve"],
      ["p4-mcp-appr-005", "elicitation-form", "lab_connect_account", "approve"],
      ["p4-mcp-meta-012", "elicitation-url", "lab_echo", "reject"],
    ] as const) {
      await resetLab();
      await labControl("/control/mode", { mode });
      const agentId = await lcCreateAgent(rt.stack.session, { name: `p4-probe-${fixture}`, model: "p4-stub", tools: [mcpToolName(tool, "lab")], instructions: "You are a test agent. Use the tools you are given." });
      const page = ui.page as unknown as UiPage;
      await openAgentChat(page, rt.stack.session.baseUrl, agentId);
      probe(`${fixture}.page.url`, ui.page.url());
      await sendMessage(page, `[fixture:${fixture}] Please go ahead.`);
      const shown = await waitForApproval(page, 150_000);
      probe(`${fixture}.approval.shown`, shown);
      probe(`${fixture}.approval.aria`, await ariaTree(page), 6000);
      probe(`${fixture}.approval.dialogs`, await dialogTexts(page));
      probe(`${fixture}.approval.bodyText`, await ui.page.locator("body").innerText(), 4000);
      await shot(ui, rt.dir, `${fixture}-approval`);
      if (shown) {
        await decide(page, decision);
        await ui.page.waitForTimeout(15_000);
        probe(`${fixture}.after.aria`, await ariaTree(page), 6000);
        probe(`${fixture}.after.dialogs`, await dialogTexts(page));
        await shot(ui, rt.dir, `${fixture}-after`);
      }
      probe(`${fixture}.watch`, ui.watch);
      probe(`${fixture}.lab.log`, (await labLog()).map((e) => ({ event: e.event, detail: e.detail })), 3000);
      probe(`${fixture}.sink.records`, (await sinkRecords()).map((r) => r.kind));
    }
  } finally {
    await resetLab().catch(() => undefined);
    await ui.close();
  }
});
