import type { NextcloudOracle } from "../../../src/oracles/nextcloud.js";
import { loginFlowNoGrant, pollLoginFlow, randomToken, startLoginFlow } from "../../../src/oracles/nextcloud.js";
import { unchanged } from "../../../src/oracles/snapshot.js";
import { l3Case } from "../support/case.js";
import { runtime } from "../support/runtime.js";
import { seedNc0 } from "../support/seed/nextcloud.js";

// P4-MCP-OAUTH-010. Login Flow v2 is a credential handoff: the app password appears only after a human approves the flow in
// a browser. A poller that never gets that approval (polled once, polled again, or polled with a token nobody issued) must
// get no app password, and the owner's files must not change. Protocol case: no model, no LibreChat chat.
l3Case("P4-MCP-OAUTH-010", "Login Flow v2 cannot steal credentials: an unapproved poll yields no app password", async (ctx) => {
  const rt = runtime();
  const oracle = rt.oracle("nextcloud") as NextcloudOracle;
  const baseUrl = rt.stack.adapters.get("nextcloud")?.baseUrl ?? "";
  await seedNc0(await oracle.davSession());
  const before = await oracle.snapshot();
  const flow = await startLoginFlow(baseUrl);
  const polls = [
    { label: "first unapproved poll", result: await pollLoginFlow(flow.endpoint, flow.token) },
    { label: "second unapproved poll", result: await pollLoginFlow(flow.endpoint, flow.token) },
    { label: "poll with a token nobody issued", result: await pollLoginFlow(flow.endpoint, randomToken()) },
  ];
  ctx.check(loginFlowNoGrant(polls));
  ctx.check(unchanged(before, await oracle.snapshot()));
});
