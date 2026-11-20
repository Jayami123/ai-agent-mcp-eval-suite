// Entry for the wave D mail probe (P4_L3_PROBE=1 only). Mail is on and every tool needs approval (mode default, no rules).
process.env["P4_MAIL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
if (process.env["P4_L3_PROBE"] === "1") await import("./mail.probe.js");
