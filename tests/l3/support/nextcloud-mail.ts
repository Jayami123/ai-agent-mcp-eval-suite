import { McpHttpClient } from "./mcp-client.js";
import type { L3Stack } from "./stack.js";

// Reads and calls Nextcloud's own MCP tools for the Mail app (nc_mail_*) with the owner's credential, which the harness wrote to
// its run-state file. Tool and field names are those the harness uses in its own live check (nextcloud-mail-seed.ts).

export interface NcMailClient {
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/** The text or structured payload of a tools/call reply, parsed as JSON when it is. Never includes the credential. */
export function toolPayload(body: unknown): unknown {
  const result = (body as { result?: { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }>; isError?: boolean } }).result;
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.find((c) => c.type === "text")?.text;
  if (text === undefined) return body;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function ncMailClient(stack: L3Stack): Promise<NcMailClient> {
  const ep = stack.mcp("nextcloud");
  const client = new McpHttpClient(ep.url, ep.authorization);
  await client.initialize();
  return { call: async (tool, args) => toolPayload((await client.callTool(tool, args)).body) };
}

export interface MailAccount {
  id: number;
  emailAddress: string;
}

export async function accounts(c: NcMailClient): Promise<MailAccount[]> {
  const r = (await c.call("nc_mail_list_accounts", {})) as { results?: Array<{ id?: unknown; emailAddress?: unknown }> };
  return (r.results ?? []).flatMap((a) => (typeof a.id === "number" && typeof a.emailAddress === "string" ? [{ id: a.id, emailAddress: a.emailAddress }] : []));
}

export interface Mailbox {
  name: string;
  databaseId: number;
}

export async function mailboxes(c: NcMailClient, accountId: number): Promise<Mailbox[]> {
  const r = (await c.call("nc_mail_list_mailboxes", { account_id: accountId })) as { results?: Array<{ name?: unknown; databaseId?: unknown }> };
  return (r.results ?? []).flatMap((m) => (typeof m.name === "string" && typeof m.databaseId === "number" ? [{ name: m.name, databaseId: m.databaseId }] : []));
}

export async function subjects(c: NcMailClient, mailboxId: number): Promise<string[]> {
  const r = (await c.call("nc_mail_list_messages", { mailbox_id: mailboxId, limit: 100 })) as { results?: Array<{ subject?: unknown }> };
  return (r.results ?? []).flatMap((m) => (typeof m.subject === "string" ? [m.subject] : []));
}

import { digestOf } from "../../../src/oracles/snapshot.js";
import { parseMailAppSubjects } from "../../../src/oracles/greenmail.js";

/**
 * The owner's Sent store as the Nextcloud Mail app holds it. The Mail app caches a mailbox and the stack has no cron, so a send
 * is not in the cache until the mailbox is synced. Observed (wave D probe, CI run 44591815424): the MCP list of Sent is empty
 * right after a send; after POST /index.php/apps/mail/api/mailboxes/{id}/sync with {"init":true,"ids":[]} (HTTP 200) the
 * message is listed. This does that sync with the owner's own credential, then reads GET /apps/mail/api/messages.
 */
export async function sentStore(stack: L3Stack): Promise<{ subjects: string[]; digest: string }> {
  const ep = stack.mcp("nextcloud");
  if (ep.authorization === null) throw new Error("L3_NO_NC_CREDENTIAL: the Nextcloud MCP run state has no credential");
  const base = (stack.adapters.get("nextcloud") as { baseUrl: string }).baseUrl;
  const c = await ncMailClient(stack);
  const acct = (await accounts(c))[0];
  if (acct === undefined) throw new Error("L3_NO_MAIL_ACCOUNT: the owner has no Mail account (is P4_MAIL=1 set?)");
  const sent = (await mailboxes(c, acct.id)).find((b) => b.name === "Sent");
  if (sent === undefined) throw new Error("L3_NO_SENT_MAILBOX: the owner's account has no Sent mailbox");
  const h = { authorization: ep.authorization, "OCS-APIRequest": "true", accept: "application/json", "content-type": "application/json" };
  const sync = await fetch(`${base}/index.php/apps/mail/api/mailboxes/${sent.databaseId}/sync`, { method: "POST", headers: h, body: JSON.stringify({ init: true, ids: [] }), signal: AbortSignal.timeout(60_000) });
  if (sync.status !== 200) throw new Error(`L3_SENT_SYNC_HTTP_${sync.status}`);
  const list = await fetch(`${base}/index.php/apps/mail/api/messages?mailboxId=${sent.databaseId}&limit=100`, { headers: h, signal: AbortSignal.timeout(30_000) });
  if (list.status !== 200) throw new Error(`L3_SENT_LIST_HTTP_${list.status}`);
  const subjects = parseMailAppSubjects(await list.json()).sort();
  return { subjects, digest: digestOf(subjects) };
}
