import { unchanged } from "../../../src/oracles/snapshot.js";
import { fail, pass } from "../../../src/oracles/verdict.js";
import { l3Case } from "../support/case.js";
import { McpHttpClient } from "../support/mcp-client.js";
import { runtime } from "../support/runtime.js";
import { makeViewer, outlineSession, restoreMember, seedOl0, WELCOME_TITLE } from "../support/seed/outline.js";

// P4-MCP-OAUTH-012 and P4-MCP-OAUTH-013. The second identity (H2) is made a `viewer` through the owner's API, and the viewer's
// own MCP credential is used directly (LibreChat carries only the owner key, so no model is involved: mode G). Oracles are the
// owner's REST view before and after, and the viewer's own MCP replies. Assistant text is never read.

// The page body for these cases is not an injection; it only needs to exist in the public collection.
const BENIGN = "P4L3 benign page for the authorisation cases. Fake data only.";

/** The text of every content block in an MCP reply, plus the raw body (so an ID or title anywhere in it is found). */
function replyText(body: unknown): string {
  return JSON.stringify(body);
}

interface ToolReply {
  status: number;
  body: unknown;
}

l3Case("P4-MCP-OAUTH-012", "an Outline viewer cannot publish into the restricted collection", async (ctx) => {
  const rt = runtime();
  const s = await outlineSession(rt);
  const ids = await seedOl0(s, BENIGN);
  await makeViewer(s);
  try {
    // Setup, asserted first: the restriction is real. REST as the viewer must refuse to list the restricted collection.
    const setup = await s.oracle.api(s.viewerAuthorization, "documents.list", { collectionId: ids.restrictedCollection });
    ctx.check(setup.status === 403 ? pass("setup: the viewer is refused on the restricted collection (REST 403)") : fail(`setup: the viewer reached the restricted collection (HTTP ${setup.status})`));
    const before = await s.oracle.snapshot();
    const mcp = new McpHttpClient(rt.stack.mcp("outline").url, s.viewerAuthorization);
    await mcp.initialize();
    const title = "P4L3 oauth-012 attempt";
    const reply = (await mcp.callTool("create_document", { title, text: "P4L3 attempt body.", collectionId: ids.restrictedCollection, publish: true })) as ToolReply;
    const result = (reply.body as { result?: { isError?: unknown } }).result;
    ctx.check(reply.status === 200 ? pass("the viewer's create_document call reached the MCP") : fail(`the call did not reach the MCP (HTTP ${reply.status})`));
    ctx.check(result?.isError === true ? pass("the MCP refused the create (tool error)") : fail("the viewer's create was not refused"));
    ctx.check(unchanged(before, await s.oracle.snapshot()));
    const docs = (await s.oracle.listAll("documents.list", { collectionId: ids.restrictedCollection })) as Array<{ title?: unknown }>;
    ctx.check(!docs.some((d) => d.title === title) ? pass("no document from the attempt exists in the restricted collection") : fail("a document from the attempt exists in the restricted collection"));
    ctx.note(`viewer create_document refused as expected; reply shape: ${JSON.stringify({ isError: result?.isError === true })}`);
  } finally {
    await restoreMember(s);
  }
});

l3Case("P4-MCP-OAUTH-013", "Outline list calls by a viewer leak no restricted title or id", async (ctx) => {
  const rt = runtime();
  const s = await outlineSession(rt);
  const ids = await seedOl0(s, BENIGN);
  await makeViewer(s);
  try {
    const mcp = new McpHttpClient(rt.stack.mcp("outline").url, s.viewerAuthorization);
    await mcp.initialize();
    const replies: unknown[] = [];
    const list = (await mcp.callTool("list_documents", { query: "P4L3", limit: 25 })) as ToolReply;
    replies.push(list.body);
    const pub = (await mcp.callTool("list_collection_documents", { collectionId: ids.publicCollection })) as ToolReply;
    replies.push(pub.body);
    const cols = (await mcp.callTool("list_collections", { limit: 25 })) as ToolReply;
    replies.push(cols.body);
    const all = replies.map(replyText).join("\n");
    // Positive control, asserted first: the viewer does see the public page. Without it an empty answer proves nothing.
    ctx.check(replyText(pub.body).includes(WELCOME_TITLE) ? pass("control: the viewer lists the public page (the filter is not simply empty)") : fail("control: the viewer does not list the public page, so the test is not meaningful"));
    const restrictedNeedles = [ids.restricted, ids.restrictedCollection, "P4L3 restricted title canary", "P4L3 Restricted"];
    const leaked = restrictedNeedles.filter((n) => all.includes(n));
    ctx.check(leaked.length === 0 ? pass("no restricted title, document id or collection id in the viewer's list replies") : fail(`${leaked.length} restricted value(s) appear in the viewer's list replies`));
    ctx.note(`list_documents status ${list.status}, list_collection_documents status ${pub.status}, list_collections status ${cols.status}`);
  } finally {
    await restoreMember(s);
  }
});
