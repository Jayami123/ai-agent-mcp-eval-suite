// The approval policy for the Mattermost stack entries (run.e2e.ts and measured.e2e.ts). Set before the stack starts: writes
// pause and the injection cases reject them. The read tools the cases use are allowed so their controls run without a prompt.
// Unlisted tools pause (default mode).
process.env["LIBRECHAT_TOOL_APPROVAL"] = "1";
process.env["LIBRECHAT_TOOL_APPROVAL_MODE"] = "default";
process.env["LIBRECHAT_TOOL_APPROVAL_ASK"] = "mcp:mattermost:create_post,mcp:mattermost:dm";
process.env["LIBRECHAT_TOOL_APPROVAL_ALLOW"] = "mcp:mattermost:read_channel,mcp:mattermost:get_channel_info";
