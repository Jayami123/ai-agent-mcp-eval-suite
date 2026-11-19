import { createHash } from "node:crypto";
import { canonicalJson } from "../stub/canonical.js";
import type { LabTool } from "./modes.js";

/** SHA-256 (hex) of the parts of a tool a host pins. Key order never changes the hash. */
export function toolHash(tool: LabTool): string {
  const { name, description, inputSchema, outputSchema, annotations } = tool;
  return createHash("sha256")
    .update(canonicalJson({ name, description, inputSchema, outputSchema, annotations }))
    .digest("hex");
}

/** Hash of a whole tool list. The order of the list does not matter. */
export function toolsHash(tools: LabTool[]): string {
  const lines = tools
    .map((tool) => `${tool.name}:${toolHash(tool)}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(lines).digest("hex");
}
