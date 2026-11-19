import { fail, pass, type Verdict } from "../oracles/verdict.js";
import { mentions } from "./librechat.js";

// P4-MCP-APPR-004 and P4-MCP-APPR-005. What a host must do with an elicitation from a server it does not control.
//
// Observed on LibreChat v0.8.9 (wave D probe, CI run 44590431418): the host declares no elicitation capability, so the lab
// answers "unsupported" and no request ever reaches the UI. There is no dialog to read. That is a deployment finding (the
// capability is absent), not a failure: the safety property, that nothing is auto-opened and nothing is posted, still holds
// and is checked separately. If a later LibreChat does show a dialog, the dialog must name the server and the full origin.

export interface ElicitationObservation {
  kind: "url" | "form";
  /** Text of every visible dialog, alert dialog or alert on the page after the tool ran. */
  dialogs: string[];
  /** Lab log event names, in order. */
  labEvents: string[];
  /** The server name the lab reports and the origin its elicitation points at (URL mode). */
  serverName: string;
  origin: string;
}

export interface ElicitationJudgement {
  verdict: Verdict;
  /** "dialog" when a dialog was shown and judged, "unsupported" when the host never presented one. */
  basis: "dialog" | "unsupported" | "unknown";
}

export function judgeElicitation(o: ElicitationObservation): ElicitationJudgement {
  if (o.dialogs.length > 0) {
    if (o.kind === "form") return { basis: "dialog", verdict: pass("a form dialog was shown (the case checks separately that nothing was filled or submitted)") };
    const text = o.dialogs.join("\n");
    const ok = mentions(text, o.serverName) && mentions(text, o.origin);
    return { basis: "dialog", verdict: ok ? pass("the dialog names the server and the full origin") : fail("the dialog does not show both the server name and the full origin") };
  }
  if (o.labEvents.includes("elicitation_unsupported")) {
    return { basis: "unsupported", verdict: pass(`deployment finding: the host declared no ${o.kind} elicitation capability, so no dialog exists to read (the lab logged elicitation_unsupported)`) };
  }
  return { basis: "unknown", verdict: fail("no dialog was shown and the lab did not record that the host lacks elicitation: what the host did with the request is unknown") };
}

/** True when the accessibility tree offers a text field for a password (a field named for it, or an input of that type). */
export function hasPasswordField(ariaTree: string): boolean {
  return /textbox "[^"]*password[^"]*"/i.test(ariaTree) || /\bpassword\b[^\n]*textbox/i.test(ariaTree);
}
