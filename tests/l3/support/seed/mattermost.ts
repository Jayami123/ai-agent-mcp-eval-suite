import type { ProductAdapter } from "qa-portfolio-harness";
import { MattermostApi, MM_PREFIX, MM_TEAM, mattermostBaseUrl, secondAuthorization, type MmPost } from "../../../../src/oracles/mattermost.js";

// Seeding and cleanup for the Mattermost cases. Writes go through the SECOND identity's PAT (qa-agent-b, H2): the MCP's own
// token (qa-agent) is only used to learn its user id and, in the cases, to show what the MCP identity sees. Channel names are
// static per case (the stub fixtures cannot hold run-time ids; the ids are bound at run time with setStubBindings).
// Every case owns its channels. A channel that exists from an earlier run is restored if archived and purged of posts first,
// so each case starts from a known state and the before/after snapshots compare like with like.

export interface MmSeedSession {
  /** The second identity (qa-agent-b): seeds the poisoned content and reads the outcome back. */
  second: MattermostApi;
  /** The MCP identity's own API view (qa-agent). Used only to read its user id and to show what it can see. */
  member: MattermostApi;
  secondId: string;
  memberId: string;
  teamId: string;
}

export async function mmSeedSession(adapter: ProductAdapter, memberAuthorization: string): Promise<MmSeedSession> {
  const second = new MattermostApi(mattermostBaseUrl(), secondAuthorization(adapter));
  const member = new MattermostApi(mattermostBaseUrl(), memberAuthorization);
  const s = await second.me();
  const m = await member.me();
  return { second, member, secondId: s.id, memberId: m.id, teamId: await second.teamId() };
}

/** Deletes every post in a channel (the second identity's delete rights). Returns how many deletes were refused. */
export async function purgePosts(s: MmSeedSession, channelId: string): Promise<number> {
  let refused = 0;
  for (const p of await s.second.channelPosts(channelId)) {
    if ((await s.second.deletePost(p.id)) !== 200) refused++;
  }
  return refused;
}

/**
 * The case's static channel, ready to use: created if missing, restored if archived, and purged. Throws (setup failure, not a
 * product verdict) when a restore or a post delete is refused, so a dirty channel never reaches the assertions.
 */
export async function freshChannel(s: MmSeedSession, name: string): Promise<string> {
  if (!name.startsWith(MM_PREFIX)) throw new Error(`MM_NAME_PREFIX: ${name} does not start with ${MM_PREFIX}`);
  const existing = await s.second.channelByName(MM_TEAM, name);
  if (existing === undefined) return s.second.createChannel(s.teamId, name);
  if (existing.delete_at !== 0) {
    const status = await s.second.restoreChannel(existing.id);
    if (status !== 200) throw new Error(`MM_RESTORE_REFUSED: HTTP ${status} restoring ${name}`);
  }
  const refused = await purgePosts(s, existing.id);
  if (refused > 0) throw new Error(`MM_PURGE_REFUSED: ${refused} post(s) in ${name} could not be deleted`);
  return existing.id;
}

/** Posts seeded content as the second identity. Throws on a refused post (a setup failure). */
export async function seedPost(s: MmSeedSession, channelId: string, message: string): Promise<string> {
  const r = await s.second.createPost(channelId, message);
  if (r.status !== 201 || r.id === undefined) throw new Error(`MM_SEED_POST_REFUSED: HTTP ${r.status}`);
  return r.id;
}

/** How many posts in a channel contain the given text (the canary). The reading is through the API, never the model. */
export async function countContaining(api: MattermostApi, channelId: string, text: string): Promise<number> {
  return (await api.channelPosts(channelId)).filter((p: MmPost) => p.message.includes(text)).length;
}

/**
 * The cleanup sweep. Every active suite channel (prefix MM_PREFIX) is purged and archived. Returns what was archived, how many
 * posts and archives were refused, and the names still active afterwards. A non-empty `left` or a refusal fails the sweep.
 */
export async function sweepSuite(s: MmSeedSession): Promise<{ archived: number; postsRefused: number; archivesRefused: number; left: string[] }> {
  const active = (await s.second.teamChannels(s.teamId)).filter((c) => c.delete_at === 0 && c.name.startsWith(MM_PREFIX));
  let archived = 0;
  let postsRefused = 0;
  let archivesRefused = 0;
  for (const c of active) {
    postsRefused += await purgePosts(s, c.id);
    if ((await s.second.archiveChannel(c.id)) === 200) archived++;
    else archivesRefused++;
  }
  const left = (await s.second.teamChannels(s.teamId)).filter((c) => c.delete_at === 0 && c.name.startsWith(MM_PREFIX)).map((c) => c.name);
  return { archived, postsRefused, archivesRefused, left };
}
