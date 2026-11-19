import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "qa-portfolio-harness";
import { OC_WORKSPACE, createOcOracle, type FileFact, type OcOracle, type OpenClawAdapterLike, type PendingApproval } from "../../../src/oracles/openclaw.js";
import { OWNER, type InboundSpec, type MockUser } from "../../../src/mock-channel/types.js";
import { redact, runId, writeEvidence } from "../../l1/evidence.js";
import { skipReason, type Need } from "./env.js";
import { MockChannelClient, MOCK_CHANNEL_URL } from "./mock-channel-client.js";
import { isDenied, marker } from "./tool-names.js";
import { clearWatch, requireStubContainer, resetStubTrace, traceAll, watchPrompt, type L4TraceEntry } from "./stub-trace.js";

// The L4 case harness. A case is a function over a CaseContext. Every case starts from a reset state, checks real OpenClaw state
// through the oracles, and writes evidence (stub trace, mock channel log, pending approvals) even when it fails.

export interface CaseSpec {
  id: string;
  kind: "core" | "stretch";
  needs?: Need[];
  /** A named blocker. The test is registered as skipped with this text. */
  skip?: string;
  /** Model behaviour is part of the oracle. The stub gate runs the plumbing and the product gates; the model-dependent half runs nightly. */
  measured?: boolean;
  /** The stub fixture id this case uses. Its marker is added to every message the case sends. */
  fixture?: string;
  run?: (c: CaseContext) => Promise<void>;
}

export interface HeadlessResult {
  status: "returned" | "rejected";
  message?: string;
  toolCalls: Array<{ name: string; arguments: unknown }>;
  text: string;
}

export interface CaseContext {
  id: string;
  fixture: string;
  oc: OcOracle;
  mc: MockChannelClient;
  adapter: OpenClawAdapterLike;
  /** A unique fake value for this case. */
  canary(label: string): string;
  seedFile(rel: string, content: string): Promise<FileFact>;
  /** MEMORY.md, or a plain <name>.md under memory/ (harness seedMemory). */
  seedMemory(name: string, content: string): Promise<void>;
  /** Owner-sender task through POST /v1/responses, as L1 does. No channel. Exec is refused at once: headless runs cannot approve. */
  runTask(text: string, timeoutMs?: number): Promise<HeadlessResult>;
  /** A direct message through the mock channel. The fixture marker is added unless the text is a command or already has one. */
  say(from: MockUser, text: string, extra?: Partial<InboundSpec>): Promise<{ messageId: number; updateId: number }>;
  sayInGroup(from: MockUser, text: string, extra?: Partial<InboundSpec>): Promise<{ messageId: number; updateId: number }>;
  settle(quietMs?: number, capMs?: number): Promise<void>;
  /** Waits until OpenClaw has confirmed (acknowledged) an inbound update. A negative check after this cannot be a missed message. */
  waitConsumed(updateId: number): Promise<void>;
  waitFor<T>(what: string, probe: () => Promise<T | undefined | false | null>, timeoutMs?: number): Promise<T>;
  trace(): Promise<L4TraceEntry[]>;
  /** Every distinct tool result OpenClaw sent back to the stub, in order of first appearance. */
  results(): Promise<string[]>;
  /** The tool calls the stub answered with, in order. */
  calls(): Promise<Array<{ name: string; arguments: unknown }>>;
  pending(): Promise<PendingApproval[]>;
  waitPending(match: RegExp, timeoutMs?: number): Promise<PendingApproval>;
  /**
   * The operator decides through the gateway CLI (`openclaw approvals resolve`). Multi-step runs use this: after a chat approval
   * OpenClaw 2026.10.33 ends the run on the next tool call (finding F-L4-1 in docs/findings/l4-openclaw.md).
   */
  approve(id: string): void;
  deny(id: string): void;
  /** The owner types `/approve <id> allow-once` or `deny` in the chat, as a person would. */
  ownerApprove(id: string): Promise<void>;
  ownerDeny(id: string): Promise<void>;
  /** The approval cards OpenClaw sent to chat (outbound messages that carry `/approve`). */
  approvalCards(): Promise<string[]>;
  /** Registers canary values with the stub recorder and the mock channel. Later trace entries list which ones a prompt carried (promptHits). */
  watch(values: Record<string, string>): Promise<void>;
  /** The labels of watched canaries that appeared in any model request so far. */
  promptHits(): Promise<string[]>;
  /** Empties the stub trace and the mock channel log, so the next step is read on its own. */
  resetRecorders(): Promise<void>;
  /** Runs a check that is expected to fail because of a confirmed product behaviour. Passes while it fails, fails when it stops failing. */
  expectedDefect(finding: string, check: () => Promise<void> | void): Promise<void>;
  note(text: string): void;
  assert: typeof assert;
}

const SETTLE_QUIET_MS = 4000;
const SETTLE_CAP_MS = 120_000;

function openclawAdapter(): OpenClawAdapterLike {
  return getAdapter("openclaw") as unknown as OpenClawAdapterLike;
}

/** Fails closed: the stack is started by npm run l4:up, never by a test. */
export async function requireL4Stack(mc: MockChannelClient): Promise<void> {
  await requireStubContainer();
  let status = "no response";
  try {
    const s = await mc.status();
    status = `pollsInFlight=${s.pollsInFlight}`;
    if (s.pollsInFlight > 0) return;
  } catch (err) {
    status = (err as Error).name;
  }
  throw new Error(`L4_STACK_MISSING: the mock channel at ${MOCK_CHANNEL_URL} has no OpenClaw poller (${status}). Run npm run build && npm run stub:up && npm run l4:up first.`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Back to a known state: no pending approval, no Telegram session, fresh main session, no test files, empty recorders. */
export async function resetCaseState(oc: OcOracle, mc: MockChannelClient): Promise<void> {
  for (const p of await oc.pending()) oc.resolveApproval(p.id, "deny");
  await quiet(mc, 2500, 40_000);
  for (const key of oc.telegramSessionKeys()) oc.deleteSession(key);
  // The main session cannot be deleted. The owner's /new starts a fresh one, so no earlier case's fixture marker is in its history.
  await mc.dm(OWNER, "/new");
  await quiet(mc, 2500, 30_000);
  oc.exec(["sh", "-c", `cd ${OC_WORKSPACE} && rm -rf p4 MEMORY.md memory skills/p4-* skills/oc-*`]);
  await resetStubTrace();
  await clearWatch();
  await mc.reset();
  const left = await oc.pending();
  assert.equal(left.length, 0, "reset left a pending approval");
}

/** Waits until neither the mock channel log nor the stub trace changes for `quietMs`. HTTP only, so it is cheap to poll. */
async function quiet(mc: MockChannelClient, quietMs: number, capMs: number): Promise<void> {
  const t0 = Date.now();
  let last = "";
  let since = Date.now();
  while (Date.now() - t0 < capMs) {
    const sig = `${(await mc.log()).length}|${(await traceAll()).length}`;
    if (sig !== last) {
      last = sig;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return;
    await sleep(400);
  }
}

export function l4Case(spec: CaseSpec): void {
  const reason = spec.skip ?? skipReason(spec.needs ?? ["stack"]);
  test(`${spec.id}: ${spec.kind}${spec.measured === true ? " (measured, stub plumbing)" : ""}`, { skip: reason, timeout: 15 * 60_000 }, async () => {
    process.env["P4_LLM_MODE"] = process.env["P4_LLM_MODE"] ?? "stub";
    delete process.env["GEMINI_API_KEY"]; // a PR gate never has a key
    assert.notEqual(process.env["P4_LLM_MODE"], "nightly", "L4 gates run on the stub model only; the nightly slice is not wired in this lane");
    assert.ok(spec.run !== undefined, `${spec.id} has neither run nor skip`);
    const mc = new MockChannelClient();
    await requireL4Stack(mc);
    const adapter = openclawAdapter();
    const oc = createOcOracle(adapter);
    await resetCaseState(oc, mc);
    const dir = `l4-${spec.id.toLowerCase()}-${runId()}`;
    const notes: string[] = [];
    const fixture = spec.fixture ?? "";
    const stamp = (text: string): string => (text.startsWith("/") || text.includes("[fixture:") || fixture === "" ? text : `${marker(fixture)} ${text}`);
    const ctx: CaseContext = {
      id: spec.id,
      fixture,
      oc,
      mc,
      adapter,
      assert,
      canary: (label) => `CANARY-${spec.id.replace(/^P4-OC-/, "")}-${label}-${runId().slice(-6)}`,
      seedFile: (rel, content) => oc.seedFile(rel, content),
      seedMemory: (name, content) => oc.seedMemory(name, content),
      async runTask(text, timeoutMs = 120_000) {
        try {
          const r = await adapter.runTask(stamp(text), { timeoutMs });
          return { status: "returned", toolCalls: r.toolCalls, text: r.text };
        } catch (err) {
          return { status: "rejected", message: (err as Error).message, toolCalls: [], text: "" };
        }
      },
      say: async (from, text, extra) => mc.dm(from, stamp(text), extra),
      sayInGroup: async (from, text, extra) => mc.group(from, stamp(text), undefined, extra),
      settle: async (quietMs = SETTLE_QUIET_MS, capMs = SETTLE_CAP_MS) => {
        const t0 = Date.now();
        let last = "";
        let since = Date.now();
        while (Date.now() - t0 < capMs) {
          const sig = `${(await mc.log()).length}|${(await traceAll()).length}`;
          if (sig !== last) {
            last = sig;
            since = Date.now();
          } else if (Date.now() - since >= quietMs) return;
          await sleep(400);
        }
        throw new Error(`SETTLE_TIMEOUT: the stack was still changing after ${capMs} ms`);
      },
      waitConsumed: async (updateId) => {
        await ctx.waitFor(`OpenClaw to acknowledge update ${updateId}`, async () => ((await mc.status()).maxOffset > updateId ? true : undefined), 60_000);
      },
      async waitFor(what, probe, timeoutMs = 60_000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
          const v = await probe();
          if (v !== undefined && v !== false && v !== null) return v;
          await sleep(700);
        }
        throw new Error(`WAIT_TIMEOUT: ${what} did not happen within ${timeoutMs} ms`);
      },
      trace: () => traceAll(),
      // Every request carries the whole history of tool results, so the same result shows up in every later entry. Keep the first of each.
      results: async () => [...new Set((await traceAll()).flatMap((t) => t.toolResults))],
      calls: async () => (await traceAll()).flatMap((t) => t.toolCalls),
      pending: () => oc.pending(),
      waitPending: (match, timeoutMs = 60_000) => ctx.waitFor(`a pending approval matching ${String(match)}`, async () => (await oc.pending()).find((p) => match.test(p.summary)), timeoutMs),
      approve: (id) => oc.resolveApproval(id, "allow-once"),
      deny: (id) => oc.resolveApproval(id, "deny"),
      ownerApprove: async (id) => void (await mc.dm(OWNER, `/approve ${id} allow-once`)),
      ownerDeny: async (id) => void (await mc.dm(OWNER, `/approve ${id} deny`)),
      approvalCards: async () => (await mc.outbound()).filter((e) => (e.text ?? "").includes("/approve ")).map((e) => e.text ?? ""),
      watch: async (values) => {
        await watchPrompt(values);
        await mc.watch(values);
      },
      promptHits: async () => [...new Set((await traceAll()).flatMap((t) => t.promptHits ?? []))],
      resetRecorders: async () => {
        await resetStubTrace();
        await mc.reset();
      },
      async expectedDefect(finding, check) {
        notes.push(`expectedDefect: ${finding}`);
        let failed = false;
        try {
          await check();
        } catch (err) {
          if (!(err instanceof assert.AssertionError)) throw err;
          failed = true;
          notes.push(`  observed: ${err.message.split("\n")[0]}`);
        }
        assert.ok(failed, `expectedDefect "${finding}" no longer fails: the product behaviour changed, so remove the marker (${spec.id})`);
      },
      note: (text) => void notes.push(text),
    };
    try {
      await spec.run(ctx);
    } finally {
      await writeCaseEvidence(dir, mc, oc, notes, spec).catch(() => undefined);
    }
  });
}

async function writeCaseEvidence(dir: string, mc: MockChannelClient, oc: OcOracle, notes: string[], spec: CaseSpec): Promise<void> {
  const secrets: string[] = [];
  writeEvidence(dir, "case.json", `${JSON.stringify({ id: spec.id, kind: spec.kind, measured: spec.measured === true, fixture: spec.fixture ?? null, notes }, null, 2)}\n`);
  writeEvidence(dir, "stub-trace.json", `${redact(JSON.stringify(await traceAll(), null, 2), secrets)}\n`);
  writeEvidence(dir, "mock-channel-log.json", `${redact(JSON.stringify(await mc.log(), null, 2), secrets)}\n`);
  writeEvidence(dir, "pending-approvals.json", `${JSON.stringify(await oc.pending(), null, 2)}\n`);
}

export { isDenied };
