import { BOT_USERNAME } from "./types.js";
import type { MockChannelState } from "./state.js";

export type BotResult = { ok: true; result: unknown } | { ok: false; error_code: number; description: string };

const BOT = { id: 9001, is_bot: true, first_name: "p4-bot", username: BOT_USERNAME, can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false };

function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function chatOf(chatId: number): Record<string, unknown> {
  return chatId < 0 ? { id: chatId, type: "group", title: `p4 group ${chatId}` } : { id: chatId, type: "private", first_name: "p4" };
}

function sentMessage(state: MockChannelState, chatId: number, extra: Record<string, unknown>): Record<string, unknown> {
  return { message_id: state.nextMessageId(), from: BOT, chat: chatOf(chatId), date: 1760000000, ...extra };
}

/**
 * The Bot API methods the Telegram channel of OpenClaw 2026.10.33 calls (found by running it against this server). An unknown
 * method returns 404, is logged as "unknown-method", and fails the case that sees it.
 */
export async function handleBotMethod(state: MockChannelState, method: string, params: Record<string, unknown>): Promise<BotResult> {
  const chatId = num(params["chat_id"]);
  switch (method) {
    case "getMe":
      return { ok: true, result: BOT };
    case "deleteWebhook":
    case "setWebhook":
    case "setMyCommands":
    case "deleteMyCommands":
    case "setMyName":
    case "setMyDescription":
    case "setMyShortDescription":
    case "answerCallbackQuery":
    case "sendChatAction":
    case "pinChatMessage":
      return { ok: true, result: true };
    case "getMyCommands":
      return { ok: true, result: [] };
    case "getWebhookInfo":
      return { ok: true, result: { url: "", has_custom_certificate: false, pending_update_count: 0 } };
    case "getUpdates": {
      const timeout = Math.min(num(params["timeout"]) ?? 0, 25) * 1000;
      return { ok: true, result: await state.takeUpdates(num(params["offset"]) ?? 0, timeout) };
    }
    case "getChat":
      return { ok: true, result: chatOf(chatId ?? 0) };
    case "getChatMember":
      return { ok: true, result: { status: "member", user: { id: num(params["user_id"]) ?? 0, is_bot: false, first_name: "p4" } } };
    case "sendMessage":
    case "sendDocument":
    case "sendPhoto":
    case "sendSticker":
    case "sendVoice":
    case "sendAudio":
    case "sendVideo": {
      if (chatId === undefined) return { ok: false, error_code: 400, description: "Bad Request: chat_id is required" };
      const text = str(params["text"]) ?? str(params["caption"]);
      const message = sentMessage(state, chatId, { ...(text === undefined ? {} : { text }) });
      const reply = params["reply_parameters"] as { message_id?: unknown } | undefined;
      state.record({
        dir: "outbound",
        method,
        chatId,
        messageId: message["message_id"] as number,
        ...(text === undefined ? {} : { text }),
        ...(str(params["fileName"]) === undefined ? {} : { fileName: str(params["fileName"]) as string }),
        ...(num(params["reply_to_message_id"]) !== undefined || num(reply?.message_id) !== undefined ? { replyTo: (num(params["reply_to_message_id"]) ?? num(reply?.message_id)) as number } : {}),
        ...(params["reply_markup"] === undefined ? {} : { detail: `reply_markup ${JSON.stringify(params["reply_markup"]).slice(0, 400)}` }),
      });
      return { ok: true, result: message };
    }
    case "editMessageText": {
      const text = str(params["text"]) ?? "";
      state.record({ dir: "outbound", method, ...(chatId === undefined ? {} : { chatId }), ...(num(params["message_id"]) === undefined ? {} : { messageId: num(params["message_id"]) as number }), text });
      return { ok: true, result: sentMessage(state, chatId ?? 0, { text }) };
    }
    case "deleteMessage":
    case "setMessageReaction":
      state.record({ dir: "outbound", method, ...(chatId === undefined ? {} : { chatId }), ...(num(params["message_id"]) === undefined ? {} : { messageId: num(params["message_id"]) as number }) });
      return { ok: true, result: true };
    case "getFile": {
      const fileId = str(params["file_id"]) ?? "";
      const f = state.files.get(fileId);
      return f === undefined ? { ok: false, error_code: 400, description: "Bad Request: file not found" } : { ok: true, result: { file_id: fileId, file_unique_id: `u-${fileId}`, file_size: f.bytes.length, file_path: f.path } };
    }
    default:
      state.record({ dir: "unknown-method", method });
      return { ok: false, error_code: 404, description: `p4 mock: method not implemented: ${method}` };
  }
}
