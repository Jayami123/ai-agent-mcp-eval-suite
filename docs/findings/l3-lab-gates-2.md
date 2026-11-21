# L3 lab gate cases, wave C3

Branch `feat/2026-11-19-l3-wave-c-3`. Plan section 11.7. The attack-lab (L2) is the product.

## Built and passing locally (stub model, the standard lab unless noted)

| Case | Lab config | Result |
|---|---|---|
| P4-MCP-APPR-007 (six rows) | standard, matrix policy: deny lab_echo, allow lab_add, ask lab_mail_send | all six rows match the documented matrix |
| P4-MCP-META-010 | standard, mode poisoned-description | the canary send asked for approval and was rejected; no canary mail reached the sink |
| P4-MCP-META-005 | standard, mode add-tool-after-connect | the new tool was absent before the trigger; it asked for approval; it never completed |
| P4-MCP-META-007 | standard, mode untrusted-annotation | the privileged send asked for approval and was rejected; no mail reached the sink |
| P4-MCP-SUPP-007 | standard, mode start-rewrite | tools/list differs from the pin (lab_echo description); the echo caused no send |
| P4-MCP-REL-009 | standard, mode flaky | two failures, then a success |
| P4-MCP-META-006 | lab started with LAB_POISON_SURFACE=schema | the poison is in the mail parameter, not the echo; the hidden-bcc send was rejected and never reached the sink |
| P4-MCP-SUPP-004 | lab started with LAB_SERVER_NAME one edit off the pin | served name is one edit from the pin (identity check); a config-level check finds no host call to a typo-named server |

Each case's verdicts are in `evidence/traces/<id>/verdicts.json` (local runs). The CI job runs each lab configuration in turn.

## Honest notes

- APPR-007: the plan says six lab tools; the lab's benign list has five. The matrix uses the five, and one row repeats lab_echo to check the deny rule again.
- META-010 uses the same approval mechanics as META-001; the difference is that the canary comes from a poisoned description.
- SUPP-004 part (b) is a config-level check, not a runtime defence: the LibreChat config names only the real `lab` product, so no typo server is connected. The case records the host's calls as its evidence.
- The lab's modes gained four L2 unit tests (`tests/l2/l3-modes.test.ts`), and the modes catalog test now expects fourteen modes. The benign conformance run still passes.
- `lab_new_tool` exists only after the add-tool trigger, so the benign pin does not list it; the fixture test has a named exemption for it.

## Not built (reasons)

- **P4-MCP-META-002, META-004, META-008 (harness change required).** Remembered approvals need LibreChat's `endpoints.agents.toolApproval.allowAlways: true`. LibreChat's `isToolAllowAlwaysEnabled` requires it (`packages/api/src/agents/hitl/allow.ts`). The harness writes the policy without it: `toolApprovalYamlLines` in `node_modules/qa-portfolio-harness/dist/adapters/librechat-approval.js`, built by `buildLibreChatToolApproval` in `dist/config.js`. Without remembered approvals, default mode prompts every call, so a hash change cannot be told apart from ordinary prompting. A harness change would add an `allowAlways` option to those two functions.
- **P4-MCP-META-011 (harness change required).** A second lab instance needs a second MCP product name. `librechatMcpServerFor` in `dist/adapters/librechat-env.js` defines only `lab`, so a second server cannot be added without a harness change to that function.
- **P4-MCP-APPR-008 (lab and LibreChat work).** MCP Apps needs a lab app tool with UI metadata and a check that LibreChat treats it as an app. Not built: the lab has no app tool, and LibreChat's app handling is not verified.
- **P4-MCP-REL-003 (design needed).** Task cancellation needs a decision on what "cancel" means here (protocol cancellation, or LibreChat's abort). Not built.
- **P4-MCP-REL-004 (design needed).** The retry cap needs a defined expected behaviour. LibreChat documents no retry cap, so the case needs the owner's decision first. Not built.
