import { BOT_USERNAME, type AttachmentSpec, type InboundSpec, type LogEntry, type MockUser, type ReactionSpec, type SinkRecord } from "./types.js";

type Update = Record<string, unknown>;

function userObject(u: MockUser): Record<string, unknown> {
  return { id: u.id, is_bot: u.isBot === true, first_name: u.firstName, ...(u.username === undefined ? {} : { username: u.username }) };
}

function chatObject(chat: { id: number; type: "private" | "group" }, from: MockUser): Record<string, unknown> {
  return chat.type === "private"
    ? { id: chat.id, type: "private", first_name: from.firstName, ...(from.username === undefined ? {} : { username: from.username }) }
    : { id: chat.id, type: "group", title: `p4 group ${chat.id}` };
}

export interface StoredFile {
  path: string;
  mime: string;
  bytes: Buffer;
}

/** In-memory state of the mock channel. Nothing is persisted. */
export class MockChannelState {
  private seq = 0;
  private updateId: number;
  private messageId: number;

  /**
   * `idBase` makes update and message ids start above anything an earlier process handed out. A client that keeps its poll
   * offset (OpenClaw does, across restarts) would drop every update below it, so the container passes a time-based base.
   * Tests keep the default so a fixed sequence gives a byte-identical log.
   */
  constructor(idBase = 0) {
    this.updateId = 1000 + idBase;
    this.messageId = 5000 + idBase;
  }
  private queue: Update[] = [];
  private waiters: Array<() => void> = [];
  readonly log: LogEntry[] = [];
  readonly sink: SinkRecord[] = [];
  readonly pages = new Map<string, string>();
  readonly files = new Map<string, StoredFile>();
  /** value -> label. Held in memory only; never logged and never returned. */
  private watched = new Map<string, string>();

  /** getUpdates calls seen since the process started, and when the last one arrived. Not cleared by reset: it describes the poller. */
  polls = 0;
  /** getUpdates calls in flight right now. A connected poller keeps this at 1 while it waits. */
  pollsInFlight = 0;

  nextSeq(): number {
    return ++this.seq;
  }

  nextMessageId(): number {
    return ++this.messageId;
  }

  record(entry: Omit<LogEntry, "seq">): LogEntry {
    const row: LogEntry = { seq: this.nextSeq(), ...entry };
    this.log.push(row);
    return row;
  }

  private push(update: Update): void {
    this.queue.push(update);
    const waiting = this.waiters.splice(0);
    for (const wake of waiting) wake();
  }

  private attachmentFields(spec: AttachmentSpec, messageId: number): Record<string, unknown> {
    const fileId = `p4file-${messageId}-${spec.fileName}`;
    this.files.set(fileId, { path: `files/${fileId}`, mime: spec.mime, bytes: Buffer.from(spec.base64, "base64") });
    const size = Buffer.from(spec.base64, "base64").length;
    if (spec.kind === "photo") {
      return { photo: [{ file_id: fileId, file_unique_id: `u-${fileId}`, width: 64, height: 64, file_size: size }], ...(spec.caption === undefined ? {} : { caption: spec.caption }) };
    }
    return {
      document: { file_id: fileId, file_unique_id: `u-${fileId}`, file_name: spec.fileName, mime_type: spec.mime, file_size: size },
      ...(spec.caption === undefined ? {} : { caption: spec.caption }),
    };
  }

  /** Adds an inbound message update and returns its ids. */
  inject(spec: InboundSpec): { updateId: number; messageId: number } {
    const messageId = this.nextMessageId();
    const updateId = ++this.updateId;
    const entities: Array<Record<string, unknown>> = [];
    const text = spec.text;
    if (text !== undefined) {
      const mention = `@${BOT_USERNAME}`;
      const at = text.indexOf(mention);
      if (at >= 0) entities.push({ type: "mention", offset: at, length: mention.length });
      if (text.startsWith("/")) {
        const end = text.search(/\s/);
        entities.push({ type: "bot_command", offset: 0, length: end < 0 ? text.length : end });
      }
    }
    const message: Record<string, unknown> = {
      message_id: messageId,
      from: userObject(spec.from),
      chat: chatObject(spec.chat, spec.from),
      date: 1760000000 + messageId,
      ...(text === undefined ? {} : { text }),
      ...(entities.length === 0 ? {} : { entities }),
      ...(spec.replyToMessageId === undefined
        ? {}
        : { reply_to_message: { message_id: spec.replyToMessageId, from: userObject({ id: 9001, firstName: "p4-bot", isBot: true, username: BOT_USERNAME }), chat: chatObject(spec.chat, spec.from), date: 1760000000, text: "(earlier message)" } }),
      ...(spec.quote === undefined ? {} : { quote: { text: spec.quote.text, position: 0 } }),
      ...(spec.forwardFrom === undefined ? {} : { forward_origin: { type: "user", date: 1760000000, sender_user: userObject(spec.forwardFrom) } }),
    };
    for (const a of spec.attachments ?? []) Object.assign(message, this.attachmentFields(a, messageId));
    this.push({ update_id: updateId, message });
    this.record({ dir: "inbound", chatId: spec.chat.id, messageId, text: text ?? spec.attachments?.[0]?.caption ?? "", detail: `from ${spec.from.id}` });
    return { updateId, messageId };
  }

  injectReaction(spec: ReactionSpec): { updateId: number } {
    const updateId = ++this.updateId;
    this.push({
      update_id: updateId,
      message_reaction: {
        chat: chatObject({ id: spec.chatId, type: spec.chatId < 0 ? "group" : "private" }, spec.from),
        message_id: spec.messageId,
        user: userObject(spec.from),
        date: 1760000000,
        old_reaction: [],
        new_reaction: spec.emoji.map((emoji) => ({ type: "emoji", emoji })),
      },
    });
    this.record({ dir: "reaction", chatId: spec.chatId, messageId: spec.messageId, text: spec.emoji.join(""), detail: `from ${spec.from.id}` });
    return { updateId };
  }

  /** Injects an update exactly as given (malformed on purpose). It gets a fresh update id only when it has none. */
  injectRaw(update: unknown): { updateId: number } {
    const updateId = ++this.updateId;
    const obj: Record<string, unknown> = update !== null && typeof update === "object" && !Array.isArray(update) ? { ...(update as Record<string, unknown>) } : { raw: update };
    if (!("update_id" in obj)) obj["update_id"] = updateId;
    this.push(obj);
    this.record({ dir: "inbound", detail: "raw update" });
    return { updateId };
  }

  /** Long poll: updates with update_id >= offset (and drops older ones), or [] after timeoutMs. */
  async takeUpdates(offset: number, timeoutMs: number): Promise<Update[]> {
    const ready = (): Update[] => {
      if (offset > 0) this.queue = this.queue.filter((u) => typeof u["update_id"] !== "number" || (u["update_id"] as number) >= offset);
      return this.queue.slice();
    };
    const now = ready();
    if (now.length > 0 || timeoutMs <= 0) return now;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const at = this.waiters.indexOf(wake);
        if (at >= 0) this.waiters.splice(at, 1);
        resolve();
      }, timeoutMs);
      const wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push(wake);
    });
    return ready();
  }

  watch(values: Record<string, string>): void {
    for (const [label, value] of Object.entries(values)) {
      if (value.length >= 6) this.watched.set(value, label);
    }
  }

  matches(haystack: string): string[] {
    const out: string[] = [];
    for (const [value, label] of this.watched) if (haystack.includes(value) && !out.includes(label)) out.push(label);
    return out;
  }

  reset(): void {
    this.queue = [];
    for (const w of this.waiters.splice(0)) w();
    this.log.length = 0;
    this.sink.length = 0;
    this.pages.clear();
    this.files.clear();
    this.watched = new Map();
    this.seq = 0;
    // Ids keep counting up across resets so a late update from an earlier case can never collide with a new one.
  }
}
