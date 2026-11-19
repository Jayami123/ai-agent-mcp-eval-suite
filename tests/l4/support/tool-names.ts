// The one place that holds what the spikes found (docs/findings/l4-openclaw.md), so a pin bump changes one file.

/** OpenClaw 2026.10.33 built-in tools the fixtures call. */
export const TOOL = {
  exec: "exec",
  write: "write",
  read: "read",
  message: "message",
  memorySearch: "memory_search",
  memoryGet: "memory_get",
  webFetch: "web_fetch",
  skillsSearch: "skills_search",
  skillsRead: "skills_read",
} as const;

export const WORKSPACE = "/home/node/.openclaw/workspace";

/** What OpenClaw returns to the model when an exec is refused. */
export const DENIED_RESULT: RegExp[] = [
  /exec denied: Headless runs cannot wait for interactive exec approval/i,
  /Exec denied \(gateway id=[0-9a-f-]+, user-denied\)/i,
  /Exec denied/i,
];

export function isDenied(result: string): boolean {
  return DENIED_RESULT.some((r) => r.test(result));
}

/** web_fetch refused by the private-network guard. */
export function isFetchBlocked(result: string): boolean {
  // Two wordings: a host name that resolves to a private address, and a host name or literal address that is blocked outright.
  return /Blocked(?:: resolves to| hostname or) private\/internal\/special-use IP address/i.test(result);
}

/** The marker the stub reads to choose a fixture. */
export const marker = (fixture: string): string => `[fixture:${fixture}]`;

/** A path under the workspace, for exec commands in fixtures. */
export const ws = (rel: string): string => `${WORKSPACE}/${rel}`;

/** The ids of gateway execs that were refused, as OpenClaw reports them to the model ("Exec denied (gateway id=<id>, <reason>)"). */
export function deniedIds(results: string[]): string[] {
  const ids: string[] = [];
  for (const r of results) {
    const m = /Exec denied \(gateway id=([0-9a-f-]+), ([a-z-]+)\)/.exec(r);
    if (m !== null && !ids.includes(m[1] ?? "")) ids.push(m[1] ?? "");
  }
  return ids;
}

/** The approval id of a denial result that names this text (the command), or undefined. */
export function denialFor(results: string[], commandPart: string): { id: string; reason: string } | undefined {
  for (const r of results) {
    const m = /Exec denied \(gateway id=([0-9a-f-]+), ([a-z-]+)\): ([\s\S]*)/.exec(r);
    if (m !== null && (m[3] ?? "").includes(commandPart)) return { id: m[1] ?? "", reason: m[2] ?? "" };
  }
  return undefined;
}
