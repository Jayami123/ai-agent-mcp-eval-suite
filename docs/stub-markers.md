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
- A marker that no placeholder uses anywhere in the fixture is a 400 (`var marker(s) not used by fixture ...`). A typo cannot pass
  silently. A marker used by any turn of the fixture is accepted on every turn: the stub checks the whole fixture, not each turn
  (`markersUnusedByFixture` in `src/stub/vars.ts`, introduced with the Penpot INJ-007 and FLOW-006 hostile legs).
- A fixture that is not valid JSON or has a bad placeholder fails to load (500 from the stub, with the reason).

The trace keeps the fixture as written (placeholders unresolved). The arguments the host receives are the substituted ones. This follows the `{{bind:NAME}}` mechanism in `src/stub/bindings.ts`, which records the same way.

`{{bind:NAME}}` (uppercase, from `PUT /__bindings`) is a separate mechanism with its own rules in `src/stub/bindings.ts`. A `{{bind:...}}` placeholder is left to that module when a fixture loads.

Example (`src/stub/fixtures/p4-mcp-meta-003-real.json`, argument `"account_id": "{{owner_account_id}}"`):

    [fixture:p4-mcp-meta-003-real] [var:owner_account_id=2] Send the note.

## When a suite uses `[var:]` and when it uses `{{bind:NAME}}`

Both carry run-time values into a fixture. They differ in where the value is set and how long it lasts.

- **`[var:<name>=<value>]` (per message).** The value rides in the user message of one chat. Use it for a value the case knows when it
  sends that message, for one fixture. Call sites:
  - `tests/l3/penpot/inj.cases.ts` (`[var:shape_id=<id>]`, the Penpot shape the owner's plugin created) and
    `tests/l3/penpot/flow.cases.ts` (`[var:shape_id=...]` and `[var:owner_account_id=...]`, sent in one message).
  - `tests/l3/nextcloud/mail.cases.ts` (`varMarker`, the owner's Mail account id). The account id is built from
    `tests/l3/support/nextcloud-mail.ts` (`ownerMailAccount`).
- **`{{bind:NAME}}` (per case, from `PUT /__bindings`).** The case sets a set of named values once, before the chat. The stub
  replaces its whole map on each PUT, and any turn of any fixture in the case may use the names. Use it for several ids that
  several fixtures or turns share. Call sites:
  - `tests/l3/support/nc-mail-seed.ts` (`setStubBindings` for the NCMAIL fixtures, one PUT per case).
  - `tests/l3/mattermost/inj.cases.ts` (`bindings: { MM_INJ009_PUBLIC, MM_INJ009_OPS }` and `MM_INJ010_DM`, `MM_INJ010_OTHER`).
  - `tests/l3/twenty/wave-b.common.ts` (`setStubBindings(bindings)`).

The Nextcloud mail suite uses both: the owner's account id is a `[var:]` marker in `mail.cases.ts`, and the run-time ids of the
injection fixtures are bindings in `tests/l3/nextcloud/mail-injection.cases.ts`. The comment at that file's top still says a var
marker "must be used by every turn of a fixture"; that is out of date, since the stub now checks the whole fixture (see Rules). The
case files are not changed here.

Code: `src/stub/vars.ts` and `src/stub/bindings.ts`. Tests: `tests/l1/stub-vars.test.ts`, `tests/l1/stub-vars-fixture.test.ts`,
`tests/l1/stub-bindings.test.ts`.
