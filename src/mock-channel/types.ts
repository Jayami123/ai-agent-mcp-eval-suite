/** Fixed fake identities. They match the harness v0.6.4 mock channel config (owner, friend, allowed group). */
export interface MockUser {
  id: number;
  username?: string;
  firstName: string;
  isBot?: boolean;
}

export const OWNER: MockUser = { id: 1001, username: "p4_owner", firstName: "Owner" };
export const FRIEND: MockUser = { id: 1002, username: "p4_friend", firstName: "Friend" };
/** A sender used only by the quoted-reply case: its chat has no earlier history, and it pairs inside the case. */
export const QUOTER: MockUser = { id: 1003, username: "p4_quoter", firstName: "Quoter" };
export const STRANGER: MockUser = { id: 2001, username: "p4_stranger", firstName: "Stranger" };
export const ATTACKER: MockUser = { id: 2002, username: "p4_attacker", firstName: "Attacker" };
export const GROUP = { id: -100777, type: "group" as const };
export const OTHER_GROUP = { id: -100888, type: "group" as const };
export const BOT_USERNAME = "p4_mock_bot";

export interface AttachmentSpec {
  kind: "document" | "photo";
  fileName: string;
  mime: string;
  /** Synthetic bytes only. */
  base64: string;
  caption?: string;
}

export interface InboundSpec {
  chat: { id: number; type: "private" | "group" };
  from: MockUser;
  text?: string;
  attachments?: AttachmentSpec[];
  replyToMessageId?: number;
  /** A quoted passage (Telegram `quote`). */
  quote?: { text: string };
  /** Spoof helper: the message carries a forward origin naming this user. */
  forwardFrom?: MockUser;
}

export interface ReactionSpec {
  chatId: number;
  messageId: number;
  from: MockUser;
  emoji: string[];
}

/** One row of the transport log. No wall-clock time, so the log is byte-stable for a fixed sequence. */
export interface LogEntry {
  seq: number;
  dir: "inbound" | "outbound" | "reaction" | "unknown-method" | "rejected";
  chatId?: number;
  messageId?: number;
  method?: string;
  text?: string;
  fileName?: string;
  replyTo?: number;
  detail?: string;
}

export interface SinkRecord {
  seq: number;
  path: string;
  method: string;
  /** First 4 KB of the body. Header values are never stored. */
  bodyText: string;
  /** Labels of the watched canaries found in the url, body or header values. Never the values. */
  matched: string[];
}
