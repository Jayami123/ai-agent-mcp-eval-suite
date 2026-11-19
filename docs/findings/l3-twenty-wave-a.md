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

- **Move the conformance package to stable.** `@modelcontextprotocol/conformance` is pinned to `0.2.0-alpha.12` because only
  the 0.2 line supports the 2026-07-28 requirement set. When a stable 0.2 (or later) release is published and at least two
  weeks old, bump the exact pin in `package.json` and the lockfile, re-run the `l3 twenty` job, and re-record
  `tests/l3/snapshots/expected-failures/twenty.yaml` from the new run. Not done in this PR: no stable release exists yet.
- **Re-check `P4-MCP-PROT-003` on a Twenty upgrade.** If Twenty starts negotiating 2026-07-28, the case becomes a hard check.
