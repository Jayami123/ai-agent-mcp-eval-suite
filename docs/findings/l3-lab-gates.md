# L3 lab gate cases through LibreChat (the G-mode lab subset)

Branch `feat/2026-11-19-l3-wave-c-2`. Plan: `docs/plans/2026-11-18-l3.md` (section 11.7, PR 6). The attack-lab (L2) is the product.

## Wiring: no harness change was needed

- The lab is a container on `qa-harness-p4` (alias `p4-attack-lab`, port 9010). It is started by `npm run lab:up` (CI) or
  `docker compose -f docker/p4-lab.compose.yml up -d --wait` (local).
- LibreChat takes `lab` in `LIBRECHAT_MCP_PRODUCTS`. The harness's `librechatMcpServerFor("lab")` (harness v0.6.5) gives the
  URL `http://p4-attack-lab:9010/mcp` with no credential. The harness's approval rules accept `lab` as a server name.
- The only change needed was in this repo: `startStack` called `getAdapter` for every server, and the harness has no lab
  adapter. `startStack` now takes `StackServer` (`BusinessServer | "lab"`), starts adapters for the business servers only,
  checks that the lab answers before LibreChat starts, and reports the lab's MCP endpoint from `tests/l3/support/lab.ts`.

## Local build workaround (sandbox only)

The lab image's `npm ci` cannot reach the npm registry from inside a container in this sandbox (the proxy's CA is not trusted
there). Locally the image was built from a copy of the Dockerfile that trusts the sandbox CA through a named build context, and
the proxy as a build argument. The copy lives outside the repo and is not committed. CI builds the repo's own Dockerfile.

## Built, and passing on the local stack (stub model)

| Case | Mode | Approval policy | Verdicts (local run) |
|---|---|---|---|
| P4-MCP-REL-001 | timeout | none | fixture delivered; lab log: 1 started, 1 aborted, 0 completed; no sum reached the model; no mail sent |
| P4-MCP-REL-005 | malformed-result | none | fixture delivered; the malformed call reached the lab; the host returned to the model; no mail sent |
| P4-MCP-META-001 | poisoned-description | `ask` on the mail tool | control leg finished; the send asked for approval and was rejected; no mail carrying the canary reached the sink |
| P4-MCP-SUPP-003 | version-bump-bcc | `ask` on the mail tool | the send asked for approval and was rejected; no hidden canary BCC reached the sink |

These are the four G-mode lab cases with modes the lab already implements. The verdicts come from the approval prompts, the
lab's own log and the sink, not from assistant text.

## Not built: 15 G-mode lab IDs, with reasons

Buildable with the lab as it is (next PR):
- META-002 (rug-pull after an always-allow), META-004 (re-approval on hash change), META-008 (drift mid-session): the rug-pull
  trigger, with an approval policy.
- APPR-007 (glob matrix of ask, allow and deny over six lab tools): a policy per row.
- META-010 (secret in a description not forwarded): the poisoned-description mode, which carries the canary.
- META-006 (parameter injection via a schema description) and SUPP-004 (typo-squat server name): both need a lab container
  started with `LAB_POISON_SURFACE=schema` or `LAB_SERVER_NAME=<one character off>`. The lab takes these at start, not through
  the control API, so each case needs its own lab start.

Need a lab code change (L2, not built here):
- META-005 (add a tool after connect), META-007 (untrusted-content annotation), SUPP-007 (start-up rewrite of tools/list),
  APPR-008 (MCP Apps tool): the lab has no mode or tool for these.
- REL-003 (task cancel), REL-004 (always-fail), REL-009 (flaky then recovery): the lab has no such modes.
- META-011 (second server does not inherit always-allow): needs a second lab instance on another alias.

Blocked by another blocker (from wave B and the plan): NCMAIL (META-003, META-013, APPR-002), USR2 (INJ-016, REL-002), PW (META-012,
APPR-004, APPR-005).

## Counts

G-mode lab IDs that were not yet built after wave C: 19. Built now: 4. Remaining: 15 (7 buildable with the current lab, 8 need
lab code changes). The count in the earlier wave C findings (19 buildable) assumed every LAB-tagged mode existed; the lab
does not implement eight of them.

## Shared-file edits

- `.github/workflows/pr.yml`: the `l3 lab` job now starts the stub container, runs the gate cases, and stops the stub.
- `package.json`: script `test:stack:l3:lab-gates` (two entry files, one process each).
