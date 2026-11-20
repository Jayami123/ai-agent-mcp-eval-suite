import fs from "node:fs";
import type { ProductAdapter } from "qa-portfolio-harness";
import { makeSnapshot, type Snapshot } from "./snapshot.js";

// Mattermost oracle and read-only API client. Oracles read the product's own API with the SECOND identity's PAT (H2,
// qa-agent-b). That token is not the MCP's token (qa-agent), so the oracle does not share the credential path under test,
// and no model reply is ever read. Writes live in tests/l3/support/seed/mattermost.ts; this module only reads.
// The PAT is read from the run-state file and never printed. Errors name the endpoint and status, never a body.

export const MM_TEAM = "qa";
/** Every channel a case or the probe creates starts with this, so the sweep and the snapshot see only the suite's channels. */
export const MM_PREFIX = "p4l3-";

export function mattermostBaseUrl(): string {
  const raw = process.env["MATTERMOST_BASE_URL"]?.trim();
  return (raw !== undefined && raw !== "" ? raw : "http://127.0.0.1:8065").replace(/\/$/, "");
}

/** The second identity's bearer header, from its run-state file (H2). Never printed. */
export function secondAuthorization(adapter: ProductAdapter): string {
  const file = (adapter as ProductAdapter & { secondRunStateFile?: () => string }).secondRunStateFile?.();
  if (file === undefined) throw new Error("MM_NO_SECOND_RUN_STATE: the Mattermost adapter has no second run state (set P4_SECOND_IDENTITY=1)");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpAuthorization?: unknown };
  if (typeof parsed.mcpAuthorization !== "string") throw new Error("MM_SECOND_RUN_STATE_SHAPE: no authorization in the second run state (content not printed)");
  return parsed.mcpAuthorization;
}

export interface MmReply<T = unknown> {
  status: number;
  body: T;
}

export interface MmChannel {
  id: string;
  name: string;
  delete_at: number;
  type: string;
}

export interface MmPost {
  id: string;
  message: string;
  user_id: string;
  root_id: string;
  channel_id: string;
}

/** Thin REST client. Every call names only its endpoint in an error; the bearer value and bodies are never echoed. */
export class MattermostApi {
  constructor(
    readonly baseUrl: string,
    private readonly authorization: string,
  ) {}

  async call<T = unknown>(method: string, endpoint: string, body?: unknown): Promise<MmReply<T>> {
    const res = await fetch(`${this.baseUrl}/api/v4${endpoint}`, {
      method,
      headers: { authorization: this.authorization, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return { status: res.status, body: parsed as T };
  }

  /** The bearer's own user (id, username, roles). */
  async me(): Promise<{ id: string; username: string; roles: string }> {
    const r = await this.call<{ id?: string; username?: string; roles?: string }>("GET", "/users/me");
    if (r.status !== 200 || typeof r.body.id !== "string" || typeof r.body.username !== "string") throw new Error(`MM_ME_FAILED: GET /users/me returned HTTP ${r.status}`);
    return { id: r.body.id, username: r.body.username, roles: String(r.body.roles ?? "") };
  }

  async teamId(): Promise<string> {
    const r = await this.call<{ id?: string }>("GET", `/teams/name/${MM_TEAM}`);
    if (r.status !== 200 || typeof r.body.id !== "string") throw new Error(`MM_TEAM_FAILED: GET /teams/name/${MM_TEAM} returned HTTP ${r.status}`);
    return r.body.id;
  }

  /** Channels of the team the bearer can list (public, plus any it belongs to). */
  async teamChannels(teamId: string): Promise<MmChannel[]> {
    const r = await this.call<MmChannel[]>("GET", `/teams/${teamId}/channels?per_page=200`);
    if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`MM_CHANNELS_FAILED: GET /teams/{id}/channels returned HTTP ${r.status}`);
    return r.body;
  }

  /** Posts of a channel, oldest first. Anything malformed throws a fixed message. */
  async channelPosts(channelId: string): Promise<MmPost[]> {
    const r = await this.call<{ order?: unknown; posts?: Record<string, MmPost> }>("GET", `/channels/${channelId}/posts?per_page=200`);
    if (r.status !== 200 || r.body.posts === undefined || typeof r.body.posts !== "object") throw new Error(`MM_POSTS_FAILED: GET /channels/{id}/posts returned HTTP ${r.status}`);
    const order = Array.isArray(r.body.order) ? (r.body.order as string[]) : Object.keys(r.body.posts);
    return order.map((id) => r.body.posts?.[id]).filter((p): p is MmPost => p !== undefined).reverse();
  }
}

/**
 * Read-only oracle. snapshot() covers every live channel the suite created (prefix MM_PREFIX) and each one's posts, by id,
 * author and a digest of the message text. The evidence keeps only names, counts and the digest, never message bodies.
 */
export class MattermostOracle {
  readonly server = "mattermost" as const;
  private readonly api: MattermostApi;

  constructor(adapter: ProductAdapter) {
    this.api = new MattermostApi(mattermostBaseUrl(), secondAuthorization(adapter));
  }

  async snapshot(): Promise<Snapshot> {
    const teamId = await this.api.teamId();
    const suite = (await this.api.teamChannels(teamId)).filter((c) => c.delete_at === 0 && c.name.startsWith(MM_PREFIX));
    const rows: Array<{ channel: string; posts: Array<{ id: string; user: string; message: string }> }> = [];
    for (const c of suite) {
      const posts = await this.api.channelPosts(c.id);
      rows.push({ channel: c.name, posts: posts.map((p) => ({ id: p.id, user: p.user_id, message: p.message })) });
    }
    rows.sort((a, b) => a.channel.localeCompare(b.channel));
    const postCount = rows.reduce((n, r) => n + r.posts.length, 0);
    return makeSnapshot("mattermost", "suite channels and posts", rows, { channels: rows.map((r) => r.channel), posts: postCount });
  }

  async close(): Promise<void> {
    // Stateless: each call reads through fetch.
  }
}
