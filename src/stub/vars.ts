// Run-time values for stub fixtures. A test sends `[var:<name>=<value>]` in its user message (the same place as the
// `[fixture:<id>]` marker), and a fixture writes `"{{<name>}}"` as a whole tool-argument value. The stub replaces the
// placeholder with the value before it answers, so a fixture can use a value that only exists at run time (for example a
// Mail account id that the harness assigns). Nothing else is substituted: a placeholder must be the whole string.
//
// Fail loudly, never guess: a malformed marker, a placeholder with no marker, and a marker no placeholder uses are all errors.

/** `[var:name=value]`. The body is taken whole, then checked by parseVarBody (so a bad body is reported, not skipped). */
export const VAR_MARKER = /\[var:([^\]]*)\]/g;
/** A whole-value placeholder in a fixture argument. Anything else that contains "{{" is rejected when the fixture loads. */
export const VAR_PLACEHOLDER = /^\{\{([a-z][a-z0-9_]{0,31})\}\}$/;
/** A whole-value binding placeholder (src/stub/bindings.ts). Left to that module. */
export const BIND_PLACEHOLDER = /^\{\{bind:[A-Z][A-Z0-9_]{0,39}\}\}$/;
export const VAR_NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const VAR_VALUE = /^[A-Za-z0-9_.@-]{1,128}$/;

export class VarInvalidError extends Error {}
export class VarMissingError extends Error {}

/** One marker body (`name=value`) to a pair. Throws VarInvalidError for any other shape. */
export function parseVarBody(body: string): { name: string; value: string } {
  const eq = body.indexOf("=");
  if (eq < 0) throw new VarInvalidError("var marker must be [var:<name>=<value>]");
  const name = body.slice(0, eq);
  const value = body.slice(eq + 1);
  if (!VAR_NAME.test(name)) throw new VarInvalidError(`var name is not valid: ${JSON.stringify(name)}`);
  if (!VAR_VALUE.test(value)) throw new VarInvalidError(`var value for ${name} is not valid (letters, digits, _ . @ - only, 1 to 128 characters)`);
  return { name, value };
}

/**
 * Every var marker in a text. A name given twice is an error, even with the same value, so a case cannot quietly send
 * two answers for one name.
 */
export function parseVarMarkers(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(VAR_MARKER)) {
    const { name, value } = parseVarBody(match[1] ?? "");
    if (Object.prototype.hasOwnProperty.call(out, name)) throw new VarInvalidError(`var ${name} is given more than once`);
    out[name] = value;
  }
  return out;
}

/** The placeholder names in a fixture's arguments (recursively). Throws VarInvalidError for a "{{" that is not a whole-value placeholder. */
export function placeholdersIn(value: unknown): string[] {
  if (typeof value === "string") {
    if (!value.includes("{{")) return [];
    // `{{bind:NAME}}` is the separate binding mechanism (src/stub/bindings.ts), validated when it is resolved, not here.
    if (BIND_PLACEHOLDER.test(value)) return [];
    const m = VAR_PLACEHOLDER.exec(value);
    if (!m) throw new VarInvalidError(`argument ${JSON.stringify(value)} is not a whole-value {{name}} placeholder`);
    return [m[1] ?? ""];
  }
  if (Array.isArray(value)) return value.flatMap((v) => placeholdersIn(v));
  if (value !== null && typeof value === "object") return Object.values(value).flatMap((v) => placeholdersIn(v));
  return [];
}

/**
 * The arguments with every placeholder replaced. A value that is a whole integer is sent as a number (a Mail account id is an
 * integer in the tool schema); every other value is sent as a string. Returns the unused marker names so the caller can
 * refuse a marker nothing used. Throws VarMissingError for a placeholder with no value.
 */
export function substituteVars(args: unknown, vars: Record<string, string>): { args: unknown; used: Set<string> } {
  const used = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const m = VAR_PLACEHOLDER.exec(v);
      if (!m) return v;
      const name = m[1] ?? "";
      const value = vars[name];
      if (value === undefined) throw new VarMissingError(`no [var:${name}=...] marker in the message for this fixture`);
      used.add(name);
      return /^-?\d+$/.test(value) ? Number(value) : value;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { args: walk(args), used };
}

/**
 * The marker names the request gave that no placeholder in the WHOLE fixture uses. A marker rides in the latest user message, and
 * every turn of a tool loop sees that same message, so a turn with no placeholder (an execute_code step after an export that used
 * the shape id) would otherwise refuse a marker its own turn does not need. A name no turn uses is still refused, so a typo stays
 * caught. Pure.
 */
export function markersUnusedByFixture(turns: ReadonlyArray<{ tool_calls?: ReadonlyArray<{ arguments?: unknown }> }>, vars: Record<string, string>): string[] {
  const used = new Set<string>();
  for (const turn of turns) {
    for (const call of turn.tool_calls ?? []) {
      for (const name of placeholdersIn(call.arguments)) used.add(name);
    }
  }
  return Object.keys(vars).filter((name) => !used.has(name));
}
