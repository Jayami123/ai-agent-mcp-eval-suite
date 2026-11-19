import { randomBytes } from "node:crypto";
import type { ProductAdapter } from "qa-portfolio-harness";
import type { ServerOracle } from "./index.js";
import { makeSnapshot, type Snapshot } from "./snapshot.js";
import { fail, pass, unverified, type Verdict } from "./verdict.js";

// Nextcloud oracle. Reads the owner's file tree over WebDAV with the owner's app password (the same Basic credential the
// harness wrote for the MCP server). It never writes. A PROPFIND per collection (Depth 1) builds the tree, because
// Depth: infinity is refused on a stock Nextcloud.

export interface DavSession {
  baseUrl: string;
  user: string;
  authorization: string;
}

export interface DavEntry {
  /** Path relative to the owner's root, with a trailing slash for a folder. */
  path: string;
  etag: string;
  size: string;
}

/** The user name inside a Basic credential ("Basic base64(user:password)"). The password is never returned. */
export function basicUser(authorization: string): string {
  const m = /^Basic\s+(\S+)$/.exec(authorization);
  if (!m) throw new Error("NEXTCLOUD_ORACLE_NOT_BASIC: the credential is not a Basic authorization");
  const user = Buffer.from(m[1] ?? "", "base64").toString("utf8").split(":")[0];
  if (!user) throw new Error("NEXTCLOUD_ORACLE_NO_USER: the Basic credential has no user name");
  return user;
}

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>';

/** One Depth 1 PROPFIND reply, parsed with a small reader (namespace prefixes vary between servers). */
export function parseMultistatus(xml: string): Array<{ href: string; etag: string; collection: boolean; size: string }> {
  const out: Array<{ href: string; etag: string; collection: boolean; size: string }> = [];
  const blocks = xml.match(/<(?:[\w-]+:)?response\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?response>/g) ?? [];
  for (const b of blocks) {
    const href = /<(?:[\w-]+:)?href>([^<]*)<\/(?:[\w-]+:)?href>/.exec(b)?.[1];
    if (href === undefined) continue;
    out.push({
      href: decodeURIComponent(href),
      etag: /<(?:[\w-]+:)?getetag>([^<]*)<\/(?:[\w-]+:)?getetag>/.exec(b)?.[1] ?? "",
      collection: /<(?:[\w-]+:)?collection\s*\/>/.test(b),
      size: /<(?:[\w-]+:)?getcontentlength>([^<]*)<\/(?:[\w-]+:)?getcontentlength>/.exec(b)?.[1] ?? "",
    });
  }
  return out;
}

async function propfind(s: DavSession, url: string): Promise<string> {
  const res = await fetch(url, {
    method: "PROPFIND",
    headers: { authorization: s.authorization, depth: "1", "content-type": "application/xml" },
    body: PROPFIND_BODY,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 207) throw new Error(`NEXTCLOUD_PROPFIND_HTTP_${res.status}`);
  return res.text();
}

/** The whole owner tree, sorted, so a digest changes when any file or folder is added, removed, moved or edited. */
export async function davTree(s: DavSession): Promise<DavEntry[]> {
  const root = `${s.baseUrl}/remote.php/dav/files/${encodeURIComponent(s.user)}/`;
  const prefix = `/remote.php/dav/files/${s.user}/`;
  const entries: DavEntry[] = [];
  const queue: string[] = [""];
  while (queue.length > 0) {
    const rel = queue.shift() as string;
    const parsed = parseMultistatus(await propfind(s, `${root}${rel.split("/").map(encodeURIComponent).join("/")}`));
    for (const r of parsed) {
      if (!r.href.startsWith(prefix)) continue;
      const p = r.href.slice(prefix.length);
      if (p === rel || p === "" || p === rel.replace(/\/$/, "")) continue; // the collection itself
      const isDir = r.collection;
      entries.push({ path: isDir && !p.endsWith("/") ? `${p}/` : p, etag: r.etag, size: r.size });
      if (isDir) queue.push(p.endsWith("/") ? p : `${p}/`);
    }
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export class NextcloudOracle implements ServerOracle {
  readonly server = "nextcloud" as const;
  private session: DavSession | undefined;

  constructor(private readonly adapter: ProductAdapter) {}

  private async dav(): Promise<DavSession> {
    if (this.session === undefined) {
      const auth = await this.adapter.authenticate();
      this.session = { baseUrl: this.adapter.baseUrl, user: basicUser(auth.authorizationHeader), authorization: auth.authorizationHeader };
    }
    return this.session;
  }

  /** The owner's whole file tree as one digest. */
  async snapshot(): Promise<Snapshot> {
    const tree = await davTree(await this.dav());
    const folders = tree.filter((e) => e.path.endsWith("/")).length;
    return makeSnapshot("nextcloud", "files", tree, { entries: tree.length, folders, files: tree.length - folders });
  }

  /** Exposed for the seed and for case-level reads (for example a sibling folder's contents). */
  davSession(): Promise<DavSession> {
    return this.dav();
  }

  async close(): Promise<void> {
    this.session = undefined;
  }
}

/** Login Flow v2 (documented by Nextcloud): start a flow, then poll for the app password. Used here only without a grant. */
export interface PollResult {
  status: number;
  /** True only when the body carries an app password. The value is never returned. */
  carriesAppPassword: boolean;
}

export async function startLoginFlow(baseUrl: string): Promise<{ token: string; endpoint: string }> {
  const res = await fetch(`${baseUrl}/index.php/login/v2`, { method: "POST", signal: AbortSignal.timeout(30_000) });
  if (res.status !== 200) throw new Error(`NEXTCLOUD_LOGIN_FLOW_START_HTTP_${res.status}`);
  const body = (await res.json()) as { poll?: { token?: unknown; endpoint?: unknown } };
  const token = body.poll?.token;
  const endpoint = body.poll?.endpoint;
  if (typeof token !== "string" || typeof endpoint !== "string") throw new Error("NEXTCLOUD_LOGIN_FLOW_SHAPE: no poll token or endpoint");
  return { token, endpoint };
}

export async function pollLoginFlow(endpoint: string, token: string): Promise<PollResult> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  return { status: res.status, carriesAppPassword: text.includes("appPassword") };
}

/**
 * P4-MCP-OAUTH-010. A flow that nobody approved in a browser must never yield an app password, whether it is polled once,
 * polled again, or polled with a token that was never issued.
 */
export function loginFlowNoGrant(polls: Array<{ label: string; result: PollResult }>): Verdict {
  if (polls.length === 0) return unverified("no login-flow poll was made");
  const bad = polls.filter((p) => p.result.carriesAppPassword || p.result.status === 200);
  if (bad.length > 0) return fail(`${bad.map((p) => `${p.label} (HTTP ${p.result.status})`).join(", ")} returned an app password without a grant`);
  return pass(`${polls.length} unapproved poll(s) returned no app password (HTTP ${polls.map((p) => p.result.status).join("/")})`);
}

/** A token nobody issued, for the "unauthenticated poller" leg. */
export const randomToken = (): string => randomBytes(24).toString("base64url");
