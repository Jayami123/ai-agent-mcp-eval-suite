import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// OpenClaw state oracles for L4. Reads and writes go through the harness OpenClaw adapter where it has a primitive
// (seedWorkspaceFile, seedMemory, seedSkill, seedCron, readApprovals, readPendingApprovals, restart). The few gaps use
// `docker exec` on the harness-owned gateway container: files and hashes in the workspace, pairing, session deletion and approval
// resolution. None of them starts or stops a product. Nothing here prints a token.

export const OC_WORKSPACE = "/home/node/.openclaw/workspace";

/** The members of the harness OpenClaw adapter (v0.6.4) that the oracles use. `getAdapter()` returns the narrower interface. */
export interface OpenClawAdapterLike {
  seedWorkspaceFile(relPath: string, content: string): Promise<void>;
  seedMemory(name: string, content: string): Promise<void>;
  seedSkill(name: string, skillMarkdown: string): Promise<void>;
  seedCron(spec: { name: string; schedule: string; message: string }): Promise<void>;
  readApprovals(): Promise<Record<string, unknown>>;
  readPendingApprovals(): Promise<Array<Record<string, unknown>>>;
  restart(): Promise<void>;
  authenticate(): Promise<{ authorizationHeader: string }>;
  runTask(
    task: string,
    opts?: { tools?: unknown[]; requireTool?: boolean; timeoutMs?: number },
  ): Promise<{ status: number; responseId: string | null; toolCalls: Array<{ name: string; arguments: unknown }>; text: string }>;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (args: string[], stdin?: string) => ExecResult;

/** `docker exec` in the gateway container. The container is found by its compose labels, never by a fixed name. */
export function dockerExec(): Exec {
  return (args, stdin) => {
    const ps = spawnSync(
      "docker",
      ["ps", "-q", "--filter", "label=com.docker.compose.project=qa-harness-openclaw", "--filter", "label=com.docker.compose.service=openclaw"],
      { encoding: "utf8", timeout: 60_000 },
    );
    const id = (ps.stdout ?? "").split("\n")[0]?.trim() ?? "";
    if (id === "") throw new Error("OC_CONTAINER_MISSING: no running qa-harness-openclaw gateway container");
    const r = spawnSync("docker", ["exec", ...(stdin === undefined ? [] : ["-i"]), id, ...args], { encoding: "utf8", timeout: 120_000, ...(stdin === undefined ? {} : { input: stdin }) });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

export interface FileFact {
  /** Path relative to the workspace. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface PendingApproval {
  id: string;
  kind: string;
  sessionKey: string;
  /** The command or action the approval is for, as OpenClaw summarises it. */
  summary: string;
}

export interface OcSnapshot {
  /** Every file under the workspace except OpenClaw's own bootstrap files. */
  files: Record<string, FileFact>;
  /** Hash of the approvals document and the effective exec policy. */
  approvalsSha256: string;
  /** Hash of openclaw.json. */
  configSha256: string;
  pendingIds: string[];
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  changed: string[];
  approvalsChanged: boolean;
  configChanged: boolean;
}

/** OpenClaw writes these itself; they are not state a case should have to explain. */
const OWN_FILES = new Set(["AGENTS.md", "BOOTSTRAP.md", "IDENTITY.md", "SOUL.md", "USER.md", "TOOLS.md", "HEARTBEAT.md", "DREAMS.md"]);

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Pure. Unit tested. */
export function parseSha256sum(output: string): Record<string, FileFact> {
  const out: Record<string, FileFact> = {};
  for (const line of output.split("\n")) {
    const m = /^([0-9a-f]{64})\s+(\d+)\s+(.+)$/.exec(line.trim());
    if (m === null) continue;
    const rel = (m[3] ?? "").replace(/^\.\//, "");
    if (OWN_FILES.has(rel) || rel.startsWith(".")) continue;
    out[rel] = { path: rel, sha256: m[1] ?? "", bytes: Number(m[2]) };
  }
  return out;
}

/** Pure. Unit tested. */
export function diffSnapshots(before: OcSnapshot, after: OcSnapshot): SnapshotDiff {
  const added = Object.keys(after.files).filter((k) => !(k in before.files)).sort();
  const removed = Object.keys(before.files).filter((k) => !(k in after.files)).sort();
  const changed = Object.keys(after.files)
    .filter((k) => k in before.files && before.files[k]?.sha256 !== after.files[k]?.sha256)
    .sort();
  return { added, removed, changed, approvalsChanged: before.approvalsSha256 !== after.approvalsSha256, configChanged: before.configSha256 !== after.configSha256 };
}

/** Pure. Unit tested. Reads the entries of `openclaw approvals pending --json` into the fields the cases use. */
export function toPendingApprovals(raw: Array<Record<string, unknown>>): PendingApproval[] {
  return raw.map((r) => ({
    id: String(r["id"] ?? ""),
    kind: String(r["kind"] ?? ""),
    sessionKey: String(r["sessionKey"] ?? ""),
    summary: String(r["summary"] ?? ""),
  }));
}

/** Rejects a workspace path that is absolute or climbs out. The harness repeats the check for seeding. */
export function assertWorkspaceRel(rel: string): string {
  if (rel === "" || rel.startsWith("/") || rel.includes("\0") || rel.split("/").some((p) => p === ".." || p === "." || p === "")) {
    throw new Error("OC_PATH_INVALID: a workspace path must be relative and must not climb out (the path is not printed)");
  }
  return rel;
}

export interface OcOracle {
  seedFile(rel: string, content: string): Promise<FileFact>;
  seedSkill(name: string, skillMarkdown: string): Promise<void>;
  seedMemory(name: string, content: string): Promise<void>;
  seedCron(spec: { name: string; schedule: string; message: string }): Promise<void>;
  /** Removes seeded or created files and directories under the workspace. */
  removePath(rel: string): void;
  fileFact(rel: string): FileFact | undefined;
  readFile(rel: string): string | undefined;
  snapshot(): Promise<OcSnapshot>;
  pending(): Promise<PendingApproval[]>;
  approvals(): Promise<Record<string, unknown>>;
  /** `openclaw approvals resolve <id> deny|allow-once` through the CLI. */
  resolveApproval(id: string, decision: "deny" | "allow-once"): void;
  pairingPending(): Array<{ id: string; code: string }>;
  pairingApprove(code: string): void;
  /** Session keys of the Telegram sessions (not the main session). */
  telegramSessionKeys(): string[];
  /** When the main session (the owner's DM and every paired DM) started. /new keeps the session id and resets this. */
  mainSessionStartedAt(): number | undefined;
  deleteSession(key: string): void;
  skillNames(): string[];
  /**
   * Waits until the gateway lists a skill seeded on disk. OpenClaw 2026.10.33 picks a new workspace skill up without a restart, but
   * only after a delay of about 25 to 50 s (finding F-L4-5), so every case that seeds a skill waits here first.
   */
  waitSkill(name: string, timeoutMs?: number): Promise<number>;
  cronIdByName(name: string): string | undefined;
  cronRun(id: string): void;
  cronRemove(id: string): void;
  memoryFiles(): Record<string, FileFact>;
  restart(): Promise<void>;
  exec: Exec;
}

export function createOcOracle(adapter: OpenClawAdapterLike, exec: Exec = dockerExec()): OcOracle {
  const ws = (rel: string): string => `${OC_WORKSPACE}/${assertWorkspaceRel(rel)}`;
  const factOf = (rel: string): FileFact | undefined => {
    const r = exec(["sh", "-c", 'f="$1"; [ -f "$f" ] && printf "%s %s %s" "$(sha256sum "$f" | cut -d" " -f1)" "$(wc -c < "$f")" "$f"', "x", ws(rel)]);
    const m = /^([0-9a-f]{64}) (\d+)/.exec(r.stdout.trim());
    return r.code === 0 && m !== null ? { path: rel, sha256: m[1] ?? "", bytes: Number(m[2]) } : undefined;
  };
  const oracle: OcOracle = {
    exec,
    async seedFile(rel, content) {
      await adapter.seedWorkspaceFile(assertWorkspaceRel(rel), content);
      const f = factOf(rel);
      if (f === undefined) throw new Error("OC_SEED_NOT_VISIBLE: a seeded file is not readable in the workspace");
      return f;
    },
    seedSkill: (name, md) => adapter.seedSkill(name, md),
    seedMemory: (name, content) => adapter.seedMemory(name, content),
    seedCron: (spec) => adapter.seedCron(spec),
    removePath(rel) {
      exec(["rm", "-rf", ws(rel)]);
    },
    fileFact: factOf,
    readFile(rel) {
      const r = exec(["sh", "-c", 'f="$1"; [ -f "$f" ] && cat "$f"', "x", ws(rel)]);
      return r.code === 0 ? r.stdout : undefined;
    },
    async snapshot() {
      const listing = exec([
        "sh",
        "-c",
        `cd "${OC_WORKSPACE}" && find . -type f -not -path './.git/*' -not -path './.openclaw/*' | while read f; do printf "%s %s %s\\n" "$(sha256sum "$f" | cut -d' ' -f1)" "$(wc -c < "$f")" "$f"; done`,
      ]);
      const approvals = await adapter.readApprovals();
      const config = exec(["cat", "/home/node/.openclaw/openclaw.json"]);
      return {
        files: parseSha256sum(listing.stdout),
        approvalsSha256: sha256(JSON.stringify(approvals)),
        configSha256: sha256(config.stdout),
        pendingIds: (await adapter.readPendingApprovals()).map((p) => String(p["id"] ?? "")),
      };
    },
    async pending() {
      return toPendingApprovals(await adapter.readPendingApprovals());
    },
    approvals: () => adapter.readApprovals(),
    resolveApproval(id, decision) {
      if (!/^[0-9a-f-]{8,64}$/.test(id)) throw new Error("OC_APPROVAL_ID_INVALID");
      exec(["openclaw", "approvals", "resolve", id, decision]);
    },
    pairingPending() {
      const r = exec(["openclaw", "pairing", "list", "telegram", "--json"]);
      try {
        const parsed = JSON.parse(r.stdout) as { requests?: Array<{ id: string; code: string }> };
        return (parsed.requests ?? []).map((q) => ({ id: String(q.id), code: String(q.code) }));
      } catch {
        return [];
      }
    },
    pairingApprove(code) {
      if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new Error("OC_PAIRING_CODE_INVALID");
      const r = exec(["openclaw", "pairing", "approve", "telegram", code]);
      if (r.code !== 0) throw new Error("OC_PAIRING_APPROVE_FAILED");
    },
    telegramSessionKeys() {
      const r = exec(["openclaw", "sessions", "--json"]);
      try {
        return (JSON.parse(r.stdout) as { sessions: Array<{ key: string }> }).sessions.map((s) => s.key).filter((k) => k.includes(":telegram:"));
      } catch {
        return [];
      }
    },
    mainSessionStartedAt() {
      const r = exec(["openclaw", "sessions", "--json"]);
      try {
        return (JSON.parse(r.stdout) as { sessions: Array<{ key: string; sessionStartedAt?: number }> }).sessions.find((x) => x.key === "agent:main:main")?.sessionStartedAt;
      } catch {
        return undefined;
      }
    },
    deleteSession(key) {
      exec(["openclaw", "sessions", "delete", key, "--yes"]);
    },
    skillNames() {
      const r = exec(["openclaw", "skills", "list", "--json"]);
      try {
        return (JSON.parse(r.stdout) as { skills: Array<{ name: string }> }).skills.map((s) => s.name);
      } catch {
        return [];
      }
    },
    async waitSkill(name, timeoutMs = 150_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        if (oracle.skillNames().includes(name)) return Date.now() - t0;
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error(`OC_SKILL_NOT_VISIBLE: the gateway did not list the seeded skill within ${timeoutMs} ms`);
    },
    cronIdByName(name) {
      const r = exec(["openclaw", "cron", "list", "--json"]);
      try {
        const parsed = JSON.parse(r.stdout) as { jobs?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
        const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
        return jobs.find((j) => j.name === name)?.id;
      } catch {
        return undefined;
      }
    },
    cronRun(id) {
      exec(["openclaw", "cron", "run", id]);
    },
    cronRemove(id) {
      exec(["openclaw", "cron", "rm", id]);
    },
    memoryFiles() {
      const r = exec(["sh", "-c", `cd "${OC_WORKSPACE}" && for f in MEMORY.md memory/*.md; do [ -f "$f" ] && printf "%s %s %s\\n" "$(sha256sum "$f" | cut -d' ' -f1)" "$(wc -c < "$f")" "$f"; done; true`]);
      const out: Record<string, FileFact> = {};
      for (const line of r.stdout.split("\n")) {
        const m = /^([0-9a-f]{64}) (\d+) (.+)$/.exec(line.trim());
        if (m !== null) out[m[3] ?? ""] = { path: m[3] ?? "", sha256: m[1] ?? "", bytes: Number(m[2]) };
      }
      return out;
    },
    restart: () => adapter.restart(),
  };
  return oracle;
}
