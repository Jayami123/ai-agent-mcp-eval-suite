import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The OAUTH-003 attempt (plain gate). The ledger's check needs to tell two bearers apart in the recorder log. This runs the
// harness's own header redactor (dist/mcp-recorder/redact.js, the file the recorder container runs) on two different bearers and on
// two different session ids. The bearers come out identical; the session ids do not. So the log cannot show which bearer went where.
// If the harness adds a digest for Authorization, the first test fails, and the OAUTH-003 skip can be lifted.

interface RedactModule {
  redactHeaders: (h: Record<string, string>) => Record<string, string>;
}
const FILE = path.resolve(process.cwd(), "node_modules/qa-portfolio-harness/dist/mcp-recorder/redact.js");
const load = async (): Promise<RedactModule> => (await import(pathToFileURL(FILE).href)) as RedactModule;

test("OAUTH-003 attempt: two different Authorization values are logged identically", async () => {
  const { redactHeaders } = await load();
  const a = redactHeaders({ authorization: "Bearer p4l3-attempt-token-a-000001" });
  const b = redactHeaders({ authorization: "Bearer p4l3-attempt-token-b-000002" });
  assert.deepEqual(a, b, "the recorder distinguishes two bearers, so the OAUTH-003 gap is closed");
  assert.equal(a["authorization"], "[REDACTED]");
});

test("OAUTH-003 attempt: the MCP session id keeps a digest, so two session ids are told apart", async () => {
  const { redactHeaders } = await load();
  const a = redactHeaders({ "mcp-session-id": "p4l3-session-a" });
  const b = redactHeaders({ "mcp-session-id": "p4l3-session-b" });
  assert.notEqual(a["mcp-session-id"], b["mcp-session-id"]);
  assert.match(a["mcp-session-id"] ?? "", /^sha256:[0-9a-f]{8}$/);
});
