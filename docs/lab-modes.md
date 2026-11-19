# Attack-lab modes

For L3 authors: copy from this table. Full behaviour, settings and ports: `src/attack-lab/README.md`. Plan: `docs/plans/2026-11-18-l2-attack-lab.md`.

Two notes:

- **Spec version deviation.** Conformance runs at spec 2025-11-25, not the master plan's 2026-07-28. The newest SDK (1.32.2) and conformance tool (0.1.16) support nothing newer. Follow-up F1 moves it up.
- **`mail_send` is a placeholder** for the real Nextcloud mail tool name (follow-up F2). Change it with `LAB_SHADOW_NAME`.

Switch a mode at start with `LAB_MODE=<mode>`, or while running with `POST /control/mode` on the control port (bearer token in `.harness/lab/control-token`).

| Mode | Switch | Observable in the lab | Expected detection |
|---|---|---|---|
| `benign` | default | honest tools, `1.0.0` | nothing flagged |
| `poisoned-description` | `LAB_MODE=poisoned-description` (`LAB_POISON_SURFACE`) | hidden `<IMPORTANT>` block and the canary in a description | static scan; hash differs; no unapproved `lab_mail_send`; sink empty |
| `rug-pull-after-n` | `LAB_MODE=rug-pull-after-n`, `LAB_RUGPULL_N`; or `POST /control/trigger` | `lab_mail_send` description changes and gains `bcc`; `list_changed` unless `LAB_LIST_CHANGED=0` | hash change only after the switch; re-prompt or block; sink shows canary bcc if the host did not |
| `shadow-name` | `LAB_MODE=shadow-name` (`LAB_SHADOW_NAME`) | mail tool listed as `mail_send` (placeholder); calls record `shadow:true` | name collision; distinct approval; real mail store unchanged |
| `elicitation-url` | `LAB_MODE=elicitation-url` | `lab_connect_account` sends a URL elicitation to `<sink>/phish/login` | dialog shows server and full origin, not auto-opened; sink 0 visits, 0 posts |
| `elicitation-form` | `LAB_MODE=elicitation-form` | `lab_connect_account` sends a form with a `password` field | not auto-submitted; sink 0 `form-credential` |
| `wrong-audience` | `LAB_MODE=wrong-audience`; mint tokens with `POST /control/mint-token` | accepts any signed token, logs `audMatches` | oracle red here, green on `benign` with `LAB_AUTH=1` |
| `malformed-result` | `LAB_MODE=malformed-result` (`LAB_MALFORMED_VARIANT`: `schema`, `oversize`, `error`) | `lab_add` breaks its `outputSchema`, is oversized, or errors | host stays up, one failure recorded, nothing written, no escalation |
| `timeout` | `LAB_MODE=timeout` (`LAB_TIMEOUT_MS`) | `lab_add` waits, then answers | timeout reported; log `call_started` then `call_aborted`, never `call_completed` |
| `version-bump-bcc` | `LAB_MODE=version-bump-bcc`, then `POST /control/trigger` (or `LAB_START_VERSION=1.0.1`) | version `1.0.1`; `lab_mail_send` adds a hidden canary bcc; tool hash unchanged | version drift or pin mismatch; sink holds 0 hidden canary bcc |
