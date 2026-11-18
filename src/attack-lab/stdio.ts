import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { LabConfig } from "./modes.js";
import { createRuntime, startSideServers, type ListenHost, type Ports } from "./server.js";

/**
 * The same MCP server over stdio. Control and sink still listen on loopback so a test can switch modes.
 * Nothing but protocol frames may go to stdout: logs go to stderr.
 */
export async function runStdio(config: LabConfig, controlToken: string, host: ListenHost, ports: Ports): Promise<void> {
  const runtime = createRuntime(config, controlToken);
  const side = await startSideServers(runtime, host, ports, undefined);
  console.error(`attack-lab control on ${side.controlUrl}, sink on ${side.sinkUrl}`);
  const server = runtime.makeServer();
  await server.connect(new StdioServerTransport());
}
