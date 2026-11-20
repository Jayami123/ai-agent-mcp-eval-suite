// Run-time bindings for stub fixtures. A fixture is static JSON in the repo, but some ids (for example an Outline document id)
// are only known once the product is seeded. A fixture argument may be the whole string "{{bind:NAME}}"; the test posts the
// run's real values to PUT /__bindings before the chat, and the stub substitutes them when it answers. A placeholder with no
// binding fails the turn closed (HTTP 500, named placeholder), so a stale fixture cannot send an empty argument.
// Values are ids and labels, never secrets; they are kept in memory and not written to the trace.

export const BINDING_NAME = /^[A-Z][A-Z0-9_]{0,39}$/;
const PLACEHOLDER = /^\{\{bind:([A-Z][A-Z0-9_]{0,39})\}\}$/;
const MAX_VALUE_CHARS = 200;

export type BindingMap = Map<string, string>;

/** Validates a PUT body: a JSON object of NAME -> string. Returns the map, or a reason (naming the key, not the value). */
export function parseBindings(text: string): { ok: true; map: BindingMap } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "body is not valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "body must be a JSON object" };
  const map: BindingMap = new Map();
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!BINDING_NAME.test(name)) return { ok: false, reason: `binding name ${JSON.stringify(name).slice(0, 48)} is not NAME_LIKE_THIS` };
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_VALUE_CHARS) return { ok: false, reason: `binding ${name} must be a non-empty string of at most ${MAX_VALUE_CHARS} characters` };
    map.set(name, value);
  }
  return { ok: true, map };
}

/**
 * A bound value sent to the model's tool call. A value of digits only is sent as a number, because some tool schemas take an
 * integer id (a Mail account id is an integer in the Nextcloud tool schema). Every other value stays a string.
 */
export function typedValue(bound: string): string | number {
  return /^[0-9]{1,15}$/.test(bound) ? Number(bound) : bound;
}

/**
 * Replaces every "{{bind:NAME}}" string in a fixture argument tree with its bound value. Returns the substituted tree, or the
 * first placeholder name that has no binding (the caller fails the turn). Other strings are left untouched.
 */
export function bindArgs(value: unknown, bindings: BindingMap): { ok: true; value: unknown } | { ok: false; missing: string } {
  if (typeof value === "string") {
    const m = PLACEHOLDER.exec(value);
    if (m === null) return { ok: true, value };
    const name = m[1] ?? "";
    const bound = bindings.get(name);
    return bound === undefined ? { ok: false, missing: name } : { ok: true, value: typedValue(bound) };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const r = bindArgs(item, bindings);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = bindArgs(v, bindings);
      if (!r.ok) return r;
      out[k] = r.value;
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}
