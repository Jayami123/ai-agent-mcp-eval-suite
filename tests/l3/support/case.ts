import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "qa-portfolio-harness";
import { combine, type Verdict } from "../../../src/oracles/verdict.js";
import { validateTrial, type ToolCallRecord, type TrialRecord } from "../../../src/stats/schema.js";
import { approvalRecords, BlockedNoAnswerError, toTurnEvidence } from "./turn-evidence.js";
import { DEFAULT_K } from "../../../src/stats/thresholds.js";
import { type TrialStatus } from "../../../src/stats/status.js";
import { writeEvidence } from "../../l1/evidence.js";
import { isRateLimited } from "../../l1/gemma-classify.js";
import { classifyEmptyAnswer, classifyStall, EmptyAnswerError, isProviderOutage, isStreamTimeout, windowLines } from "../../l1/provider-outage.js";
import { containerLogWindow, redact } from "../../l1/evidence.js";
import { APPROVAL_TIMEOUT_MS, type ApprovalRun } from "./approval.js";
import { servedModelFromModelInfo } from "../../l1/gemma-record.js";
import { caseDef } from "./registry.js";
import { laneVerdict } from "./lane-verdict.js";

export type RunMode = "stub" | "nightly";

export interface CaseCtx {
  id: string;
  mode: RunMode;
  /** Trial index in nightly mode (0-based). Always 0 in stub mode. */
  trial: number;
  /** Trials this run makes: P4_MEASURED_K in nightly mode (default 10), 1 in stub mode. */
  k: number;
  /** Record one oracle verdict (state, trace or sink). A case with no verdicts fails: assistant text is never an oracle. */
  check(v: Verdict): void;
  /** Free-form line for the evidence file (no secrets). */
  note(line: string): void;
  /** Nightly only: the prompt text the model received. Only its SHA-256 goes into the trial record. */
  prompt(text: string): void;
  /** Nightly only: the tool calls the model made in this trial, as the record stores them (names and argument objects). */
  toolCalls(calls: ToolCallRecord[]): void;
  /** Nightly only: the finished or stopped turn (pauses, decisions, LibreChat's final message). Written to the trial record. */
  turn?: (run: ApprovalRun) => void;
}

/** A case with a nightly branch: the body runs against the real model (p4-nightly) with no stub fixture. */
export interface NightlyOpts {
  /** The servers the trial touches (for the ASR matrix). */
  servers: string[];
  /** True when a failed verdict means the injected action landed, so the trial counts as a successful attack. */
  failMeansAttack: boolean;
}

export interface L3Opts {
  /** A CORE case blocked outside this suite: a named skip with a docs/ path (see the case doc above). */
  namedSkip?: string;
  /** For a STRETCH case only, a named reason; the test is registered and skipped with that reason. */
  blocker?: string;
  stack?: boolean;
  /** Present only on a measured case whose body has a nightly branch. Every other case runs in the stub gate only. */
  nightly?: NightlyOpts;
}

/** One trial every minute at least. Keeps the Gemma lane under the shared 16K tokens-per-minute limit between trials. */
export const TRIAL_SPACING_MS = 60_000;

const runMode = (): RunMode => (process.env["P4_LLM_MODE"] === "nightly" ? "nightly" : "stub");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Values the LiteLLM log must not print. Read from the environment, never written anywhere. */
const providerSecrets = (): string[] =>
  [process.env["LITELLM_MASTER_KEY"], process.env["GEMINI_API_KEY"], process.env["DEEPSEEK_API_KEY"]].filter(
    (v): v is string => typeof v === "string" && v !== "",
  );

/** P4_MEASURED_K: trials per measured case in nightly mode. Unset means the master plan's default. Anything else out of range throws. */
export function measuredTrials(raw: string | undefined = process.env["P4_MEASURED_K"]): number {
  if (raw === undefined || raw === "") return DEFAULT_K;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error(`P4_MEASURED_K must be an integer from 1 to 100, got: ${raw}`);
  return n;
}

/** The model id LiteLLM routes p4-nightly to, read from /model/info. Empty when it cannot be read; the record validator then fails loudly. */
async function servedModelId(): Promise<string> {
  try {
    const lite = await getAdapter("litellm").authenticate();
    const info = await fetch(`${lite.baseUrl}/model/info`, { headers: { authorization: lite.authorizationHeader }, signal: AbortSignal.timeout(15_000) });
    if (!info.ok) return "";
    return servedModelFromModelInfo(await info.json(), "p4-nightly")?.id ?? "";
  } catch {
    return "";
  }
}

/**
 * One L3 case = one test whose name starts with the case ID. The body does the work and records verdicts. The wrapper
 * fails the test unless there is at least one verdict and all are pass, and always writes evidence/traces/<id>/verdicts.json.
 *
 * Nightly mode runs only cases with a `nightly` branch, k trials each (P4_MEASURED_K). A trial's verdict is a measured result,
 * not a failed gate: it is written as a TrialRecord (src/stats/schema.ts) to evidence/nightly/<id>/trial-<n>.json. Only an
 * infrastructure error ends the test red.
 * `opts.blocker`: for a STRETCH case only, a named reason; the test is registered and skipped with that reason.
 * `opts.namedSkip`: for a CORE case that is blocked outside this suite, a named skip that points to the document holding the
 * blocker (for example a harness request). The body is kept, so the case runs again once the blocker is removed.
 */
export function l3Case(id: string, title: string, body: (ctx: CaseCtx) => Promise<void>, opts: L3Opts = {}): void {
  const def = caseDef(id);
  const { blocker, namedSkip } = opts;
  if (namedSkip !== undefined && !/docs\/[\w./-]+\.md/.test(namedSkip)) throw new Error(`L3_NAMED_SKIP_NO_DOC: ${id} needs a docs/ path in namedSkip`);
  // A case that needs no running product (opts.stack false) runs in the plain gate.
  const stack = opts.stack === false || process.env["P4_STACK_TESTS"] === "1";
  if (blocker !== undefined && def.kind !== "stretch") throw new Error(`L3_CORE_CANNOT_SKIP: ${id} is core; a core case is deferred in the plan, not skipped`);
  if (opts.nightly !== undefined && !def.modes.includes("M")) {
    throw new Error(`L3_NIGHTLY_NOT_MEASURED: ${id} has a nightly branch but its ledger modes do not include M`);
  }
  const inNightly = runMode() === "nightly";
  const skip: string | false =
    namedSkip !== undefined
      ? `named skip: ${namedSkip}`
      : blocker !== undefined
        ? `blocked: ${blocker}`
        : !stack
          ? "requires P4_STACK_TESTS=1 (L3 stack job)"
          : inNightly && opts.nightly === undefined
            ? "no nightly branch (stub gate only)"
            : false;
  test(`${id}: ${title}`, { skip, timeout: inNightly ? 5 * 60 * 60_000 : 30 * 60_000 }, async () => {
    if (inNightly && opts.nightly !== undefined) return runNightly(id, opts.nightly, body);
    const verdicts: Verdict[] = [];
    const notes: string[] = [];
    const ctx: CaseCtx = {
      id,
      mode: runMode(),
      trial: 0,
      k: 1,
      check: (v) => void verdicts.push(v),
      note: (l) => void notes.push(l),
      prompt: () => undefined,
      toolCalls: () => undefined,
    };
    try {
      await body(ctx);
    } finally {
      writeEvidence(`traces/${id}`, "verdicts.json", `${JSON.stringify({ id, mode: ctx.mode, verdicts, notes }, null, 2)}\n`);
    }
    const total = combine(verdicts);
    assert.equal(total.outcome, "pass", `${id}: ${total.detail}`);
  });
}

async function runNightly(id: string, nightly: NightlyOpts, body: (ctx: CaseCtx) => Promise<void>): Promise<void> {
  const k = measuredTrials();
  const served = await servedModelId();
  const trialVerdicts: Array<{ trial: number; verdicts: Verdict[]; notes: string[] }> = [];
  const statuses: TrialStatus[] = [];
  const partialReasons: string[] = [];
  for (let trial = 0; trial < k; trial++) {
    if (trial > 0) await sleep(TRIAL_SPACING_MS);
    const verdicts: Verdict[] = [];
    const notes: string[] = [];
    let promptText = "";
    let calls: ToolCallRecord[] = [];
    let turnRun: ApprovalRun | undefined;
    const ctx: CaseCtx = {
      id,
      mode: "nightly",
      trial,
      k,
      check: (v) => void verdicts.push(v),
      note: (l) => void notes.push(l),
      prompt: (t) => void (promptText = t),
      toolCalls: (c) => void (calls = c),
      turn: (r) => void (turnRun = r),
    };
    const started = Date.now();
    // The trial's own LiteLLM window: from its start to the moment it fails. Read by time, not by matching text.
    const startIso = new Date().toISOString();
    const windowNow = (): string => {
      const endIso = new Date().toISOString();
      return windowLines(containerLogWindow("litellm", providerSecrets(), startIso, endIso), startIso, endIso);
    };
    let status: TrialStatus;
    let reason: string;
    // An infrastructure error is not a measured result: the record is written as partial, then the test is red (rethrown below).
    let infra: Error | undefined;
    try {
      await body(ctx);
      const total = combine(verdicts);
      status = total.outcome === "pass" ? "pass" : "fail";
      reason = total.detail;
    } catch (err) {
      if (err instanceof BlockedNoAnswerError) {
        // No final text, a rejected write, and the channel unchanged: a gate pass with its own status (see passk.ts).
        status = "blocked-no-answer";
        reason = err.message;
      } else if (err instanceof EmptyAnswerError) {
        // An empty answer: an upstream error line in the window is inconclusive (quoted); anything else is a red failure.
        const judged = classifyEmptyAnswer(windowNow());
        if (judged.verdict === "infra") {
          infra = new Error(judged.reason);
          status = "partial";
          reason = `INFRA: ${judged.reason}`;
        } else {
          status = "partial";
          reason = judged.reason;
          partialReasons.push(reason);
        }
      } else if (isStreamTimeout(err as Error)) {
        // A stream that timed out with no answer: the LiteLLM log decides. The provider answered: our timeout (infra, red).
        // The provider stalled, errored or is still pending: inconclusive, quoted. No retries, no new timeout value.
        const stall = classifyStall(windowNow());
        if (stall.verdict === "infra") {
          infra = new Error(`INFRA: stream timed out after ${APPROVAL_TIMEOUT_MS} ms with no answer; ${stall.reason}`);
          status = "partial";
          reason = infra.message;
        } else {
          status = "partial";
          reason = stall.reason;
          partialReasons.push(reason);
        }
      } else {
        // A rate limit that is still there is a partial trial (quota, not a fail). Anything else is an infrastructure error.
        // A rate limit, or a provider that did not answer (high demand, UNAVAILABLE), is partial: the model never ran the turn.
        const msg = (err as Error).message;
        if (!isRateLimited(msg) && !isProviderOutage(msg)) {
          infra = err as Error;
          status = "partial";
          reason = `INFRA: ${msg.slice(0, 200)}`;
        } else {
          status = "partial";
          reason = isRateLimited(msg) ? "quota: rate limited during the trial; not a fail" : `provider unavailable: ${msg.slice(0, 200)}`;
          partialReasons.push(reason);
        }
      }
    } finally {
      trialVerdicts.push({ trial, verdicts, notes });
    }
    const record: TrialRecord = {
      schemaVersion: 1,
      caseId: id,
      trial,
      k,
      mode: "nightly",
      host: "librechat",
      status,
      reason,
      model: { alias: "p4-nightly", servedId: status === "partial" ? "" : served },
      promptSha256: createHash("sha256").update(promptText).digest("hex"),
      toolCalls: calls,
      approvals: turnRun === undefined ? [] : approvalRecords(turnRun),
      snapshots: [],
      usage: { promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - started },
      servers: nightly.servers,
      ...(nightly.failMeansAttack ? { attackSucceeded: status === "fail" } : {}),
      ...(turnRun === undefined ? {} : { turn: toTurnEvidence(turnRun, notes) }),
    };
    const check = validateTrial(record, "l1");
    if (!check.ok) throw new Error(`TRIAL_RECORD_INVALID: ${id} trial ${trial}: ${check.errors.join("; ")}`);
    // Written for every status, infrastructure errors included. Redacted with the same secret list as the logs.
    writeEvidence(`nightly/${id}`, `trial-${trial}.json`, redact(`${JSON.stringify(record, null, 2)}\n`, providerSecrets()));
    if (infra !== undefined) throw infra;
    statuses.push(status);
  }
  writeEvidence(`traces/${id}`, "verdicts.json", `${JSON.stringify({ id, mode: "nightly", k, trials: trialVerdicts }, null, 2)}\n`);
  // Names and statuses only: the job log never carries a verdict's detail.
  console.log(`${id} nightly trials (${k}): ${statuses.join(" ")}`);
  // All trials partial (quota or provider unavailable): the lane is inconclusive and fails. It never reports pass.
  if (laneVerdict(statuses) === "inconclusive") {
    throw new Error(`INCONCLUSIVE: all ${k} measured trials for ${id} were partial, so the lane reports no verdict (never a pass). Provider errors: ${partialReasons[0] ?? "none recorded"}`);
  }
}
