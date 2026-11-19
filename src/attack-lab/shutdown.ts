/** The few parts of `process` the shutdown handler uses, so a test can pass a fake. */
export interface ShutdownProcess {
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

export interface ShutdownOptions {
  proc?: ShutdownProcess;
  exit?: (code: number) => void;
  /** How long a close may take before the process gives up and exits 1. Default 5000. */
  timeoutMs?: number;
}

/**
 * On SIGTERM or SIGINT: run close(), then exit 0. If close() rejects or takes longer than timeoutMs, exit 1.
 * Only the first signal acts; later ones are ignored while the shutdown runs.
 */
export function installShutdown(close: () => Promise<void>, opts: ShutdownOptions = {}): void {
  const proc = opts.proc ?? process;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = opts.timeoutMs ?? 5000;
  let started = false;
  const handler = (): void => {
    if (started) return;
    started = true;
    const fallback = setTimeout(() => exit(1), timeoutMs);
    fallback.unref();
    close().then(
      () => {
        clearTimeout(fallback);
        exit(0);
      },
      () => {
        clearTimeout(fallback);
        exit(1);
      },
    );
  };
  proc.once("SIGTERM", handler);
  proc.once("SIGINT", handler);
}
