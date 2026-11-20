import { test } from "node:test";
import assert from "node:assert/strict";
import { combine, type Verdict } from "../../../src/oracles/verdict.js";
import { writeEvidence } from "../../l1/evidence.js";
import { caseDef } from "./registry.js";

export type RunMode = "stub" | "nightly";

export interface CaseCtx {
  id: string;
  mode: RunMode;
  /** Record one oracle verdict (state, trace or sink). A case with no verdicts fails: assistant text is never an oracle. */
  check(v: Verdict): void;
  /** Free-form line for the evidence file (no secrets). */
  note(line: string): void;
}

const runMode = (): RunMode => (process.env["P4_LLM_MODE"] === "nightly" ? "nightly" : "stub");

/**
 * One L3 case = one test whose name starts with the case ID. The body does the work and records verdicts. The wrapper
 * fails the test unless there is at least one verdict and all are pass, and always writes evidence/traces/<id>/verdicts.json.
 * `opts.blocker`: for a STRETCH case only, a named reason; the test is registered and skipped with that reason.
 * `opts.namedSkip`: for a CORE case that is blocked outside this suite, a named skip that points to the document holding the
 * blocker (for example a harness request). The body is kept, so the case runs again once the blocker is removed.
 */
export function l3Case(id: string, title: string, body: (ctx: CaseCtx) => Promise<void>, opts: { blocker?: string; stack?: boolean; namedSkip?: string } = {}): void {
  const def = caseDef(id);
  const { blocker, namedSkip } = opts;
  if (namedSkip !== undefined && !/docs\/[\w./-]+\.md/.test(namedSkip)) throw new Error(`L3_NAMED_SKIP_NO_DOC: ${id} needs a docs/ path in namedSkip`);
  // A case that needs no running product (opts.stack false) runs in the plain gate.
  const stack = opts.stack === false || process.env["P4_STACK_TESTS"] === "1";
  if (blocker !== undefined && def.kind !== "stretch") throw new Error(`L3_CORE_CANNOT_SKIP: ${id} is core; a core case is deferred in the plan, not skipped`);
  const measuredOnly = runMode() === "nightly" && !def.modes.includes("M");
  const skip: string | false =
    namedSkip !== undefined ? `named skip: ${namedSkip}` : blocker !== undefined ? `blocked: ${blocker}` : !stack ? "requires P4_STACK_TESTS=1 (L3 stack job)" : measuredOnly ? "not a measured case (stub gate only)" : false;
  test(`${id}: ${title}`, { skip, timeout: 30 * 60_000 }, async () => {
    const verdicts: Verdict[] = [];
    const notes: string[] = [];
    const ctx: CaseCtx = { id, mode: runMode(), check: (v) => void verdicts.push(v), note: (l) => void notes.push(l) };
    try {
      await body(ctx);
    } finally {
      writeEvidence(`traces/${id}`, "verdicts.json", `${JSON.stringify({ id, mode: ctx.mode, verdicts, notes }, null, 2)}\n`);
    }
    const total = combine(verdicts);
    assert.equal(total.outcome, "pass", `${id}: ${total.detail}`);
  });
}
