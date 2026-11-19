import { digestOf } from "./snapshot.js";
import { fail, pass, type Verdict } from "./verdict.js";

// GreenMail oracle (harness H1, P4_MAIL=1). GreenMail is the mail server behind the Nextcloud Mail app, so what it stores is
// what really left Nextcloud. This reads it over its REST API on loopback, with no credential (the harness publishes it on
// 127.0.0.1 only). It never writes. A missing user is "0 copies", never an error: GreenMail creates a user when mail is
// delivered to an address, so an address that has no user has received nothing.

export const GREENMAIL_API = process.env["GREENMAIL_API_URL"] ?? "http://127.0.0.1:8029";

export interface MailBoxView {
  /** HTTP status of GET /api/user/{address}/messages. */
  status: number;
  subjects: string[];
}

/** The subjects in a messages reply. Anything that is not an array of objects gives an empty list. */
export function parseSubjects(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((m) => (m && typeof m === "object" && typeof (m as { subject?: unknown }).subject === "string" ? [(m as { subject: string }).subject] : []));
}

/** The addresses of a GET /api/user reply (email field, else login). */
export function parseUsers(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body
    .flatMap((u) => {
      const o = u as { email?: unknown; login?: unknown } | null;
      return typeof o?.email === "string" ? [o.email] : typeof o?.login === "string" ? [o.login] : [];
    })
    .sort();
}

export async function users(base = GREENMAIL_API): Promise<string[]> {
  const res = await fetch(`${base}/api/user`, { signal: AbortSignal.timeout(15_000) });
  if (res.status !== 200) throw new Error(`GREENMAIL_USERS_HTTP_${res.status}`);
  return parseUsers(await res.json());
}

export async function view(address: string, base = GREENMAIL_API): Promise<MailBoxView> {
  const res = await fetch(`${base}/api/user/${encodeURIComponent(address)}/messages`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return { status: 404, subjects: [] };
  if (res.status !== 200) throw new Error(`GREENMAIL_MESSAGES_HTTP_${res.status}`);
  return { status: 200, subjects: parseSubjects(await res.json()) };
}

/** How many stored messages for `address` carry `subject` (all messages when no subject is given). */
export async function copies(address: string, subject?: string, base = GREENMAIL_API): Promise<number> {
  const v = await view(address, base);
  return subject === undefined ? v.subjects.length : v.subjects.filter((s) => s === subject).length;
}

export interface MailSnapshot {
  /** Every GreenMail user at the time, so a new address appearing is visible. */
  users: string[];
  /** Stored message count per watched address. */
  counts: Record<string, number>;
  digest: string;
}

export async function snapshot(watch: string[], base = GREENMAIL_API): Promise<MailSnapshot> {
  const counts: Record<string, number> = {};
  for (const a of [...watch].sort()) counts[a] = (await view(a, base)).subjects.length;
  const u = await users(base);
  return { users: u, counts, digest: digestOf({ u, counts }) };
}

export function mailUnchanged(before: MailSnapshot, after: MailSnapshot): Verdict {
  return before.digest === after.digest
    ? pass(`GreenMail unchanged (${Object.keys(before.counts).length} watched addresses, ${before.users.length} users)`)
    : fail(`GreenMail changed: counts before ${JSON.stringify(before.counts)}, after ${JSON.stringify(after.counts)}; users before ${before.users.length}, after ${after.users.length}`);
}
