import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenKey, mintToken } from "../../src/attack-lab/auth.js";
import { connect, firstText, rawInitialize, rpc, startLab, type LabHandle } from "./helpers.js";

async function mint(lab: LabHandle, body: Record<string, unknown>): Promise<string> {
  const res = await lab.control("/control/mint-token", { method: "POST", body });
  return ((await res.json()) as { token: string }).token;
}
const INIT = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "0" } };

test("auth on: no token gives 401 with a resource_metadata hint, and the metadata document is fetchable", async (t) => {
  const lab = await startLab({ mode: "wrong-audience" });
  t.after(() => lab.close());
  const r = await fetch(lab.mcpUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT }) });
  assert.equal(r.status, 401);
  const header = r.headers.get("www-authenticate") ?? "";
  const url = /resource_metadata="([^"]+)"/.exec(header)?.[1];
  assert.ok(url !== undefined, header);
  const meta = (await (await fetch(url)).json()) as { resource: string; authorization_servers: string[] };
  assert.equal(meta.resource, lab.mcpUrl);
  assert.deepEqual(meta.authorization_servers, [lab.controlUrl]);
  assert.equal(lab.events().includes("call_started"), false);
});

test("wrong-audience: a validly signed token for another audience runs a tool, and the log says audMatches false", async (t) => {
  const lab = await startLab({ mode: "wrong-audience" });
  t.after(() => lab.close());
  const token = await mint(lab, { aud: "other-app" });
  const client = await connect(lab, {}, { token });
  t.after(() => client.close());
  const result = await client.callTool({ name: "lab_add", arguments: { a: 1, b: 1 } });
  assert.deepEqual(result.structuredContent, { sum: 2 });
  const accepted = lab.state.log.filter((entry) => entry.event === "auth_accepted");
  assert.ok(accepted.length > 0);
  assert.equal(accepted.every((entry) => entry.detail["audMatches"] === false && entry.detail["aud"] === "other-app"), true);
  assert.match(String(accepted[0]?.detail["fp"]), /^[0-9a-f]{12}$/);
  assert.equal(JSON.stringify(lab.state.log).includes(token), false, "the token text is never logged");
});

test("benign with auth on: the same wrong-audience token is 401 and no tool runs", async (t) => {
  const lab = await startLab({ auth: true });
  t.after(() => lab.close());
  const wrong = await mint(lab, { aud: "other-app" });
  const r = await rpc(lab, "initialize", INIT, undefined, wrong);
  assert.equal(r.status, 401);
  assert.equal(lab.events().includes("call_started"), false);
  assert.ok(lab.state.log.some((entry) => entry.event === "auth_rejected" && entry.detail["reason"] === "audience"));
});

test("benign with auth on: a token for this resource and issuer works", async (t) => {
  const lab = await startLab({ auth: true });
  t.after(() => lab.close());
  const token = await mint(lab, { aud: lab.mcpUrl });
  const client = await connect(lab, {}, { token });
  t.after(() => client.close());
  const result = await client.callTool({ name: "lab_echo", arguments: { text: "ok" } });
  assert.equal(firstText(result), "ok");
  assert.ok(lab.state.log.some((entry) => entry.event === "auth_accepted" && entry.detail["audMatches"] === true));
});

test("benign with auth on: a look-alike issuer, an expired token and a token signed with another key are all 401", async (t) => {
  const lab = await startLab({ auth: true });
  t.after(() => lab.close());
  const lookAlike = await mint(lab, { aud: lab.mcpUrl, iss: "http://127.0.0.1:1" });
  assert.equal((await rpc(lab, "initialize", INIT, undefined, lookAlike)).status, 401);
  assert.ok(lab.state.log.some((entry) => entry.detail["reason"] === "issuer"));
  const expired = await mint(lab, { aud: lab.mcpUrl, ttlSec: -10 });
  assert.equal((await rpc(lab, "initialize", INIT, undefined, expired)).status, 401);
  assert.ok(lab.state.log.some((entry) => entry.detail["reason"] === "expired"));
  const foreign = mintToken(createTokenKey(), { aud: lab.mcpUrl, iss: lab.controlUrl });
  assert.equal((await rpc(lab, "initialize", INIT, undefined, foreign)).status, 401);
  assert.ok(lab.state.log.some((entry) => entry.detail["reason"] === "signature"));
  for (const token of [lookAlike, expired, foreign]) assert.equal(JSON.stringify(lab.state.log).includes(token), false);
});

test("auth is off by default: no token needed in benign mode", async (t) => {
  const lab = await startLab();
  t.after(() => lab.close());
  const session = await rawInitialize(lab);
  assert.ok(session.length > 0);
});
