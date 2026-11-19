import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ATTACKER, FRIEND, OWNER, STRANGER, type MockUser } from "../../../src/mock-channel/types.js";
import type { CaseContext } from "./case.js";
import { PRIVATE_FIXTURES_ENV } from "./env.js";

// Advisory replays. The advisory details are private-first: they live in files outside the repo, in the directory named by
// P4_PRIVATE_FIXTURES_DIR (a git-ignored path), and are never committed. This module is the public engine that replays such a file
// against the running stack and checks the neutral oracles. It holds no exploit text, no advisory detail and no real secret.

export type AdvisoryActor = "owner" | "friend" | "stranger" | "attacker";
export type AdvisoryStep =
  | { kind: "gateway-http"; method: "GET" | "POST"; path: string; headers?: Record<string, string>; body?: string }
  | { kind: "channel"; as: AdvisoryActor; where?: "dm" | "group"; text: string };

export interface AdvisoryFixture {
  id: string;
  /** A neutral theme word for the artefact, not an advisory id. */
  theme: string;
  steps: AdvisoryStep[];
  expect: { sinkEmpty?: boolean; approvalsUnchanged?: boolean; configUnchanged?: boolean; filesUnchanged?: boolean; noPending?: boolean; noModelCall?: boolean };
}

const ACTORS: Record<AdvisoryActor, MockUser> = { owner: OWNER, friend: FRIEND, stranger: STRANGER, attacker: ATTACKER };
const MAX_BYTES = 64 * 1024;

export function advisoryFixtureFile(id: string, dir: string | undefined = process.env[PRIVATE_FIXTURES_ENV]): string {
  assert.ok(dir !== undefined && dir !== "", `${PRIVATE_FIXTURES_ENV} is not set`);
  assert.match(id, /^p4-oc-adv-\d{3}$/, "an advisory fixture file is named by its case id");
  return path.join(dir, `${id}.json`);
}

/** Validates the shape. Unknown keys, a wrong type or an oversized file are refused, without echoing the content. */
export function parseAdvisory(raw: string, expectedId: string): AdvisoryFixture {
  assert.ok(Buffer.byteLength(raw) <= MAX_BYTES, "the advisory fixture is too large");
  const v = JSON.parse(raw) as Record<string, unknown>;
  const keys = Object.keys(v).sort().join(",");
  assert.equal(keys, "expect,id,steps,theme", "the advisory fixture has unexpected or missing keys");
  assert.equal(v["id"], expectedId, "the advisory fixture id does not match the file");
  assert.equal(typeof v["theme"], "string");
  assert.ok(Array.isArray(v["steps"]) && (v["steps"] as unknown[]).length > 0 && (v["steps"] as unknown[]).length <= 20, "steps must be a list of 1 to 20");
  for (const step of v["steps"] as Array<Record<string, unknown>>) {
    if (step["kind"] === "gateway-http") {
      assert.ok(step["method"] === "GET" || step["method"] === "POST", "bad http method");
      assert.ok(typeof step["path"] === "string" && (step["path"] as string).startsWith("/"), "a gateway path starts with /");
    } else if (step["kind"] === "channel") {
      assert.ok(typeof step["as"] === "string" && step["as"] in ACTORS, "unknown actor");
      assert.equal(typeof step["text"], "string");
    } else assert.fail("unknown step kind");
  }
  const exp = v["expect"] as Record<string, unknown>;
  for (const [k, val] of Object.entries(exp)) {
    assert.ok(["sinkEmpty", "approvalsUnchanged", "configUnchanged", "filesUnchanged", "noPending", "noModelCall"].includes(k), `unknown expectation ${k}`);
    assert.equal(typeof val, "boolean");
  }
  return v as unknown as AdvisoryFixture;
}

export function loadAdvisory(id: string): AdvisoryFixture {
  return parseAdvisory(fs.readFileSync(advisoryFixtureFile(id.toLowerCase()), "utf8"), id.toLowerCase());
}

/** Placeholders a fixture may use. {{SINK}} is a sink URL OpenClaw can reach; {{CANARY}} is a fake value watched at the sink. */
export function fill(text: string, vars: { sink: string; canary: string; token: string }): string {
  return text.replaceAll("{{SINK}}", vars.sink).replaceAll("{{CANARY}}", vars.canary).replaceAll("{{GATEWAY_TOKEN}}", vars.token);
}

/**
 * Replays the file against the running stack and checks its neutral expectations. The gateway token is used only to fill the
 * placeholder and to watch the sink; it is never printed, logged or written.
 */
export async function replayAdvisory(c: CaseContext, id: string, gatewayBase = "http://127.0.0.1:18789"): Promise<void> {
  const fixture = loadAdvisory(id);
  const token = (await c.adapter.authenticate()).authorizationHeader.replace(/^Bearer\s+/i, "");
  const canary = c.canary("adv");
  await c.mc.watch({ canary, gatewayToken: token });
  const vars = { sink: "http://p4-mock-channel:8788/__sink/adv", canary, token };
  const before = await c.oc.snapshot();
  for (const step of fixture.steps) {
    if (step.kind === "gateway-http") {
      await fetch(`${gatewayBase}${fill(step.path, vars)}`, {
        method: step.method,
        headers: Object.fromEntries(Object.entries(step.headers ?? {}).map(([k, v]) => [k, fill(v, vars)])),
        ...(step.body === undefined ? {} : { body: fill(step.body, vars) }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => undefined); // a refused or reset request is an acceptable answer to a replay
    } else {
      const user = ACTORS[step.as];
      const text = fill(step.text, vars);
      const sent = step.where === "group" ? await c.mc.group(user, text) : await c.mc.dm(user, text);
      await c.waitConsumed(sent.updateId);
    }
  }
  await c.settle();
  const after = await c.oc.snapshot();
  const e = fixture.expect;
  if (e.sinkEmpty === true) assert.deepEqual((await c.mc.sink()).filter((r) => r.matched.length > 0), [], "the sink received a watched value");
  if (e.approvalsUnchanged === true) assert.equal(after.approvalsSha256, before.approvalsSha256, "the approvals document changed");
  if (e.configUnchanged === true) assert.equal(after.configSha256, before.configSha256, "openclaw.json changed");
  if (e.filesUnchanged === true) assert.deepEqual(after.files, before.files, "a workspace file changed");
  if (e.noPending === true) assert.deepEqual(await c.pending(), [], "an approval is pending");
  if (e.noModelCall === true) assert.deepEqual(await c.trace(), [], "the model host was called");
}
