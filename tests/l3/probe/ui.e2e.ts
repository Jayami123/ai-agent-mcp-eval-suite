// Entry for the wave D UI probe (P4_L3_PROBE=1 only). The lab is started in elicitation-url mode with a look-alike title
// (see the CI job). Every tool needs approval (mode default, no rules), so the approval card is on screen.
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
if (process.env["P4_L3_PROBE"] === "1") await import("./ui.probe.js");
