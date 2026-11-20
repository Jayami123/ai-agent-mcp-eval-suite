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

## Round 2: run pending (commit `bc115dd`)

Changes from round 1: real `channel_id`, `team_id`, `username` and `user_id` values; reply text printed for every call; classification also reads the text (`ok-flag-but-error-text`); one explicit `create_post` through the MCP, read back through the API to record its author.

Open questions this round must answer before assertions are written:

1. What does a missing-argument error look like (text and `isError`)?
2. Does `dm` with a real `username` create a DM, and as whom?
3. Does `create_post` through the MCP record its author as `qa-agent` (the MCP identity)?
4. Does `read_channel` return the post text, and in what shape?
5. Which tool performs a write that could be the sink for INJ-009 (cross-channel post)?

Assertions are built from these answers only. Until they are recorded here, no assertion is written.
