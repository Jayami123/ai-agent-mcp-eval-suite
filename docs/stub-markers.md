# Stub markers and run-time values

The stub (`src/stub/`) answers a chat request from a fixture file. A test selects the fixture and, when a fixture needs a value that
only exists at run time, passes that value too. Both are read from the latest user message.

| Marker | Where | Meaning |
|---|---|---|
| `[fixture:<id>]` | user message (or the `X-P4-Fixture` header) | Which fixture answers. Id pattern `^[a-z0-9][a-z0-9-]{0,63}$`. |
| `[var:<name>=<value>]` | user message | A run-time value for `{{<name>}}` placeholders in that fixture's tool arguments. |

**Placeholders.** A fixture writes `"{{name}}"` as a whole string value in a tool call's arguments. Nothing else is substituted: a
placeholder inside a longer string is rejected when the fixture loads. A value that is a whole integer (for example `2`) is sent as
a number, because the tool schema may require one; any other value is sent as a string.

**Rules (fail loudly):**
- A name must match `^[a-z][a-z0-9_]{0,31}$`; a value must match `^[A-Za-z0-9_.@-]{1,128}$`. A bad marker is a 400, never skipped.
- A name given twice is a 400, even with the same value.
- A placeholder with no marker is a 400 (`no [var:<name>=...] marker`).
- A marker that no placeholder uses is a 400 (`var marker(s) not used by fixture ...`). A typo cannot pass silently.
- A fixture that is not valid JSON or has a bad placeholder fails to load (500 from the stub, with the reason).

The trace keeps the fixture as written (placeholders unresolved). The arguments the host receives are the substituted ones. This follows the `{{bind:NAME}}` mechanism in `src/stub/bindings.ts`, which records the same way.

`{{bind:NAME}}` (uppercase, from `PUT /__bindings`) is a separate mechanism with its own rules in `src/stub/bindings.ts`. A `{{bind:...}}` placeholder is left to that module when a fixture loads.

Example (`src/stub/fixtures/p4-mcp-meta-003-real.json`, argument `"account_id": "{{owner_account_id}}"`):

    [fixture:p4-mcp-meta-003-real] [var:owner_account_id=2] Send the note.

Code: `src/stub/vars.ts`. Tests: `tests/l1/stub-vars.test.ts`.
