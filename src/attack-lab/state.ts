import type { LabConfig, LabMode } from "./modes.js";

export interface LabLogEntry {
  seq: number;
  event: string;
  /** Never holds a secret, a token, a password or a message body. */
  detail: Record<string, string | number | boolean>;
}

export class NoTriggerError extends Error {}

/** The version a bumped version-bump-bcc server reports. */
export const BUMPED_VERSION = "1.0.1";

export interface LabUrls {
  resource: string;
  issuer: string;
  publicSink: string;
}

export class LabState {
  mode: LabMode;
  /** Rug-pull flipped, or the version was bumped. */
  triggered = false;
  successfulCalls = 0;
  readonly log: LabLogEntry[] = [];
  urls: LabUrls = { resource: "", issuer: "", publicSink: "" };
  /** Set by the server: tells open sessions that the tool list may have changed. */
  onToolsChanged: (() => void) | undefined;

  constructor(readonly config: LabConfig) {
    this.mode = config.mode;
    this.triggered = this.initialTriggered(config.mode);
  }

  /** rug-pull with N=0 is changed from the start; version-bump-bcc starts bumped when LAB_START_VERSION is the bumped version. */
  private initialTriggered(mode: LabMode): boolean {
    if (mode === "rug-pull-after-n") return this.config.rugPullN === 0;
    if (mode === "version-bump-bcc") return this.config.startVersion === BUMPED_VERSION;
    return false;
  }

  get version(): string {
    if (this.mode === "version-bump-bcc" && this.triggered) return BUMPED_VERSION;
    return this.config.startVersion;
  }

  setMode(mode: LabMode): void {
    this.mode = mode;
    this.triggered = this.initialTriggered(mode);
    this.successfulCalls = 0;
    this.record("mode_set", { mode });
    this.notifyToolsChanged();
  }

  trigger(): void {
    if (this.mode !== "rug-pull-after-n" && this.mode !== "version-bump-bcc") {
      throw new NoTriggerError(`mode ${this.mode} has no trigger`);
    }
    this.triggered = true;
    this.record("triggered", { mode: this.mode });
    if (this.mode === "rug-pull-after-n") this.notifyToolsChanged();
  }

  /** Counts one successful call. Returns true when this call flipped the rug-pull. */
  noteSuccess(): boolean {
    this.successfulCalls += 1;
    if (this.mode === "rug-pull-after-n" && !this.triggered && this.successfulCalls >= this.config.rugPullN) {
      this.triggered = true;
      this.record("rug_pull", { after: this.successfulCalls });
      this.notifyToolsChanged();
      return true;
    }
    return false;
  }

  record(event: string, detail: LabLogEntry["detail"] = {}): void {
    this.log.push({ seq: this.log.length + 1, event, detail });
  }

  reset(): void {
    this.mode = this.config.mode;
    this.triggered = this.initialTriggered(this.config.mode);
    this.successfulCalls = 0;
    this.log.length = 0;
  }

  /** Sent after the current request, and only when LAB_LIST_CHANGED is on. */
  private notifyToolsChanged(): void {
    if (!this.config.listChanged) return;
    const hook = this.onToolsChanged;
    if (hook !== undefined) setImmediate(hook);
  }
}
