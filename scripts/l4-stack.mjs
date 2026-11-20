// Starts or stops the L4 stack once for all L4 tests: LiteLLM (stub route), OpenClaw with the mock Telegram channel, and the
// mock channel container. Product start and stop go through the harness adapters; this script only orders them and hands the
// per-run bot token (made by the harness, never printed) to the mock channel container.
// Usage: node scripts/l4-stack.mjs up|down      (run `npm run build` and `npm run stub:up` first for up)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "docker", "mock-channel.compose.yml");
const NETWORK = "qa-harness-p4";

// Stub mode only. No provider key can reach this stack.
process.env.P4_LLM_MODE = "stub";
process.env.P4_STUB_API_BASE = "http://p4-stub:8787/v1";
process.env.OPENCLAW_RESPONSES_API = "1";
process.env.OPENCLAW_CHANNEL_MOCK = "1";
process.env.OPENCLAW_LOOP_DETECTION = "1";
process.env.OPENCLAW_WEB_FETCH_ALLOWED_HOSTS = "p4-fixture-pages";
delete process.env.GEMINI_API_KEY;

function docker(args, env = process.env) {
  const r = spawnSync("docker", args, { cwd: root, stdio: "inherit", env });
  if (r.status !== 0) {
    console.error(`docker ${args.slice(0, 2).join(" ")} failed with exit code ${String(r.status)}`);
    process.exit(r.status ?? 1);
  }
}

const { getAdapter } = await import("qa-portfolio-harness");
const MOCK = "http://127.0.0.1:8788";

async function mc(method, path, body) {
  const res = await fetch(`${MOCK}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  return res.json();
}

async function waitFor(what, probe, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`L4_STACK_TIMEOUT: ${what} did not happen within ${ms} ms`);
}

// The friend (id 1002) is the paired non-owner several cases need. Pairing is OpenClaw's own flow: the friend writes to the bot, the
// bot answers with a code, the operator approves the code through the CLI. The state is kept in the OpenClaw volume for the run.
async function pairFriend(openclaw) {
  const { createOcOracle } = await import("../dist/oracles/openclaw.js");
  const oc = createOcOracle(openclaw);
  await waitFor("OpenClaw's channel poller", async () => (await mc("GET", "/__mc/status")).pollsInFlight > 0, 180_000);
  await mc("POST", "/__mc/inbound", { chat: { id: 1002, type: "private" }, from: { id: 1002, username: "p4_friend", firstName: "Friend" }, text: "hello, pairing please" });
  const request = await waitFor("a pending pairing request for the friend", async () => oc.pairingPending().find((q) => q.id === "1002"), 60_000);
  oc.pairingApprove(request.code);
  await mc("DELETE", "/__mc/reset");
  console.log("The friend (1002) is paired. No code was printed.");
}

const action = process.argv[2];
if (action === "up") {
  if (spawnSync("docker", ["network", "inspect", NETWORK], { stdio: "ignore" }).status !== 0) {
    docker(["network", "create", "--driver", "bridge", NETWORK]);
  }
  await getAdapter("litellm").up();
  const openclaw = getAdapter("openclaw");
  await openclaw.up();
  const token = openclaw.mockChannelBotToken();
  if (token === undefined) throw new Error("L4_STACK_NO_BOT_TOKEN: the harness made no mock channel token (is OPENCLAW_CHANNEL_MOCK=1 honoured?)");
  docker(["compose", "-f", compose, "up", "-d", "--build", "--wait"], { ...process.env, MOCK_CHANNEL_TOKEN: token });
  // OpenClaw started before the mock channel existed, so its Telegram provider could not resolve the alias and backs off for
  // minutes. A harness restart (about 35 to 47 s) makes it connect now. The state volume and the config are kept.
  await openclaw.restart();
  await pairFriend(openclaw);
  console.log("L4 stack is up: LiteLLM, OpenClaw with the mock channel, and the mock channel container. No token was printed.");
} else if (action === "down") {
  docker(["compose", "-f", compose, "down", "--remove-orphans"], { ...process.env, MOCK_CHANNEL_TOKEN: "down" });
  await getAdapter("openclaw").down().catch((e) => console.error(`openclaw down failed: ${e.message}`));
  await getAdapter("litellm").down().catch((e) => console.error(`litellm down failed: ${e.message}`));
} else {
  console.error("usage: node scripts/l4-stack.mjs up|down");
  process.exit(2);
}
