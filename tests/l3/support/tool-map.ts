import fs from "node:fs";
import path from "node:path";
import type { ToolDef } from "./mcp-client.js";
import type { BusinessServer } from "./stack.js";

// Role -> real tool name, per server. Filled by spike S2 from the captured tools/list, never from memory. A role the
// map does not know throws, so a guessed name cannot reach a fixture.
const DIR = path.resolve(process.cwd(), "tests", "l3", "snapshots");

export function toolsSnapshot(server: BusinessServer): ToolDef[] {
  const file = path.join(DIR, `${server}.tools.json`);
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { tools: ToolDef[] }).tools;
}

export function roleMap(): Record<string, Record<string, string>> {
  return JSON.parse(fs.readFileSync(path.join(DIR, "tool-roles.json"), "utf8")) as Record<string, Record<string, string>>;
}

/** Real server-side name for a role, for example toolFor("nextcloud", "mail_send"). Checked against the snapshot. */
export function toolFor(server: BusinessServer, role: string): string {
  const name = roleMap()[server]?.[role];
  if (name === undefined) throw new Error(`L3_ROLE_UNKNOWN: no ${server} tool bound to role ${role}; run spike S2 and fill tool-roles.json`);
  if (!toolsSnapshot(server).some((t) => t.name === name)) throw new Error(`L3_ROLE_STALE: ${server}.${role} -> ${name} is not in the committed snapshot`);
  return name;
}

/**
 * Twenty serves its record tools behind execute_tool: the model calls execute_tool with { toolName, arguments }, and
 * toolName comes from get_tool_catalog. Spike S2 captures that catalog to tests/l3/snapshots/twenty.catalog.json.
 */
export function twentyInnerTool(role: string): string {
  const name = roleMap()["twentyInner"]?.[role];
  if (name === undefined) throw new Error(`L3_ROLE_UNKNOWN: no Twenty inner tool bound to role ${role}; run spike S2`);
  const catalog = JSON.parse(fs.readFileSync(path.join(DIR, "twenty.catalog.json"), "utf8")) as { tools: Array<{ name: string }> };
  if (!catalog.tools.some((t) => t.name === name)) throw new Error(`L3_ROLE_STALE: twentyInner.${role} -> ${name} is not in twenty.catalog.json`);
  return name;
}

export function twentyInnerNames(): string[] {
  const catalog = JSON.parse(fs.readFileSync(path.join(DIR, "twenty.catalog.json"), "utf8")) as { tools: Array<{ name: string }> };
  return catalog.tools.map((t) => t.name);
}
