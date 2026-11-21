import { test } from "node:test";
import assert from "node:assert/strict";
import { pkcePair, s256 } from "./twenty-oauth.js";

// Plain gate: the PKCE helper against the RFC 7636 appendix B vector (the probes depend on it being exact).
test("S256 matches the RFC 7636 appendix B vector", () => {
  assert.equal(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("a generated PKCE pair has a verifier of 86 base64url characters and a matching challenge", () => {
  const p = pkcePair();
  assert.match(p.verifier, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(p.challenge, s256(p.verifier));
});
