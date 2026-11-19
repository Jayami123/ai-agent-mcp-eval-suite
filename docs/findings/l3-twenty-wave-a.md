# L3 wave A findings: Twenty (spikes S2, S3, S4)

Source: CI run 44346353616, job `l3 twenty`, commit `175f53dff22b8b757d5f119aceac978475bce37c`, evidence artifact
`l3-twenty-evidence-44346353616`. Twenty v2.44.0 through the harness v0.6.3, stub mode, fake dev-seed data only. Plan:
`docs/plans/2026-11-18-l3.md`. Public text stays neutral: IDs and one-line statements.

## S2: what Twenty exposes

- **tools/list: 7 tools, 3852 bytes of JSON.** `search_help_center`, `get_tool_catalog`, `execute_tool`, `load_skills`,
  `list_object_metadata_names`, `list_skills`, `learn_tools`. Committed as `tests/l3/snapshots/twenty.tools.json`.
- **No tool declares an `outputSchema`.** `P4-MCP-TOOL-002` is a deployment finding on Twenty (annotation, test passes).
- **Annotations:** every tool except `execute_tool` has `readOnlyHint: true`. `execute_tool` has `readOnlyHint: false` and
  **`destructiveHint: false`**, although it can run delete tools. This matters for `P4-MCP-TOOL-003` (destructive annotation).
- **Record tools are inner names behind `execute_tool`.** 213 names captured in `tests/l3/snapshots/twenty.catalog.json`
  (grammar `find_many_<objects>`, `create_one_<object>`, and so on).
- **The harness API key is read-mostly.** The catalog offers `find_*` for people, companies, opportunities and notes, but
  `create_one_*` only for 13 objects (for example `create_one_blocklist`, `create_one_note_target`, `create_one_message_list`).
  Hostile wave B fixtures must target tools that exist for this key, not `create_one_person`.
- **Protocol:** `initialize` negotiates `2025-06-18`, sets no `Mcp-Session-Id` (stateless in practice).
- **Database:** two workspace schemas (the dev seeder's two workspaces). Singular table names: `person`, `company`,
  `opportunity`, `note`, `blocklist`, and so on. The oracle reads these through the harness read-only pool.
- **Mailpit:** `GET /api/v1/search?query=to:<address>` answers with a message count (0 for an unused address).

## S3: OAuth probe

- Unauthenticated `POST /mcp` returns **401 with a `WWW-Authenticate` resource_metadata hint**, and the metadata document is
  well formed. `P4-MCP-OAUTH-001` passes on Twenty.
- The origin serves `/.well-known/oauth-protected-resource` (200), `/.well-known/oauth-protected-resource/mcp` (200) and
  `/.well-known/oauth-authorization-server` (200). Twenty is OAuth-capable, so the OAuth wave (D3) is feasible for it.

## S4: protocol and conformance

- Twenty implements MCP `2025-06-18`. The 2026-07-28 rules in the plan are stricter than what it negotiates.
- **`P4-MCP-PROT-003` (spec-version gap, deployment finding):** a request whose `Mcp-Method` header disagrees with the body is
  answered HTTP 200. The `Mcp-Method` rule is from spec 2026-07-28 and Twenty negotiates 2025-06-18, so it is not bound by it.
  The case records a deployment finding and passes. The oracle is strict again for any server that negotiates 2026-07-28 or
  later (it fails if such a server accepts the mismatch), and fails if the negotiated version is unknown.
- **`P4-MCP-PROT-009` (expected defect):** a request with no `jsonrpc` member is answered HTTP 200, but JSON-RPC 2.0 requires
  the member. An object `id` and a non-JSON body are rejected. Recorded with `expectedDefect()` (plan D13): the test stays,
  keeps failing on the real behaviour, and fails the day Twenty starts rejecting, to prompt removal of the annotation.
- **Conformance (`P4-MCP-PROT-001`), package `0.2.0-alpha.12`, spec 2026-07-28:** 1 of 20 active scenarios passes
  (`server-sse-multiple-streams`). The other 19 are baselined in `tests/l3/snapshots/expected-failures/twenty.yaml`: the
  tools-list wire schema lacks `resultType`, `ttlMs`, `cacheScope`; the suite expects the reference server's demo tools,
  prompts and resources; and `dns-rebinding-protection` is not a valid reading because the credential proxy does not forward
  the suite's `Host` header to Twenty.

## Supply pins (`P4-MCP-SUPP-001`)

Four images are not digest-pinned: Twenty server and worker (`twentycrm/twenty:${TAG:-v2.44.0}`), Twenty's Mailpit
(`axllent/mailpit:v1.22.3`), the locally built Mattermost MCP image (pinned by git commit), and this repo's local stub image
(built from a digest-pinned base). They are listed in the test as findings; any new unpinned image fails it.

## Follow-ups

- **Move the conformance package to stable.** The L3 alias `p4-conformance-2026` (`npm:@modelcontextprotocol/conformance@0.2.0-alpha.12`, next to L2's stable `0.1.16` under the normal name) because only
  the 0.2 line supports the 2026-07-28 requirement set. When a stable 0.2 (or later) release is published and at least two
  weeks old, bump the exact pin of the alias in `package.json` and the lockfile (and, if L2 has moved to the same line, drop the alias), re-run the `l3 twenty` job, and re-record
  `tests/l3/snapshots/expected-failures/twenty.yaml` from the new run. Not done in this PR: no stable release exists yet.
- **Re-check `P4-MCP-PROT-003` on a Twenty upgrade.** If Twenty starts negotiating 2026-07-28, the case becomes a hard check.

# L3 wave A, PR 2: the other servers (Nextcloud, Penpot, host)

Branch `feat/2026-11-19-l3-wave-a-2`. Four cases from the plan's PR 2 list. Each has one test named by its ID. Results are
from local stack runs (`P4_STACK_TESTS=1`, stub mode, Docker on the build host) and the plain gate (`npm run check`). CI run
IDs are added below once the draft PR's jobs have run.

## Results

| Case | Server | Mode | Result | What the verdict rests on |
|---|---|---|---|---|
| P4-MCP-PROT-011 | Penpot | P | pass | Penpot negotiates `2025-06-18` and advertises no `tasks` capability. `tasks/get` answers JSON-RPC `-32601 Method not found`, so the tasks extension is cleanly absent. Owner's projects and files unchanged (DB digest). |
| P4-MCP-OAUTH-010 | Nextcloud | P | pass | Three Login Flow v2 polls with no browser grant (the flow's own token twice, and a token nobody issued) return no app password. The owner's WebDAV tree is unchanged. |
| P4-MCP-TOOL-008 | Nextcloud | G | pass, with one expected defect | The owner's WebDAV tree is unchanged, and three traversal calls reached the host. Both `..` attempts were refused by the server. An absolute path read the sibling folder (see finding F3). |
| P4-MCP-SUPP-005 | host (dependencies) | P (plain gate) | pass | `npm audit --json` reports 0 advisories; the committed baseline is empty, so nothing high or critical is outside it. |

Totals for the PR: 4 cases built, 3 pass on a stack, 1 passes in the plain gate, 0 skipped by a blocker, 1 expected defect
recorded inside a passing case. The 3 stack-gated tests skip in the plain gate, as designed.

## Findings

- **F1: Nextcloud MCP exposes 110 tools** on `2025-06-18`. Names include `nc_webdav_read_file` and `nc_webdav_write_file`
  (the roles for TOOL-008). The snapshot is committed as `tests/l3/snapshots/nextcloud.tools.json` (about 480 KB, the largest
  committed snapshot). The server hides 78 tools that this Nextcloud instance cannot serve.
- **F2: Penpot MCP exposes 5 tools** (`execute_code`, `high_level_overview`, `penpot_api_info`, `export_shape`,
  `import_image`) and no tasks capability. Snapshot: `tests/l3/snapshots/penpot.tools.json`.
- **F3 (expected defect, TOOL-008): an absolute path reads the sibling folder.** The owner-scoped Nextcloud MCP credential
  refuses `..` segments ("Path may not contain '..' segments"), but it reads `/Private/canary.md` as a path inside the owner's
  own files. The plan's oracle says the result must exclude the sibling folder. The server does not confine the credential to
  the working folder, so the case records this with `expectedDefect()` (plan D13). The case flips to a failure when Nextcloud
  confines the credential, which prompts removal of the annotation. Decision for the reviewer: keep the annotation, or confine
  the server with a folder scope in the harness and drop it.
- **F4: the Penpot database password is not in the harness `dbUrl`.** It is in the per-run secrets file under the product root.
  The oracle reads it from there and never prints it. Table names used are `project` and `file`.

## Deviations recorded for the reviewer

- Shared CI and script edits: the plan (section 14) gives these to the owner. This PR adds two advisory jobs,
  `l3-nextcloud` and `l3-penpot`, to `.github/workflows/pr.yml` (same shape as `l3-twenty`, no Twenty checkout), and two
  scripts to `package.json` (`test:stack:l3:nextcloud`, `test:stack:l3:penpot`).
- The PR 1 cross-server protocol and tool files (`tests/l3/all/*`) still run for Twenty only. Adding Nextcloud or Penpot to them
  needs plan files for TOOL-001 and TOOL-004 on those servers, which are outside this PR.
- The case ledger (`p4-case-ledger.csv`) is not in this repository. Oracle text comes from `tests/l3/support/l3-cases.json`
  and plan section 11.
- SUPP-005 runs `npm audit`, which calls the npm advisory endpoint. The plain gate therefore needs network, as `npm ci` does.
  An unreachable endpoint leaves the case unverified (it fails), not passing.
