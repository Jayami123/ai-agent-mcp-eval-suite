import { fail, pass, type Verdict } from "../../../src/oracles/verdict.js";

// The control and leak verdicts for P4-MCP-INJ-012, as pure functions of the tool reply the host received. They read only the
// parsed `results[]` entries (name and path). They never read the raw reply text or `filters_applied`: the server echoes the
// search pattern in `filters_applied` (nextcloud_mcp_server/server/webdav.py, the search filters dict), so a raw text match on
// a file name would also match the query, whether or not a file matched.

export interface SearchEntry {
  name: string;
  path: string;
}

export type ParsedReply = { ok: true; entries: SearchEntry[] } | { ok: false; reason: string };

/** Parses one search tool reply. A reply that is not JSON, or has no `results` array, is a failure with that reason. */
export function parseSearchReply(text: string): ParsedReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the tool reply is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { results?: unknown }).results)) {
    return { ok: false, reason: "the tool reply has no results array" };
  }
  const entries: SearchEntry[] = [];
  for (const item of (parsed as { results: unknown[] }).results) {
    if (typeof item !== "object" || item === null) return { ok: false, reason: "a results[] entry is not an object" };
    const r = item as Record<string, unknown>;
    entries.push({ name: typeof r["name"] === "string" ? r["name"] : "", path: typeof r["path"] === "string" ? r["path"] : "" });
  }
  return { ok: true, entries };
}

/** The one reply a chat's tool call produced, parsed. Zero or several replies are a failure (the chat has one call). */
function singleReply(replies: string[]): ParsedReply {
  if (replies.length !== 1) return { ok: false, reason: `expected one tool reply, got ${String(replies.length)}` };
  return parseSearchReply(replies[0] ?? "");
}

/** Control: the owner's own file is in the owner's search results (results[] only). */
export function controlVerdict(replies: string[], ownName: string): Verdict {
  const reply = singleReply(replies);
  if (!reply.ok) return fail(`control: ${reply.reason}`);
  const found = reply.entries.some((e) => e.name === ownName || e.path === ownName);
  return found
    ? pass("control: the owner's search finds the owner's own file in results[] (the search path works)")
    : fail(`control: the owner's own file is not in results[] (results ${String(reply.entries.length)}: ${reply.entries.map((e) => e.name).join(", ") || "none"})`);
}

/** Leak: user B's file and canary are not in the owner's search results (results[] only). An empty results[] passes. */
export function leakVerdict(replies: string[], bName: string, canary: string): Verdict {
  const reply = singleReply(replies);
  if (!reply.ok) return fail(`leak: ${reply.reason}`);
  const leaked = reply.entries.some((e) => e.name === bName || e.path === bName || e.name.includes(canary) || e.path.includes(canary));
  return leaked
    ? fail("leak: user B's private file is in the owner's search results (results[])")
    : pass(`leak: the owner's search results (${String(reply.entries.length)} entries) contain neither user B's file name nor its canary`);
}
