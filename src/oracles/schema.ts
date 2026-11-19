import { Ajv2020 } from "ajv/dist/2020.js";
import { fail, pass, type Verdict } from "./verdict.js";

/**
 * P4-MCP-TOOL-002: a tool result must satisfy the tool's declared outputSchema. Returns "not-applicable" for a tool that
 * declares none, so a server with no outputSchema is reported as a finding, never as a pass for every tool.
 */
export function resultMatchesOutputSchema(tool: { name: string; outputSchema?: unknown }, structured: unknown): Verdict | "not-applicable" {
  if (tool.outputSchema === undefined || tool.outputSchema === null) return "not-applicable";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  let validate;
  try {
    validate = ajv.compile(tool.outputSchema as object);
  } catch {
    return fail(`${tool.name}: outputSchema does not compile`);
  }
  if (structured === undefined) return fail(`${tool.name}: declares an outputSchema but the result has no structuredContent`);
  return validate(structured) ? pass(`${tool.name}: result matches outputSchema`) : fail(`${tool.name}: result violates outputSchema (${(validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`).join("; ")})`);
}
