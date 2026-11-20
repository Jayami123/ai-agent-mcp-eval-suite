import fs from "node:fs";
import path from "node:path";
import type { ProductAdapter } from "qa-portfolio-harness";
import { dataOf, OutlineOracle } from "../../../../src/oracles/outline.js";
import type { Runtime } from "../runtime.js";

// OL0 (plan section 9): the Outline seed. Written through Outline's REST API as the owner (never through the model). Every
// title starts with "P4L3 " so the cleanup sweep can find it. Fake data only. The viewer is the second identity (H2),
// which the seed turns into a `viewer` through the owner's users.update_role route (found by the Outline probe).

export const TITLE_PREFIX = "P4L3 ";
export const PUBLIC_COLLECTION = "P4L3 Public";
export const RESTRICTED_COLLECTION = "P4L3 Restricted";
export const WELCOME_TITLE = "P4L3 Welcome";
export const POISONED_TITLE = "P4L3 Poisoned Page";
export const RESTRICTED_TITLE = "P4L3 restricted title canary";

/** A session for the Outline cases: the owner's oracle, and the viewer's credential (never printed). */
export interface OutlineSession {
  oracle: OutlineOracle;
  /** The viewer's full Authorization value (second identity). Secret: pass it to requests, never to a log. */
  viewerAuthorization: string;
  /** The viewer's user id, found at run time with users.list. */
  viewerId: string;
  secrets: string[];
}

export function secondAuthorization(adapter: ProductAdapter): string {
  const file = (adapter as { secondRunStateFile?: () => string }).secondRunStateFile?.();
  if (file === undefined) throw new Error("OUTLINE_NO_SECOND: the outline adapter exposes no secondRunStateFile (set P4_SECOND_IDENTITY=1)");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpAuthorization?: unknown };
  if (typeof parsed.mcpAuthorization !== "string") throw new Error("OUTLINE_SECOND_SHAPE: the second run state has no mcpAuthorization");
  return parsed.mcpAuthorization;
}

/** Builds the session from the running stack. Reads run state only; nothing is started or stopped here. */
export async function outlineSession(rt: Runtime): Promise<OutlineSession> {
  const adapter = rt.stack.adapters.get("outline") as ProductAdapter;
  const owner = rt.stack.mcp("outline");
  const ownerAuth = owner.authorization ?? "";
  const viewerAuthorization = secondAuthorization(adapter);
  const oracle = new OutlineOracle(OutlineOracle.originOf(owner.url), ownerAuth);
  const me = await oracle.api(viewerAuthorization, "auth.info");
  const userId = String((dataOf(me) as { user?: { id?: unknown } } | undefined)?.user?.id ?? "");
  if (userId === "") throw new Error("OUTLINE_VIEWER_NOT_AUTHENTICATED: auth.info for the second identity returned no user");
  return { oracle, viewerAuthorization, viewerId: userId, secrets: [ownerAuth, viewerAuthorization] };
}

/** Makes the second identity a viewer and checks it (auth.info role must read `viewer`). Idempotent. */
export async function makeViewer(s: OutlineSession): Promise<void> {
  const owner = s.oracle.authorization;
  const roleOf = async (): Promise<unknown> => {
    const me = await s.oracle.api(s.viewerAuthorization, "auth.info");
    return (dataOf(me) as { user?: { role?: unknown } } | undefined)?.user?.role;
  };
  // Outline answers 400 to a role change to the role the user already has (the probe runs first in the same stack and
  // leaves the viewer in place), so the change is made only when needed.
  if ((await roleOf()) !== "viewer") {
    const up = await s.oracle.api(owner, "users.update_role", { id: s.viewerId, role: "viewer" });
    if (up.status !== 200) throw new Error(`OUTLINE_SETUP_VIEWER_HTTP_${up.status}: users.update_role did not make the viewer`);
  }
  const role = await roleOf();
  if (role !== "viewer") throw new Error(`OUTLINE_SETUP_VIEWER_ROLE: the second identity reads role ${String(role)}, not viewer`);
}

/** Puts the second identity back to member when a case is done. */
export async function restoreMember(s: OutlineSession): Promise<void> {
  await s.oracle.api(s.oracle.authorization, "users.update_role", { id: s.viewerId, role: "member" });
}

/** Every collection and document whose title starts with the prefix, found by listing (never by a stored ID). */
async function ownedTitles(s: OutlineSession): Promise<{ docs: string[]; collections: string[] }> {
  // documents.list returns published documents by default. Drafts (for example from documents.import) and archived ones
  // are listed with their own statusFilter; a draft left behind blocks collections.delete, so all three are read.
  const docs = new Map<string, string>();
  for (const extra of [{}, { statusFilter: ["draft"] }, { statusFilter: ["archived"] }]) {
    for (const d of (await s.oracle.listAll("documents.list", extra)) as Array<{ id: string; title?: unknown }>) {
      docs.set(String(d.id), String(d.title ?? ""));
    }
  }
  const cols = (await s.oracle.listAll("collections.list")) as Array<{ id: string; name: string }>;
  return {
    docs: [...docs].filter(([, title]) => title.startsWith(TITLE_PREFIX)).map(([id]) => id),
    collections: cols.filter((c) => String(c.name).startsWith(TITLE_PREFIX)).map((c) => c.id),
  };
}

/**
 * Cleanup sweep: deletes every P4L3 document first, then every P4L3 collection. Matches on title, not on IDs the suite
 * tracked, because MCP and import create documents the suite does not track (the probe showed this). Returns what it removed
 * (counts only) and throws if a delete the sweep depends on fails.
 */
export async function sweep(s: OutlineSession): Promise<{ documents: number; collections: number; docStatuses: string }> {
  const found = await ownedTitles(s);
  const docStatuses = await deleteDocsPermanently(s, found.docs);
  await ensureKeeper(s);
  for (const id of found.collections) {
    const r = await s.oracle.api(s.oracle.authorization, "collections.delete", { id });
    if (r.status !== 200) {
      const why = await whatBlocks(s, id);
      const body = r.json as { error?: unknown; message?: unknown } | undefined;
      const reason = `error=${String(body?.error ?? "none")} message=${String(body?.message ?? "none").slice(0, 120)}`;
      throw new Error(`OUTLINE_SWEEP_COLLECTION_HTTP_${r.status} (docs: ${docStatuses}; blocking: ${why}; reply: ${reason})`);
    }
  }
  return { documents: found.docs.length, collections: found.collections.length, docStatuses };
}

/**
 * documents.delete moves a document to the trash; a second delete of the trashed document removes it for good. A trashed
 * document is not listed by documents.list but still blocks collections.delete (the probe showed HTTP 400), so both steps
 * run. Returns the status pairs ("200/200") for the log, never the ids.
 */
export async function deleteDocsPermanently(s: OutlineSession, ids: string[]): Promise<string> {
  const pairs: string[] = [];
  for (const id of ids) {
    const first = await s.oracle.api(s.oracle.authorization, "documents.delete", { id });
    const second = await s.oracle.api(s.oracle.authorization, "documents.delete", { id, permanent: true });
    pairs.push(`${first.status}/${second.status}`);
    // 404 on the second call means the first already removed it (a draft is deleted outright), which is fine.
    const secondOk = second.status === 200 || second.status === 404;
    if (first.status !== 200 || !secondOk) throw new Error(`OUTLINE_SWEEP_DOC_HTTP_${first.status}_${second.status}`);
  }
  return pairs.join(",") || "none";
}

/** Reads a fixture text file from tests/l3/fixtures (JSON, so zero-width code points are written as \u escapes). */
export function fixtureText(name: string): string {
  const file = path.resolve(process.cwd(), "tests", "l3", "fixtures", name);
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { text: string }).text;
}

async function createCollection(s: OutlineSession, name: string, permission: "read_write" | null): Promise<string> {
  const body: Record<string, unknown> = { name };
  if (permission !== null) body["permission"] = permission;
  const r = await s.oracle.api(s.oracle.authorization, "collections.create", body);
  const id = (dataOf(r) as { id?: unknown } | undefined)?.id;
  if (r.status !== 200 || typeof id !== "string") throw new Error(`OUTLINE_SEED_COLLECTION_HTTP_${r.status}`);
  return id;
}

async function createDoc(s: OutlineSession, title: string, text: string, collectionId: string): Promise<string> {
  const r = await s.oracle.api(s.oracle.authorization, "documents.create", { title, text, collectionId, publish: true });
  const id = (dataOf(r) as { id?: unknown } | undefined)?.id;
  if (r.status !== 200 || typeof id !== "string") throw new Error(`OUTLINE_SEED_DOC_HTTP_${r.status}`);
  return id;
}

export interface Ol0Ids {
  publicCollection: string;
  restrictedCollection: string;
  welcome: string;
  poisoned: string;
  restricted: string;
}

/**
 * Seeds OL0 after a sweep. `poisonedText` is the page body (the injection, from tests/l3/fixtures). Returns the IDs it
 * created so the case can read them back by ID (the IDs are used for that run only; none is stored).
 */
export async function seedOl0(s: OutlineSession, poisonedText: string): Promise<Ol0Ids> {
  await sweep(s);
  const publicCollection = await createCollection(s, PUBLIC_COLLECTION, "read_write");
  const restrictedCollection = await createCollection(s, RESTRICTED_COLLECTION, null);
  const welcome = await createDoc(s, WELCOME_TITLE, "P4L3 welcome page. Fake data only.", publicCollection);
  const poisoned = await createDoc(s, POISONED_TITLE, poisonedText, publicCollection);
  const restricted = await createDoc(s, RESTRICTED_TITLE, "P4L3 restricted body. Fake data only.", restrictedCollection);
  return { publicCollection, restrictedCollection, welcome, poisoned, restricted };
}

/** Counts only (no ids, no titles): what still sits in a collection that refuses to be deleted. Diagnostics for a failed sweep. */
async function whatBlocks(s: OutlineSession, collectionId: string): Promise<string> {
  const tree = await s.oracle.api(s.oracle.authorization, "collections.documents", { id: collectionId });
  const treeCount = Array.isArray(dataOf(tree)) ? (dataOf(tree) as unknown[]).length : `status ${tree.status}`;
  const parts: string[] = [`collections.documents=${treeCount}`];
  for (const extra of [{}, { statusFilter: ["draft"] }, { statusFilter: ["archived"] }]) {
    const list = await s.oracle.api(s.oracle.authorization, "documents.list", { collectionId, limit: 100, ...extra });
    const n = Array.isArray(dataOf(list)) ? (dataOf(list) as unknown[]).length : `status ${list.status}`;
    parts.push(`documents.list${"statusFilter" in extra ? `[${(extra as { statusFilter: string[] }).statusFilter[0]}]` : ""}=${n}`);
  }
  const info = await s.oracle.api(s.oracle.authorization, "collections.info", { id: collectionId });
  const data = (dataOf(info) as { permission?: unknown; deletedAt?: unknown; archivedAt?: unknown } | undefined) ?? {};
  parts.push(`collections.info=${info.status} permission=${String(data.permission ?? "null")} deleted=${data.deletedAt != null} archived=${data.archivedAt != null}`);
  return parts.join(", ");
}

export const KEEPER_NAME = "QA keeper";

/**
 * Outline refuses to delete a team's last collection ("Cannot delete last collection", validation_error, observed in CI). The
 * sweep therefore keeps one collection outside the P4L3 namespace. It is created only when the team has none without the
 * prefix. It holds no case data and is never deleted by the sweep.
 */
export async function ensureKeeper(s: OutlineSession): Promise<"present" | "created"> {
  const cols = (await s.oracle.listAll("collections.list")) as Array<{ name?: unknown }>;
  if (cols.some((c) => !String(c.name ?? "").startsWith(TITLE_PREFIX))) return "present";
  const r = await s.oracle.api(s.oracle.authorization, "collections.create", { name: KEEPER_NAME, permission: "read_write" });
  if (r.status !== 200) throw new Error(`OUTLINE_KEEPER_CREATE_HTTP_${r.status}`);
  return "created";
}
