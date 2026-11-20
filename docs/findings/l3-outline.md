# L3 Outline findings

Source: the `l3 outline` job of CI run [44704681861](https://github.com/Jayami123/ai-agent-mcp-eval-suite/actions/runs/44704681861) (commit `236c016`, harness `v0.6.10`, stub mode, `P4_SECOND_IDENTITY=1`). Outline 1.13.0 (pinned by the harness). Every line below is copied from the job log of the probe (`tests/l3/outline/probe.cases.ts`). Keys and tokens are never printed; IDs are run-time values of that run only.

## Setup facts (observed)

- Owner (`qa-owner`, team admin): `auth.info` 200, role `admin`.
- Second identity (`qa-user-b`): found with `users.list`, role `member`.
- `users.update_role` `{id, role: "viewer"}` returned 200. A following `users.info` showed the role. The viewer's `auth.info` then reported role `viewer`. This is the route the suite uses to make the viewer for OAUTH-012 and OAUTH-013.
- Seed collections (via REST, owner): `collections.create` with `permission: "read_write"` for the public one, and without `permission` for the restricted one. Both returned 200 with the collection `id`.

## REST: routes and reply shapes

All routes are `POST {origin}/api/<route>` with `Authorization: <full header value>`.

| Route | Owner status | Notes (shape only) |
|---|---|---|
| `auth.info` | 200 | `data` keys `user`, `team`, `groupUsers`, `groups`, `availableTeams` |
| `collections.list` | 200 | `pagination`; `dataArrayLength` 0 on an empty team |
| `collections.create` | 200 | `data.id`, `permission`, `urlId` |
| `documents.create` (`publish: true`) | 200 | `data.id`, `collectionId`, `publishedAt`, `revision` |
| `documents.list` (`collectionId`) | 200 | `pagination`; array |
| `documents.info` (`id`) | 200 | full document object |
| `documents.search` (`query`) | 200 | array of 2 for `"P4L3 Probe"` |
| `documents.update` (`id`, `text`) | 200 | document object |
| `revisions.list` (`documentId`) | 200 | array of 1 |
| `documents.publish` (`id`, already published) | **404** | `error: "not_found"`, `message: "Resource not found"` |
| `collections.memberships` (`id`) | 200 | `data` keys `memberships`, `users` |
| `users.list` (`limit`) | 200 | array of 2 |
| `users.info` (`id`) | 200 | user object with `role` |
| `documents.import` (multipart: `collectionId`, `file`) | 200 | document object with `sourceMetadata`. **The REST route works. There is no MCP tool for it (see below).** |
| `documents.delete` (`id`) | 200 | cleanup |
| `collections.delete` (`id`) | 200 (first) / **400** (second) | the second failed because the collection still held documents the probe had not tracked (created through MCP and import). This is why the suite's cleanup must sweep by title prefix, not by tracked IDs. |

Error shape for an authorization failure (REST): HTTP **403**, `{ "ok": false, "status": 403, "error": "authorization_error", "message": "Authorization error" }`.

## Viewer (second identity, role `viewer`)

- REST `documents.list` with the restricted collection id: **403** `authorization_error`.
- REST `documents.create` into the restricted collection (`publish: true`): **403** `authorization_error`. The owner's view afterwards listed only the owner-created `P4L3 Probe Restricted Canary`. No viewer document was created.

## MCP: the Outline server

`initialize` returned 200 with no `mcp-session-id` header (the session is stateless for this server).

`tools/list` returned **20 tools**:

`create_attachment, list_collections, create_collection, update_collection, delete_collection, list_comments, create_comment, update_comment, delete_comment, list_documents, list_collection_documents, create_document, move_document, update_document, delete_document, restore_document, fetch, get_document_changes, list_templates, list_users`

- **There is no import tool.** `documents.import` exists on REST only. This decides INJ-011 (see the plan; it is not built).
- The plan's role names map to these: `documents_list` → `list_collection_documents`, `search` → `list_documents`, `documents_create` → `create_document`, `documents_move` → `move_document`, `documents_publish` → no separate publish tool; publishing goes through `create_document` or `update_document` with `publish: true`.

MCP error shapes (all HTTP 200 at the transport level, with the failure in the tool result):

| Situation | Reply |
|---|---|
| Schema validation failure | `isError: true`, text `Input validation error: Invalid arguments for tool <name>: <field>: Invalid input: expected <type>, received undefined` |
| Unknown id | `isError: true`, text `Collection doesn't exist with id: <id>` (update_collection) |
| Authorization (viewer) | `isError: true`, text `Authorization error` (list_documents, list_collection_documents, create_document, move_document, update_document, list_comments, create_comment, list_templates) |
| Owner success | `isError: false`, text is JSON in a string, for example `{"success":true,"id":"...","title":"...","url":"...","breadcrumb":"..."}` |

Observed text for `create_document` by the owner: `{"success":true,"id":"<uuid>","title":"P4L3 Probe MCP","url":"http://127.0.0.1:3011/doc/...","breadcrumb":"P4L3 Probe Public"}`.

Observed for the viewer on `list_users` and `list_comments`: list_users returned `[]` with `isError: false` (not an error); list_comments returned `Authorization error`.

## Oracle-relevant conclusions

1. Outline enforces the viewer's restriction on every document tool and on REST. The probe did not reproduce a leak or a write by the viewer. **No product bug was observed in this probe.** Nothing is marked as an expected defect.
2. OAUTH-013 needs a positive control: the viewer must be able to read the public collection, so an empty answer to the restricted query is not mistaken for a working filter. The probe at this commit does not yet show that; the next run adds it (`viewer MCP list_collection_documents (public, positive control)`) and prints the full viewer `list_collections` text.
3. The cleanup sweep must match `P4L3 ` titles across all collections and documents, because MCP and import create documents the suite does not track.

## Open items after this run

- The tool schemas (`inputSchema`) are needed for the committed snapshot `tests/l3/snapshots/outline.tools.json` and for the stub fixtures. The next run prints each tool as `[outline-probe-tool] {...}`.
- INJ-011: not built. The MCP surface has no import tool, so the case as written in the plan has nothing to attack. The owner should decide whether it becomes a `create_document` case instead.
