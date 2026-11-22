import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecorderLines, toolCallsOn } from "./recorder.js";

// Plain gate: the recorder log parser, on fake lines shaped like the harness's records (src/mcp-recorder/proxy.ts lines 115-125).
const line = (server: string, method: string, name?: string): string =>
  JSON.stringify({ ts: "2026-11-22T00:00:00.000Z", kind: "request", id: 1, server, method: "POST", path: "/mcp", body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params: name === undefined ? {} : { name, arguments: {} } }) });

test("parseRecorderLines keeps JSON object lines and skips anything else", () => {
  const text = [line("outline", "tools/call", "fetch"), "mcp-recorder: listening on 9100", "", "not json {", "[1,2]"].join("\n");
  assert.equal(parseRecorderLines(text).length, 1);
});

test("toolCallsOn returns the tools/call names on one route only, in order", () => {
  const records = parseRecorderLines(
    [line("outline", "tools/call", "fetch"), line("nextcloud", "tools/call", "nc_share_create"), line("outline", "tools/list"), line("outline", "tools/call", "update_document")].join("\n"),
  );
  assert.deepEqual(toolCallsOn(records, "outline"), ["fetch", "update_document"]);
  assert.deepEqual(toolCallsOn(records, "nextcloud"), ["nc_share_create"]);
  assert.deepEqual(toolCallsOn(records, "twenty"), []);
});

test("toolCallsOn ignores a response record and a body that is not JSON", () => {
  const records = parseRecorderLines(
    [JSON.stringify({ kind: "response", server: "outline", status: 200 }), JSON.stringify({ kind: "request", server: "outline", body: "[REDACTED]" })].join("\n"),
  );
  assert.deepEqual(toolCallsOn(records, "outline"), []);
});
