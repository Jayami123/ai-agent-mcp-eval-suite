import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appContainer, occAsWww } from "./nc-log.js";
import { mailboxes, ncMailClient, ownerMailAccount, type NcMailClient } from "./nextcloud-mail.js";
import type { L3Stack } from "./stack.js";

// Mail for the NCMAIL cases, delivered into the owner's INBOX over SMTP from the Nextcloud app container to GreenMail
// (greenmail:3025). It does not use the Mail app's outbox, which returns 500 on this stack (docs/findings/l3-always-allow.md).
// Then `occ mail:account:sync` lets the Mail app list the INBOX. Fake data only. GreenMail's REST API has no send route.

export const OWNER = "qa-owner@p4.test";
const SEED_FROM = "p4l3-seed@p4.test";

export interface SeedMail {
  /** Envelope and header sender. Fake. */
  from: string;
  /** The owner's address (a GreenMail user, created by the harness). */
  to: string;
  subject: string;
  /** Plain text. Lines starting with "." are dot-stuffed here. */
  body: string;
}

/** An RFC 5322 message with CRLF line ends and dot-stuffed body lines. Pure: unit tested. */
export function rfc822(m: SeedMail, now: Date = new Date(), id: string = randomUUID()): string {
  const body = m.body.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line));
  return [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${m.subject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@p4.test>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    ...body,
  ].join("\r\n") + "\r\n";
}

// The SMTP client, run in bash inside the app container. Reply codes only are printed. The message arrives on stdin.
const SMTP_SCRIPT = [
  "exec 3<>/dev/tcp/greenmail/3025 || { echo 'connect failed'; exit 2; }",
  "rd() { local l; while read -t 10 -r l <&3; do if [[ $l =~ ^([0-9]{3})[[:space:]] ]]; then echo \"${BASH_REMATCH[1]}\"; return 0; fi; done; echo 000; return 1; }",
  "echo \"greeting $(rd)\"",
  "printf 'EHLO p4.test\\r\\n' >&3; echo \"ehlo $(rd)\"",
  "printf 'MAIL FROM:<%s>\\r\\n' \"$1\" >&3; echo \"mail $(rd)\"",
  "printf 'RCPT TO:<%s>\\r\\n' \"$2\" >&3; echo \"rcpt $(rd)\"",
  "printf 'DATA\\r\\n' >&3; echo \"data $(rd)\"",
  "cat >&3; printf '.\\r\\n' >&3; echo \"end $(rd)\"",
  "printf 'QUIT\\r\\n' >&3; rd >/dev/null 2>&1 || true",
].join("\n");

/** The reply codes the SMTP script printed, as name to code. Pure: unit tested. */
export function parseSmtpReplies(out: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = /^(greeting|ehlo|mail|rcpt|data|end) (\d{3})$/.exec(line.trim());
    if (m !== null && m[1] !== undefined && m[2] !== undefined) r[m[1]] = m[2];
  }
  return r;
}

/** True when every step got the reply the protocol requires (220, 250, 250, 250, 354, 250). Pure. */
export function smtpDelivered(r: Record<string, string>): boolean {
  return r["greeting"] === "220" && r["ehlo"] === "250" && r["mail"] === "250" && r["rcpt"] === "250" && r["data"] === "354" && r["end"] === "250";
}

/** Delivers one message into GreenMail through the app container. Returns the reply codes. Never prints the message. */
export function smtpDeliver(m: SeedMail): Record<string, string> {
  const name = appContainer();
  if (name === undefined) throw new Error("NC_MAIL_SEED_NO_APP_CONTAINER: no nextcloud-app container");
  const r = spawnSync("docker", ["exec", "-i", name, "bash", "-c", SMTP_SCRIPT, "smtp", SEED_FROM, m.to], {
    input: rfc822({ ...m, from: m.from }),
    encoding: "utf8",
    timeout: 120_000,
  });
  const replies = parseSmtpReplies(`${r.stdout ?? ""}`);
  if (!smtpDelivered(replies)) throw new Error(`NC_MAIL_SEED_SMTP_REPLIES: ${JSON.stringify(replies)} (exit ${r.status})`);
  return replies;
}

export interface OwnerMail {
  client: NcMailClient;
  accountId: number;
  inboxId: number;
}

/** The owner's account id and INBOX id, read from the Mail API at run time (never stored). */
export async function ownerMail(stack: L3Stack): Promise<OwnerMail> {
  const client = await ncMailClient(stack);
  const account = await ownerMailAccount(stack, OWNER);
  const inbox = (await mailboxes(client, account.id)).find((b) => b.name === "INBOX");
  if (inbox === undefined) throw new Error("NC_MAIL_NO_INBOX: the owner's account has no INBOX");
  return { client, accountId: account.id, inboxId: inbox.databaseId };
}

/**
 * Seeds one message into the owner's INBOX, syncs the Mail app, and returns the message's database id (read back from
 * nc_mail_list_messages, so the id is real). Throws when the message is not listed after the sync: the seed did not work.
 */
export async function seedInbox(stack: L3Stack, m: { subject: string; body: string; from?: string }): Promise<{ messageId: number; owner: OwnerMail }> {
  const owner = await ownerMail(stack);
  smtpDeliver({ from: m.from ?? SEED_FROM, subject: m.subject, body: m.body, to: OWNER });
  const sync = occAsWww(["mail:account:sync", String(owner.accountId)]);
  if (sync.status !== 0) throw new Error(`NC_MAIL_SYNC_EXIT_${sync.status}: mail:account:sync failed`);
  const list = (await owner.client.call("nc_mail_list_messages", { mailbox_id: owner.inboxId, limit: 100 })) as {
    results?: Array<{ databaseId?: unknown; subject?: unknown }>;
  };
  const hit = (list.results ?? []).find((x) => x.subject === m.subject && typeof x.databaseId === "number");
  if (hit === undefined || typeof hit.databaseId !== "number") throw new Error("NC_MAIL_SEED_NOT_LISTED: the seeded message is not in the INBOX after the sync");
  return { messageId: hit.databaseId, owner };
}

/** A digest of any JSON value, for before and after comparisons. Only the hash is kept. */
export function digestJson(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
}

/**
 * The run-time ids the NCMAIL fixtures use, as the stub's bindings (values are digits, sent as numbers). Set in one PUT per case,
 * because the stub replaces its whole binding map on each PUT.
 */
export function ownerBindings(o: OwnerMail, messageId?: number): Record<string, string> {
  return {
    OWNER_ACCOUNT_ID: String(o.accountId),
    OWNER_INBOX_ID: String(o.inboxId),
    ...(messageId === undefined ? {} : { OWNER_MESSAGE_ID: String(messageId) }),
  };
}
