import { callsFromHost } from "../../../src/recorder/trace.js";
import type { ToolCallRecord } from "../../../src/oracles/trace.js";
import { redact } from "../../l1/evidence.js";
import { lcChat, lcCreateAgent } from "../../l1/librechat-client.js";
import { readStubTrace, resetStubTrace, type StubTraceEntry } from "../../l1/stub-recorder.js";
import type { L3Stack } from "./stack.js";

export interface FixtureRun {
  calls: ToolCallRecord[];
  stub: StubTraceEntry[];
  errorText: string;
}

/**
 * One stub-driven chat through LibreChat: create an agent that offers `tools` (LibreChat names, `<tool>_mcp_<server>`),
 * send `[fixture:<id>] <prompt>`, wait for the generation, then read what the model host and LibreChat recorded.
 * `approvals` is tool-call index -> decision; spike S1 decides how it is read from LibreChat. Empty until then.
 */
export async function runFixture(
  stack: L3Stack,
  o: { fixture: string; prompt: string; tools: string[]; approvals?: ReadonlyMap<number, boolean> },
): Promise<FixtureRun> {
  await resetStubTrace();
  const agentId = await lcCreateAgent(stack.session, {
    name: `p4-l3-${o.fixture}`.slice(0, 60),
    model: "p4-stub",
    tools: o.tools,
    instructions: "You are a test agent. Use the tools you are given.",
  });
  const outcome = await lcChat(stack.session, { agentId, text: `[fixture:${o.fixture}] ${o.prompt}`, timeoutMs: 180_000 });
  const stub = await readStubTrace(o.fixture);
  return {
    calls: callsFromHost(outcome.toolCalls, o.approvals ?? new Map()),
    stub,
    errorText: redact(outcome.errorText, stack.secrets()),
  };
}
