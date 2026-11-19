// Wave D live probe, mail half (docs/findings/l3-wave-d.md). Runs only with P4_L3_PROBE=1. Records what the real stack does:
// the Nextcloud mail tools, GreenMail's REST replies, the Mail app's Sent store, and the LibreChat approval pause for a mail
// send (including the edit decision). Prints PROBE| lines. It asserts nothing about the product: the case files do that.
import { test } from "node:test";
import { mcpToolName } from "../../l1/librechat-client.js";
import { chatWithApproval } from "../support/approval.js";
import { labLog, sinkRecords } from "../support/lab.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { accounts, mailboxes, ncMailClient, subjects, toolPayload } from "../support/nextcloud-mail.js";
import { bootRuntime, runtime } from "../support/runtime.js";
import { GREENMAIL_API, users, view } from "../../../src/oracles/greenmail.js";
import { probe, setProbeSecrets } from "./log.js";

// The entry (mail.e2e.ts) sets P4_MAIL and the approval policy before this file is imported, because the harness reads them once.
bootRuntime(["nextcloud", "lab"], "probe-mail");

const A = "p4l3-probe-a@p4.test";
const B = "p4l3-probe-b@p4.test";

test("probe: mail oracles and approval pause on the real stack", { timeout: 40 * 60_000 }, async () => {
  const rt = runtime();
  setProbeSecrets(rt.stack.secrets());
  const nc = rt.stack.mcp("nextcloud");

  // 1. Tool list and schema of the send tool, as LibreChat will see it.
  const raw = new McpHttpClient(nc.url, nc.authorization);
  const init = await raw.initialize();
  probe("nc.initialize.serverInfo", (init.body as { result?: { serverInfo?: unknown } }).result?.serverInfo);
  const tools = await raw.listTools();
  const send = tools.find((t) => t.name === "nc_mail_send_message");
  probe("nc.send.tool", { name: send?.name, annotations: send?.annotations, inputSchema: send?.inputSchema });

  // 2. Accounts and mailboxes.
  const c = await ncMailClient(rt.stack);
  const accts = await accounts(c);
  probe("nc.accounts", accts);
  const acct = accts[0];
  if (acct === undefined) throw new Error("PROBE_NO_ACCOUNT");
  const boxes = await mailboxes(c, acct.id);
  probe("nc.mailboxes", boxes);
  const sent = boxes.find((b) => /sent/i.test(b.name));

  // 3. GreenMail REST shapes.
  probe("greenmail.users", await users());
  for (const path of ["/api/user", `/api/user/${encodeURIComponent(A)}/messages`, `/api/user/${encodeURIComponent(acct.emailAddress)}/messages`, `/api/user/${encodeURIComponent(acct.emailAddress)}/folders`, "/api/configuration"]) {
    const r = await fetch(`${GREENMAIL_API}${path}`, { signal: AbortSignal.timeout(15_000) });
    const t = await r.text();
    probe(`greenmail.GET ${path.replace(A, "<A>").replace(acct.emailAddress, "<owner>")}`, { status: r.status, body: t.slice(0, 160) });
  }
  probe("greenmail.view(unknown address)", await view(`p4l3-never-${Date.now()}@p4.test`));

  // 4. A direct send through the MCP: what does GreenMail and the Sent store show, and how soon.
  const beforeSent = sent === undefined ? [] : await subjects(c, sent.databaseId);
  probe("sent.before(count, no sync)", beforeSent.length);
  const direct = await raw.callTool("nc_mail_send_message", { account_id: acct.id, to: [{ email: A }], subject: "p4l3 probe direct", body: "fake body" });
  probe("nc.send.reply", { status: direct.status, payload: toolPayload(direct.body) });
  for (let i = 0; i < 8; i += 1) {
    const v = await view(A);
    probe(`greenmail.A after send t+${i * 2}s`, { status: v.status, subjects: v.subjects });
    if (v.subjects.length > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  probe("greenmail.users after send", await users());
  probe("greenmail.owner INBOX view after send", (await view(acct.emailAddress)).subjects);
  const afterSent = sent === undefined ? [] : await subjects(c, sent.databaseId);
  probe("sent.after MCP list (no sync)", afterSent);
  // Mail app HTTP: a sync of the Sent mailbox, then the same list. Uses the owner's own credential; prints status and counts only.
  if (sent !== undefined && nc.authorization !== null) {
    const base = rt.stack.adapters.get("nextcloud")?.baseUrl ?? "http://127.0.0.1:8080";
    const h = { authorization: nc.authorization, "OCS-APIRequest": "true", accept: "application/json", "content-type": "application/json" };
    for (const method of ["POST", "GET"]) {
      const r = await fetch(`${base}/index.php/apps/mail/api/mailboxes/${sent.databaseId}/sync`, { method, headers: h, body: method === "POST" ? JSON.stringify({ init: true, ids: [] }) : undefined, signal: AbortSignal.timeout(60_000) });
      probe(`mail.http sync ${method}`, { status: r.status, bodyStart: (await r.text()).slice(0, 200) });
    }
    probe("sent.after http sync (MCP list)", await subjects(c, sent.databaseId));
    const r = await fetch(`${base}/index.php/apps/mail/api/messages?mailboxId=${sent.databaseId}&limit=20`, { headers: h, signal: AbortSignal.timeout(30_000) });
    const t = await r.text();
    probe("mail.http messages", { status: r.status, bodyStart: t.slice(0, 300) });
  }

  // 5. The approval pause for a mail send through LibreChat, and the edit decision.
  const tool = mcpToolName("nc_mail_send_message", "nextcloud");
  let pauseNo = 0;
  const run = await chatWithApproval(rt.stack, {
    fixture: "p4-mcp-appr-003",
    prompt: "Send the draft.",
    tools: [tool],
    decide: (call) => {
      pauseNo += 1;
      probe(`appr.pause#${pauseNo}`, { name: call.name, allowed: call.allowed, args: call.args });
      return pauseNo === 1 ? { decision: "edit", editedArguments: { account_id: acct.id, to: [{ email: B }], subject: "p4l3 probe edited", body: "fake body" } } : "reject";
    },
    maxPauses: 3,
    timeoutMs: 120_000,
  });
  probe("appr.run", { pauses: run.pauses.map((p) => ({ names: p.calls.map((x) => x.name), sent: p.sent })), finished: run.finished });
  await new Promise((r) => setTimeout(r, 6000));
  probe("greenmail.A after edit flow", await view(A));
  probe("greenmail.B after edit flow", await view(B));
  probe("greenmail.users after edit flow", await users());

  // 6. The shadow tool through LibreChat: does it get its own pause, what does the pause call it.
  const shadow = mcpToolName("nc_mail_send_message", "lab");
  const run2 = await chatWithApproval(rt.stack, {
    fixture: "p4-mcp-meta-003-shadow",
    prompt: "Send the note.",
    tools: [shadow],
    decide: (call) => {
      probe("shadow.pause", { name: call.name, allowed: call.allowed, args: call.args });
      return "reject";
    },
    maxPauses: 2,
    timeoutMs: 120_000,
  });
  probe("shadow.run", { pauses: run2.pauses.length, finished: run2.finished });
  probe("lab.log(tail)", (await labLog()).slice(-8));
  probe("lab.sink.records", (await sinkRecords()).length);
});
