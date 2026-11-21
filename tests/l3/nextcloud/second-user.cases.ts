import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runFixture } from "../support/run-fixture.js";
import { onCleanup } from "../support/hygiene.js";
import { runtime } from "../support/runtime.js";
import { controlVerdict, leakVerdict } from "./search-check.js";

// P4-MCP-INJ-012: can user A's search see user B's private note? The harness makes a second Nextcloud user (qa-user-b, H2) with
// its own MCP credential in <product>-b run state. The owner's agent (A) searches with `nc_webdav_search_files`, the WebDAV
// search of the pinned Nextcloud MCP. The pinned tool list has no semantic search, so this is the closest real search tool
// (decision D2 in docs/plans/2026-11-21-l3-second-user.md). Run names are random per run and come in as [var:] markers.

const SEARCH = mcpToolName("nc_webdav_search_files", "nextcloud");
// Two fixtures, one tool call per served turn, one chat each (the stub checks markers against the turn it serves).
const CONTROL_FIXTURE = "p4-mcp-inj-012-search";
const LEAK_FIXTURE = "p4-mcp-inj-012-leak";

/** The second identity's MCP Basic value, read from its run state. Secret: passed to requests, never printed or logged. */
function secondAuthorization(stack: ReturnType<typeof runtime>["stack"]): { url: string; authorization: string } {
  const adapter = stack.adapters.get("nextcloud") as { secondRunStateFile?: () => string } | undefined;
  const file = adapter?.secondRunStateFile?.();
  if (file === undefined) throw new Error("NC_NO_SECOND: the nextcloud adapter exposes no secondRunStateFile (set P4_SECOND_IDENTITY=1)");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpUrl?: unknown; mcpAuthorization?: unknown };
  if (typeof parsed.mcpUrl !== "string" || typeof parsed.mcpAuthorization !== "string") throw new Error("NC_SECOND_SHAPE: the second run state has no mcpUrl or mcpAuthorization");
  return { url: parsed.mcpUrl, authorization: parsed.mcpAuthorization };
}

/** Text of a tools/call result (the first text block), or an error marker. Used for state checks, never for model text. */
function resultText(body: unknown): string {
  const b = body as { result?: { content?: Array<{ text?: unknown }> }; error?: unknown };
  if (b.error !== undefined) return `ERROR:${JSON.stringify(b.error).slice(0, 200)}`;
  return (b.result?.content ?? []).map((c) => (typeof c.text === "string" ? c.text : "")).join("\n");
}

/**
 * A tools/call outcome read the way the server reports it: `isError` from the result (a ToolError sets it), the
 * structuredContent object (the tool's typed return value), and the text for the failure message. The server's
 * nc_webdav_write_file returns `created` (true on HTTP 201); nc_webdav_search_files returns `results` (name, path).
 */
interface ToolOutcome {
  isError: boolean;
  data: Record<string, unknown> | undefined;
  text: string;
}
function toolOutcome(body: unknown): ToolOutcome {
  const b = body as { result?: { isError?: unknown; structuredContent?: unknown; content?: Array<{ text?: unknown }> }; error?: unknown };
  const text = b.error !== undefined ? `JSON-RPC error: ${JSON.stringify(b.error).slice(0, 200)}` : resultText(body);
  const isError = b.error !== undefined || b.result?.isError === true;
  let data: Record<string, unknown> | undefined;
  if (typeof b.result?.structuredContent === "object" && b.result.structuredContent !== null) {
    data = b.result.structuredContent as Record<string, unknown>;
  } else {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "object" && parsed !== null) data = parsed as Record<string, unknown>;
    } catch {
      data = undefined;
    }
  }
  return { isError, data, text };
}

l3Case(
  "P4-MCP-INJ-012",
  "cross-user search: the owner's search cannot see a private note of the second user, and that note is unchanged",
  async (ctx) => {
    const rt = runtime();
    const run = randomBytes(3).toString("hex");
    const ownName = `p4l3-second-a-${run}.md`;
    const bName = `p4l3-second-b-${run}.md`;
    const canary = `p4l3-canary-second-b-${run}`;

    const owner = rt.stack.mcp("nextcloud");
    const ownerMcp = new McpHttpClient(owner.url, owner.authorization);
    await ownerMcp.initialize();
    const second = secondAuthorization(rt.stack);
    const bMcp = new McpHttpClient(second.url, second.authorization);
    await bMcp.initialize();

    // Seed: the owner's file (the control) and user B's private note (the target). A write counts only when the server reports
    // `created: true` (HTTP 201) and no error: a ToolError reply carries isError and no created flag.
    const ownWrite = toolOutcome((await ownerMcp.callTool("nc_webdav_write_file", { path: ownName, content: "p4l3 owner note (control)" })).body);
    const bWrite = toolOutcome((await bMcp.callTool("nc_webdav_write_file", { path: bName, content: `private ${canary}` })).body);
    const created = (o: ToolOutcome) => !o.isError && o.data?.["created"] === true;
    ctx.check(created(ownWrite) ? pass("the owner's control file was created (201) through the owner's MCP") : fail(`owner write did not create the file: ${ownWrite.text.slice(0, 300)}`));
    ctx.check(created(bWrite) ? pass("user B's private note was created (201) through B's MCP") : fail(`user B write did not create the file: ${bWrite.text.slice(0, 300)}`));

    // Readiness (deterministic, no sleep, no retry): the owner's own search, called directly through the same MCP tool, must
    // find the file it just created before the stub run starts. If it does not, the search backend does not see fresh writes on
    // this stack, and the control below cannot pass either. The reply is in the failure message for the job log.
    const direct = toolOutcome((await ownerMcp.callTool("nc_webdav_search_files", { name_pattern: ownName })).body);
    const directNames = Array.isArray(direct.data?.["results"])
      ? (direct.data?.["results"] as Array<Record<string, unknown>>).map((r) => `${String(r["name"])}|${String(r["path"])}`)
      : [];
    const directFound = directNames.some((n) => n.startsWith(`${ownName}|`));
    ctx.check(!direct.isError && directFound ? pass("readiness: the owner's direct search finds the freshly created file") : fail(`readiness: the owner's direct search did not find the file (isError ${String(direct.isError)}; results ${JSON.stringify(directNames).slice(0, 300)}; reply ${direct.text.slice(0, 200)})`));
    onCleanup("nextcloud second-user files", async () => {
      await ownerMcp.callTool("nc_webdav_delete_resource", { path: ownName }).catch(() => undefined);
      await bMcp.callTool("nc_webdav_delete_resource", { path: bName }).catch(() => undefined);
    });

    // B's view before the run: the note exists and is listed for B. Without this the leak check could pass vacuously.
    const bListBefore = resultText((await bMcp.callTool("nc_webdav_list_directory", { path: "" })).body);
    const bNoteBefore = resultText((await bMcp.callTool("nc_webdav_read_file", { path: bName })).body);
    ctx.check(bListBefore.includes(bName) && bNoteBefore.includes(canary) ? pass("user B lists the private note and reads its canary before the run") : fail("user B cannot list or read the private note (the target is missing)"));

    // Chat 1, the control: the owner searches for its own file. Only the own_pattern marker is in this chat.
    const control = await runFixture(rt.stack, {
      fixture: CONTROL_FIXTURE,
      prompt: `[var:own_pattern=${ownName}] Search my files for my own note.`,
      tools: [SEARCH],
    });
    ctx.check(control.stub.some((e) => e.turn === 0) ? pass("control fixture delivered to the stub") : fail("the control fixture never reached the stub (marker lost?)"));
    // The control and leak verdicts read only the parsed results[] entries (search-check.ts), never the raw reply text.
    const controlResults = control.stub.flatMap((e) => e.toolResults);
    ctx.check(controlVerdict(controlResults, ownName));

    // Chat 2, the leak attempt: the owner searches for user B's note. Only the leak_pattern marker is in this chat.
    const leak = await runFixture(rt.stack, {
      fixture: LEAK_FIXTURE,
      prompt: `[var:leak_pattern=${bName}] Search my files for the other note.`,
      tools: [SEARCH],
    });
    ctx.check(leak.stub.some((e) => e.turn === 0) ? pass("leak fixture delivered to the stub") : fail("the leak fixture never reached the stub (marker lost?)"));
    const leakResults = leak.stub.flatMap((e) => e.toolResults);
    ctx.check(leakVerdict(leakResults, bName, canary));

    const bListAfter = resultText((await bMcp.callTool("nc_webdav_list_directory", { path: "" })).body);
    const bNoteAfter = resultText((await bMcp.callTool("nc_webdav_read_file", { path: bName })).body);
    ctx.check(bListAfter.includes(bName) && bNoteAfter.includes(canary) ? pass("user B's private note is still listed and still holds its canary after the run") : fail("user B's private note is missing or changed after the run"));
    ctx.note(`stub turns: control ${String(control.stub.length)}, leak ${String(leak.stub.length)}; tool results to the host: control ${String(controlResults.length)}, leak ${String(leakResults.length)}`);
  },
);
