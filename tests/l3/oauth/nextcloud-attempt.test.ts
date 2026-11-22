import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The one real attempt to put Nextcloud in OAuth mode (plan section 4). It runs the harness's own resolver (the file the suite's
// config reads, dist/adapters/librechat-oauth.js) with LIBRECHAT_MCP_OAUTH=1 and Nextcloud as the only MCP product. Plain gate: no
// stack, no secret. The package's exports map does not expose this file, so it is imported by its path.

type Resolver = (opts: { flag: string; mcpProducts: string[]; twentyBrowserBaseUrl: string }) => { products: string[] } | null;
interface HarnessOauthModule {
  resolveLibreChatMcpOauth: Resolver;
  LIBRECHAT_MCP_OAUTH_NO_SERVER: string;
  LIBRECHAT_MCP_OAUTH_INVALID: string;
}

const FILE = path.resolve(process.cwd(), "node_modules/qa-portfolio-harness/dist/adapters/librechat-oauth.js");
const load = async (): Promise<HarnessOauthModule> => (await import(pathToFileURL(FILE).href)) as HarnessOauthModule;
const BASE = "http://127.0.0.1:3002";

test("nextcloud attempt: LIBRECHAT_MCP_OAUTH=1 with Nextcloud as the only product is refused by the harness", async () => {
  const mod = await load();
  assert.throws(
    () => mod.resolveLibreChatMcpOauth({ flag: "1", mcpProducts: ["nextcloud"], twentyBrowserBaseUrl: BASE }),
    (err: Error) => err.message.startsWith(`${mod.LIBRECHAT_MCP_OAUTH_NO_SERVER}:`),
  );
});

test("nextcloud attempt: with Nextcloud beside Twenty, the harness drops Nextcloud from the OAuth products", async () => {
  const mod = await load();
  const r = mod.resolveLibreChatMcpOauth({ flag: "1", mcpProducts: ["nextcloud", "twenty"], twentyBrowserBaseUrl: BASE });
  assert.deepEqual(r?.products, ["twenty"]);
});

test("the OAuth flag accepts exactly 1 (the harness refuses any other value without echoing it)", async () => {
  const mod = await load();
  assert.throws(() => mod.resolveLibreChatMcpOauth({ flag: "yes", mcpProducts: ["twenty"], twentyBrowserBaseUrl: BASE }), (err: Error) => err.message.startsWith(`${mod.LIBRECHAT_MCP_OAUTH_INVALID}:`));
});
