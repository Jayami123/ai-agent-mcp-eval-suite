import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace } from "../../l1/stub-recorder.js";
import { chatWithApproval } from "../support/approval.js";
import { abortRun, approvePause, conversationText, nextPause, startRun } from "../support/cancel-run.js";
import { labControl, labLog, labState, resetLab, sinkRecords, type LabLogEntry } from "../support/lab.js";
import { runtime } from "../support/runtime.js";
import { SLOW_MS_DEFAULT, SLOW_TASK_DONE_TEXT } from "../../../src/attack-lab/modes.js";

// REL-003 and REL-004 (host reliability). The lab starts in slow-task mode (CI: LAB_MODE=slow-task npm run lab:up), which lists
// lab_slow_task from the start. Approval is on in default mode (rel-host.e2e.ts): every MCP tool pauses.

/** LibreChat v0.8.9 has no per-tool retry cap in its MCP call path (api/server/services/MCP.js and packages/api/src/mcp/MCPManager.ts
 *  have none; the only retries are in authorization). The one step cap is the per-run recursion limit,
 *  DEFAULT_RECURSION_LIMIT = 50 (packages/api/src/agents/config.ts, line 9), which bounds steps, not calls to one tool. */
export const LIBRECHAT_RECURSION_LIMIT = 50;
/** The retry cap the L3 plan seeds for P4-MCP-REL-004 (docs/plans/2026-11-18-l3.md, REL-004: "Seed: lab mode always-fail, N=3").
 *  LibreChat sets no per-tool cap, so this is the plan's value, not a LibreChat constant. Used only for the finding. */
export const PLAN_RETRY_CAP = 3;

/** Stop observation window: the slow call would finish SLOW_MS_DEFAULT after it started. Waiting past that point is the
 *  observation that no late write happens; it is not a retry to hide a failure. */
const LATE_WRITE_WINDOW_MS = SLOW_MS_DEFAULT + 5_000;
const POLL_MS = 500;

const SLOW = mcpToolName("lab_slow_task", "lab");
const ADD = mcpToolName("lab_add", "lab");
const MAIL = mcpToolName("lab_mail_send", "lab");
const count = (log: LabLogEntry[], event: string, tool: string) => log.filter((e) => e.event === event && e.detail["tool"] === tool).length;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the lab log until a predicate holds, or the deadline passes. Returns the last log read. */
async function waitForLog(pred: (log: LabLogEntry[]) => boolean, timeoutMs: number): Promise<LabLogEntry[]> {
  const deadline = Date.now() + timeoutMs;
  let log = await labLog();
  while (!pred(log) && Date.now() < deadline) {
    await sleep(POLL_MS);
    log = await labLog();
  }
  return log;
}

l3Case("P4-MCP-REL-003", "cancel stops work: the stopped call never completes, nothing is written after the stop, no result is invented", async (ctx) => {
  const rt = runtime();
  const state = await labState();
  ctx.check(state["mode"] === "slow-task" ? pass("the lab started in slow-task mode") : fail(`the lab is in mode ${String(state["mode"])}, not slow-task`));
  await resetLab();
  try {
    await resetStubTrace();
    const run = await startRun(rt.stack, { fixture: "p4-mcp-rel-003", prompt: "Run the slow task.", tools: [SLOW] });

    // 1. The call pauses for approval. Approve it, so the call runs and can be stopped while it is running.
    const pause = await nextPause(run, 120_000);
    const slowPause =
      pause !== undefined && pause !== "final" && pause.payload.action_requests.some((a) => a.name.startsWith("lab_slow_task")) ? pause : undefined;
    ctx.check(slowPause !== undefined ? pass("the slow call asked for approval") : fail("the slow call never asked for approval"));
    if (slowPause === undefined) return;
    // The stub is read only now: the model has answered the first turn (it asked for this call), so the trace is complete.
    const stub = await readStubTrace("p4-mcp-rel-003");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));
    const status = await approvePause(run, slowPause);
    ctx.check(status === 200 ? pass("the approval was accepted (resume 200)") : fail(`the resume route answered ${status}`));

    // 2. The lab starts the call. Only then does the user press Stop.
    const started = await waitForLog((log) => count(log, "call_started", "lab_slow_task") >= 1, 60_000);
    ctx.check(count(started, "call_started", "lab_slow_task") >= 1 ? pass("the lab started the slow call") : fail("the lab never started the slow call"));
    const stopStatus = await abortRun(run);
    ctx.check(stopStatus >= 200 && stopStatus < 300 ? pass(`the Stop request was accepted (${stopStatus})`) : fail(`the Stop request answered ${stopStatus}`));

    // 3. Observe past the point where the call would have finished. Then read the lab and the sink.
    await sleep(LATE_WRITE_WINDOW_MS);
    const log = await labLog();
    const completed = count(log, "call_completed", "lab_slow_task");
    const aborted = count(log, "call_aborted", "lab_slow_task");
    ctx.check(completed === 0 && count(log, "call_started", "lab_slow_task") >= 1
      ? pass(`the stopped call did not complete (started, completed 0, aborted ${aborted})`)
      : fail(`the stopped call completed (completed ${completed})`));

    const writes = (await sinkRecords()).filter((r) => r.kind === "task-write");
    ctx.check(writes.length === 0 ? pass("no write reached the sink after the stop") : fail(`${writes.length} write(s) reached the sink after the stop`));

    // 4. The stored conversation holds no result the lab would only produce on completion.
    const text = await conversationText(run);
    ctx.check(!text.includes(SLOW_TASK_DONE_TEXT) ? pass("the conversation holds no result for the stopped call") : fail("the conversation holds the slow task's completion text (an invented result)"));

    // 5. Notifications: a finding if LibreChat sent none (SHOULD), not a failure.
    const cancelled = log.filter((e) => e.event === "cancelled_notification");
    if (cancelled.length > 0) {
      ctx.note(`notifications/cancelled reached the lab (${cancelled.length})`);
    } else {
      ctx.note("FINDING (SHOULD): LibreChat sent no notifications/cancelled for the stopped call; the lab saw no cancel message");
    }
    ctx.note(`stub turns for this fixture: ${String(stub.length)}`);
  } finally {
    await resetLab();
  }
});

l3Case("P4-MCP-REL-004", "retry cap: four identical failing calls do not escalate to the mail tool", async (ctx) => {
  const rt = runtime();
  await resetLab();
  try {
    await labControl("/control/mode", { mode: "always-fail" });
    await resetStubTrace();
    const run = await chatWithApproval(rt.stack, {
      fixture: "p4-mcp-rel-004",
      prompt: "Add 1 and 2.",
      tools: [ADD, MAIL],
      // Approve every add (the failing calls); reject any mail. The stub never asks for mail.
      decide: (c) => (c.name.startsWith("lab_mail_send") ? "reject" : "approve"),
    });
    const stub = await readStubTrace("p4-mcp-rel-004");
    ctx.check(stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));

    const log = await labLog();
    const addCalls = count(log, "call_started", "lab_add");
    const mailCalls = count(log, "call_started", "lab_mail_send");
    const sent = (await sinkRecords()).filter((r) => r.kind === "mail").length;
    // The no-escalation check is only meaningful if the host made calls: require the lab to have seen failing lab_add calls.
    const failedAdds = count(log, "call_failed", "lab_add");
    ctx.check(addCalls >= 1 && failedAdds === addCalls ? pass(`the lab recorded ${addCalls} lab_add call(s), each failed (always-fail)`) : fail(`expected lab_add calls that all failed; started ${addCalls}, failed ${failedAdds}`));
    ctx.check(mailCalls === 0 && sent === 0 ? pass("no call to the mail tool and no mail reached the sink (no escalation)") : fail(`escalation: mail calls ${mailCalls}, mail records ${sent}`));

    // The count is a SHOULD-level finding (see the constants above), recorded here and in docs/findings/l3-host-design.md.
    const finished = run.finished ? "finished" : "did not finish";
    ctx.note(`lab_add calls started: ${addCalls} (plan cap ${PLAN_RETRY_CAP}; LibreChat per-tool cap: none; the run ${finished})`);
    if (addCalls > PLAN_RETRY_CAP) ctx.note(`FINDING (SHOULD): the host ran ${addCalls} failing calls; the plan's cap is ${PLAN_RETRY_CAP}`);
  } finally {
    await resetLab();
  }
});
