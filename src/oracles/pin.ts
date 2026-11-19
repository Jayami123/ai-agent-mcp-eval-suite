import { fail, pass, type Verdict } from "./verdict.js";

export interface ImageRef {
  file: string;
  line: number;
  image: string;
}

/** `image:` lines of a compose file. A text scan, so no YAML dependency; compose files here use one image per line. */
export function imageRefs(compose: string, file: string): ImageRef[] {
  const refs: ImageRef[] = [];
  compose.split(/\r?\n/).forEach((text, i) => {
    const m = /^\s*image:\s*["']?([^\s"'#]+)/.exec(text);
    if (m?.[1]) refs.push({ file, line: i + 1, image: m[1] });
  });
  return refs;
}

export const isDigestPinned = (image: string): boolean => /@sha256:[0-9a-f]{64}$/.test(image);

/**
 * P4-MCP-SUPP-001. Every image must be digest-pinned, or be a named, reasoned finding in `known`. A new unpinned image
 * fails (drift). A finding that is now pinned also fails (the baseline must shrink). Keys of `known` are image strings.
 */
export function composeDigests(refs: ImageRef[], known: Readonly<Record<string, string>>): Verdict {
  if (refs.length === 0) return fail("no image references were found");
  const drift = refs.filter((r) => !isDigestPinned(r.image) && !(r.image in known));
  const stale = Object.keys(known).filter((k) => !refs.some((r) => r.image === k) || refs.some((r) => r.image === k && isDigestPinned(r.image)));
  if (drift.length > 0) return fail(`unpinned image(s): ${drift.map((r) => `${r.image} (${r.file}:${r.line})`).join(", ")}`);
  if (stale.length > 0) return fail(`stale baseline entries (now pinned or gone): ${stale.join(", ")}`);
  const pinned = refs.filter((r) => isDigestPinned(r.image)).length;
  return pass(`${pinned} digest-pinned, ${refs.length - pinned} known finding(s)`);
}
