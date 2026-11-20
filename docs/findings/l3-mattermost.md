# L3 Mattermost: live probe findings

Source: the `l3 mattermost` job in `.github/workflows/pr.yml` (stub model, `P4_L3_CAPTURE=1`, `P4_SECOND_IDENTITY=1`, `P4_SECOND_POSTS=1`). Harness `qa-portfolio-harness` v0.6.8 (`e796439`). Probe code: `tests/l3/mattermost/capture.cases.ts`. No secrets, bearers or message bodies are recorded here; reply text is quoted only where it is an error shape.

## Round 1: run 44692016929 (commit `09f0c25`), job 136140037606, green

Observed (from the job log):

| Fact | Observation |
|---|---|
| MCP handshake | `initialize` HTTP 200, `mcp-session-id` header present |
| `tools/list` | **121 tools** (see the tool names in the committed snapshot, once reviewed) |
| Identities | member `qa-agent` (roles `system_user system_user_access_token`); second `qa-agent-b` (same roles). Two distinct accounts. |
| Member can create a public channel | yes: API `POST /channels` as `qa-agent-b` returned **HTTP 201** |
| Seeded posts (H7) | `town-square`: expected 3, found 3, missing 0, duplicates 0, all authored by `qa-agent-b` |
| Second identity (H2) | distinct from owner; both list 121 tools |
| Post in the new channel | 1 post after creation, authored by the second identity (the channel-creation system message) |
| Archive probe channel | `DELETE /channels/{id}` HTTP 200 |

Round-1 calls passed the channel *name* where tools expect `channel_id`, so most calls tested argument validation, not behaviour. Every such call returned HTTP 200 with the MCP `isError` flag (classified "tool isError") except where noted:

- `dm` (args: `message` only) returned HTTP 200 and was classified **ok**. This needs the reply text before any conclusion: a missing `username` should not succeed. Not yet understood.
- `get_me`, `list_agents`, `list_cpa_fields`, `list_custom_emoji`, `get_user_stats`, `get_user_teams`, `set_dnd` (no args), `search_custom_emoji` (no args was an error) returned `ok`.

Round-1 gap: the reply text was written only to the evidence artifact, not to the log. Round 2 prints it.

## Round 2: run 44694845316 (commit `827d6cf`, same probe code as `bc115dd`)

Run `bc115dd` was cancelled by the concurrency rule when the findings commit was pushed; `827d6cf` carries the identical probe code and ran to completion (job 136149169104, green). Full evidence: artifact `l3-mattermost-evidence-44694845316` (ID 14609939361). Classification counts over 121 tools: 42 `ok`, 79 `tool-isError`; no `ok-flag-but-error-text`.

Changes from round 1: real `channel_id`, `team_id`, `username` and `user_id` values; reply text printed for every call; classification also reads the text (`ok-flag-but-error-text`); one explicit `create_post` through the MCP, read back through the API to record its author.

Open questions this round must answer before assertions are written:

1. What does a missing-argument error look like (text and `isError`)?
2. Does `dm` with a real `username` create a DM, and as whom?
3. Does `create_post` through the MCP record its author as `qa-agent` (the MCP identity)?
4. Does `read_channel` return the post text, and in what shape?
5. Which tool performs a write that could be the sink for INJ-009 (cross-channel post)?

Assertions are built from these answers only. Until they are recorded here, no assertion is written.

### Answers to the round-2 questions

1. **Missing or wrong arguments.** Every such call returns HTTP 200 with `result.isError: true` and text `Error: <message>`, for example `Error: post_id must be a valid ID`, `Error: channel_ids cannot be empty`, `Error: provide at least one of display_name, name, header, purpose to update`. Assertions must read `isError` (the flag is reliable here), not HTTP status.
2. **`dm` with a real username.** Succeeds: `Successfully sent DM to @qa-agent-b with ID: <id>`, sent by the member `qa-agent`. This is a real write, so any case that calls `dm` must snapshot the DM.
3. **MCP post author.** Not yet answered. `create_post` needs `channel_display_name` and `team_display_name`, and returns `Error: channel_display_name cannot be empty - you must call get_channel_info first`. The post never happened in round 2, so the author was not observed. A case that depends on it must first call `get_channel_info`, then `create_post`, and read the author through the API.
4. **`read_channel`.** Returns text, not JSON: `Channel: <name> (Team: QA)`, `Found N posts:`, then `**Post 1** by <username>:` with `Post ID` and `Time` lines. Authors are shown by username.
5. **Sink tool for INJ-009.** `create_post` (after `get_channel_info`) is the cross-channel write. Its approval gate is the LibreChat knob, not the MCP.

### Permission and licence facts (member `qa-agent`)

- Forbidden for the member ("You do not have the appropriate permissions"): `get_channel_member`, `get_channel_members`, `get_channel_members_by_ids`, `get_channel_stats`, `get_channel_unread`, `get_user_teams`, `get_users_not_in_channel`, `list_bots`, `remove_channel_member`, `remove_team_member`, `restore_channel`, `search_users_in_channel`, `update_channel_member_roles`, `update_team_member_roles`, and others.
- Licence-gated (the test server has no licence): `get_channel_groups`, `get_team_groups`, `get_user_groups`, `list_groups`, `list_scheduled_posts`, `get_channel_moderations`, `list_channel_bookmarks`. A case must not depend on these.
- State-changing reads: `set_dnd`, `set_channel_favorite` (toggled a favourite on the member's sidebar), `mark_channel_read`, `delete_draft`. A "no side effect" case must snapshot the member's own state too, or avoid these tools.
- `upload_file` returns `file uploads from a path or URL are only supported in local access mode`. The file-upload oracle (INJ-010 `mm.noFileUpload`) can therefore not be exercised as a real upload here; the case checks that no file post exists.

### Snapshot

`tests/l3/snapshots/mattermost.tools.json` is the full `tools/list` (121 tools, 106 KB), taken from the artifact of run 44694845316 and committed for PROT-007. Checked before commit: no `Bearer` string and no credential in the file. Its 26-character tokens are Mattermost IDs that appear in tool descriptions as examples (`channel_id` example values), not secrets.

### Still open

- The round-2 `create_post` author question (3 above) is answered only by a case that runs the full sequence.
- Round 1's `dm` result with `message` only (`ok`) is not explained. No case calls `dm` without a username.
- OAUTH-015 (per-tool policy): the probe did not test it. The MCP has no per-tool policy setting in its tool list, so this stays skipped as planned.

## Protocol legs: run 44696090074 (commit `7404bbf`, job 136153323831, failed on PROT-001 only)

Per-case results from the job log and `traces/*/verdicts.json` in artifact `l3-mattermost-evidence-44696090074` (ID 14610997008):

| Case | Result | Note |
|---|---|---|
| P4-MCP-PROT-002 | pass | wire messages match schema |
| P4-MCP-PROT-003 | pass | header/body mismatch rejected |
| P4-MCP-PROT-004 | pass | stateless initialize |
| P4-MCP-PROT-007 | pass | live `tools/list` equals `tests/l3/snapshots/mattermost.tools.json` |
| P4-MCP-PROT-008 | pass | unknown tool name: protocol error, no side effect |
| P4-MCP-PROT-009 | pass | invalid JSON-RPC rejected |
| P4-MCP-PROT-012 | pass | protocol version mismatch is a clean failure |
| P4-MCP-OAUTH-001 | pass | 401 carries resource-metadata hint |
| P4-MCP-PROT-001 | **fail, then baselined** | conformance exit 1 because no baseline existed. 19 of 20 scenarios failed; see below. `tests/l3/snapshots/expected-failures/mattermost.yaml` (20 entries) added. Deployment finding: spec gap, passes once baselined with reasons. |

Conformance reasons (from the run's `checks.json` files):
- 17 scenarios: "protocol version 2026-07-28 is not supported by this server". The suite is pinned to 2026-07-28; the probe showed the server accepts 2025-06-18.
- `server-sse-multiple-streams`: HTTP 400 for several POST streams; SSE streams are optional and the server answered with JSON.
- `dns-rebinding-protection`: an invalid Host/Origin got HTTP 200. Not confirmed as a product bug on the ledger; listed, not `expectedDefect`.

Verdict count, from the stub run: PROT-001 fail before baseline; all others pass. The baseline run is pending the next push.
