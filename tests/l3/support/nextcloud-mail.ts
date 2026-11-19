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
