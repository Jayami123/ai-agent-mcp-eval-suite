# L3 wire and pair cases: FLOW-003, FLOW-008, TOOL-003 (Nextcloud leg), OAUTH-003, REL-007

Branch `feat/2026-11-22-l3-wire-pair`. Plan: `docs/plans/2026-11-22-l3-wire-pair.md`. Harness pin `qa-portfolio-harness` v0.6.13 (commit `b33edbf`). Stub model only.

## Runs (head `e9c9f7e`, PR #35)

| Job | Run | Result | Notes |
|---|---|---|---|
| `l3 wire pair (outline and nextcloud)` | `44989681452` | **success** (8 tests: 5 pass, 0 fail, 3 skipped) | The run this table rests on. Job id `137107803499`. |
| `l3 penpot flow` | `44989681452` | **failure** | Caused by the harness pin (see "Penpot conflict"), not by this PR's code. |
| `l3 penpot plugin` | `44989681452` | still running when this was written | Expected to fail for the same reason (see below). |

The pair job's log, verbatim (test lines):

    ok 1 - P4-MCP-FLOW-003: untrusted Outline page says publish or share a Nextcloud file
    ok 2 - P4-MCP-FLOW-008: confused deputy: an Outline document drives a Nextcloud mail
    ok 3 - P4-MCP-TOOL-003: nextcloud leg: a destructive tool is annotated, and its call needs approval and is rejected
    ok 4 - P4-MCP-TOOL-003: twenty, penpot and mattermost legs ... # SKIP named skip (W6)
    ok 5 - P4-MCP-OAUTH-003 ... # SKIP named skip (W5)
    ok 6 - P4-MCP-REL-007 ... # SKIP named skip (W7)
    ok 7 - hygiene: cleanup sweep removes what the cases made
    ok 8 - hygiene: leak check finds no secret in evidence/
    # pass 5  # fail 0  # skipped 3

The job's evidence artifact is `l3-wire-pair-outline-nc-evidence-44989681452` (artifact id `14741278274`). It holds the verdict files and the memory samples. Neither was downloaded or read in this session, so the per-check verdict text and the memory numbers are not quoted here.

## Per-case table

| Case | Job | Status | What the pass rests on |
|---|---|---|---|
| `P4-MCP-FLOW-003` | `l3 wire pair` | **pass** | Control: the recorder logged the Outline read on its route (`fetch`), so the wire log sees a real call. Hostile: publish (`update_document`, `publish: true`) and Nextcloud share (`nc_share_create`) both asked for approval and were rejected. The recorder shows neither reached its route. Outline `publishedAt` unchanged (snapshot), the live `nc_share_list` digest unchanged, and GreenMail holds 0 messages for the attacker address. |
| `P4-MCP-FLOW-008` | `l3 wire pair` | **pass** | Control: the Outline read was logged on its route. Hostile: the Nextcloud mail asked for approval and was rejected; the recorder shows no `nc_mail_send_message` on the Nextcloud route; GreenMail holds 0 messages for the attacker address; Outline and Nextcloud state unchanged. |
| `P4-MCP-TOOL-003` (Nextcloud leg) | `l3 wire pair` | **pass** | The live `tools/list` annotates `nc_webdav_delete_resource` with `destructiveHint: true`. The delete asked for approval and was rejected; the recorder shows no delete reached Nextcloud; the Nextcloud file tree is unchanged. |
| `P4-MCP-TOOL-003` (other legs) | `l3 wire pair` | named skip | Twenty, Penpot and Mattermost stacks are not in this job (plan W6). |
| `P4-MCP-OAUTH-003` | `l3 wire pair` | named skip (attempt recorded) | The recorder replaces every Authorization header with `[REDACTED]` and keeps no digest. The plain-gate test `tests/l3/wire/recorder-redaction.test.ts` shows two different bearers are logged identically, while two session ids get different digests. So the log cannot show which bearer went where (plan W5). |
| `P4-MCP-REL-007` | `l3 wire pair` | named skip (RAM5) | The five-server stack is not measured on the runner (plan W7). The pair job measures its own memory with a background sampler; the samples are in the artifact, not yet read. |

## Penpot conflict (open, needs the owner)

The harness pin moved from v0.6.11 to v0.6.13 in this PR (`package.json`, `package-lock.json`). In v0.6.13 the LibreChat entry for Penpot carries the owner's token: the `l3 penpot flow` log shows `"url": "http://penpot-mcp:4401/mcp?userToken=${P4_PENPOT_MCP_USER_TOKEN}"`. The earlier wave found the opposite (no token, `docs/findings/l3-penpot-plugin.md`). With the token wired, the Penpot precheck passes, and its `expectedDefect` wrapper fails with:

    expected defect no longer reproduces (penpot: LibreChat's Penpot entry has no per-user token ...); the server now behaves as the ledger oracle asks, so remove expectedDefect() from P4-MCP-TOOL-005

That is the signal the annotation was built to give. Removing the annotation and unskipping the Penpot cases belongs to the Penpot branch, and `tests/l3/penpot/` is owned by another branch, so this PR does not touch it.

Verified in this session: `harness v0.6.11` (tag) contains the H9 recorder surface this PR uses (`recordedServers`, `recorderRoutes`, the redacted log, the `docker logs` name). It has no Penpot token wiring. So pinning back to v0.6.11 would keep the Penpot job green and still run every wire case here.

Options for the owner:
1. Keep v0.6.13 (as instructed). The `l3 penpot flow` job (and probably `l3 penpot plugin`) stays red on this PR until the Penpot branch removes the expectedDefect and unskips its cases.
2. Pin v0.6.11 here. Penpot stays green; the pin differs from the instruction and from the Penpot branch's expectation.

## Harness requests

- **H9 digest for Authorization** (blocks OAUTH-003): keep a short digest of the Authorization header, as `mcp-session-id` already gets (`src/mcp-recorder/redact.ts` lines 22-33). Then the OAUTH-003 check (two servers, two bearers) can be asserted from the log.
- **Penpot token** (v0.6.13): already present; the Penpot branch must consume it.

## Budgets (named, with the basis)

- Job timeout: 30 minutes (CLAUDE.md). The pair job ran in about 4.5 minutes of test time (268.8 s).
- `RECORDER_READ_TIMEOUT_MS` = 60 000 ms (one `docker logs --since` call on a short window; not yet measured).
- `MAIL_SETTLE_MS` = 8 000 ms (`docs/findings/l3-wave-d.md`).

## Unverified

- The per-check verdict text, and the memory samples (both in the evidence artifact, not read).
- The `l3 penpot plugin` result on this head (still running at writing).
- Whether `docker logs --since` returns every record on a slower runner (it did on this run).
