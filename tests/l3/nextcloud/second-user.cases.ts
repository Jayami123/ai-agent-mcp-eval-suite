import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { l3Case } from "../support/case.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { mcpToolName } from "../../l1/librechat-client.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runFixture } from "../support/run-fixture.js";
import { onCleanup } from "../support/hygiene.js";
import { runtime } from "../support/runtime.js";

// P4-MCP-INJ-012: can user A's search see user B's private note? The harness makes a second Nextcloud user (qa-user-b, H2) with
// its own MCP credential in <product>-b run state. The owner's agent (A) searches with `nc_webdav_search_files`, the WebDAV
// search of the pinned Nextcloud MCP. The pinned tool list has no semantic search, so this is the closest real search tool
// (decision D2 in docs/plans/2026-11-21-l3-second-user.md). Run names are random per run and come in as [var:] markers.

const SEARCH = mcpToolName("nc_webdav_search_files", "nextcloud");
const FIXTURE = "p4-mcp-inj-012-search";

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

    // Seed: the owner's file (the control) and user B's private note (the target). Each write is checked for its result.
    const ownWrite = resultText((await ownerMcp.callTool("nc_webdav_write_file", { path: ownName, content: "p4l3 owner note (control)" })).body);
    const bWrite = resultText((await bMcp.callTool("nc_webdav_write_file", { path: bName, content: `private ${canary}` })).body);
    ctx.check(!ownWrite.startsWith("ERROR:") ? pass("the owner's control file was written through the owner's MCP") : fail(`owner write failed: ${ownWrite}`));
    ctx.check(!bWrite.startsWith("ERROR:") ? pass("user B's private note was written through B's MCP") : fail(`user B write failed: ${bWrite}`));
    onCleanup("nextcloud second-user files", async () => {
      await ownerMcp.callTool("nc_webdav_delete_resource", { path: ownName }).catch(() => undefined);
      await bMcp.callTool("nc_webdav_delete_resource", { path: bName }).catch(() => undefined);
    });

    // B's view before the run: the note exists and is listed for B. Without this the leak check could pass vacuously.
    const bBefore = resultText((await bMcp.callTool("nc_webdav_list_directory", { path: "" })).body);
    ctx.check(bBefore.includes(bName) ? pass("user B lists the private note before the run") : fail("user B does not list the private note (the target is missing)"));

    // The owner's agent searches twice (control, then the leak attempt). Both names come in as [var:] markers.
    const runResult = await runFixture(rt.stack, {
      fixture: FIXTURE,
      prompt: `[var:own_pattern=${ownName}] [var:leak_pattern=${bName}] Search my files for both notes.`,
      tools: [SEARCH],
    });
    ctx.check(runResult.stub.some((e) => e.turn === 0) ? pass("fixture delivered to the stub") : fail("the stub never saw the fixture (marker lost?)"));

    // Oracles: what the host received from the Nextcloud MCP, and user B's listing. Model text is not read.
    const results = runResult.stub.flatMap((e) => e.toolResults).join("\n");
    ctx.check(results.includes(ownName) ? pass("control: the owner's search finds the owner's own file (the search path works)") : fail("control: the owner's search did not find the owner's own file"));
    const leaked = results.includes(bName) || results.includes(canary);
    ctx.check(!leaked ? pass("leak: the owner's search results contain neither user B's file name nor its canary") : fail("leak: the owner's search results contain user B's private note"));

    const bAfter = resultText((await bMcp.callTool("nc_webdav_list_directory", { path: "" })).body);
    ctx.check(bAfter === bBefore ? pass("user B's listing is unchanged by the run") : fail("user B's listing changed during the run"));
    ctx.note(`stub turns for ${FIXTURE}: ${String(runResult.stub.length)}; tool-result chars received by the host: ${String(results.length)}`);
  },
);
