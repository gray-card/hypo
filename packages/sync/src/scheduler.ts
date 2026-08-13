import type { FlushResult, Outbox } from "./outbox.ts";

interface ListenerTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface VisibilityTarget extends ListenerTarget {
  readonly visibilityState?: string;
}

export interface SchedulerOptions {
  intervalMs?: number;
  onlineTarget?: ListenerTarget | null;
  visibilityTarget?: VisibilityTarget | null;
  setInterval?: (callback: () => void, milliseconds: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  onError?: (error: unknown) => void;
  onFlushed?: (result: FlushResult) => void | Promise<void>;
  flushOnStart?: boolean;
}

/** Installs the four outbox-v2 flush triggers and returns an idempotent disposer. */
export function installFlushScheduler(outbox: Outbox, options: SchedulerOptions = {}): () => void {
  const onlineTarget =
    options.onlineTarget === undefined ? (typeof window === "undefined" ? null : window) : options.onlineTarget;
  const visibilityTarget =
    options.visibilityTarget === undefined
      ? typeof document === "undefined"
        ? null
        : document
      : options.visibilityTarget;
  const scheduleInterval =
    options.setInterval ?? ((callback, milliseconds) => globalThis.setInterval(callback, milliseconds));
  const cancelInterval =
    options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));
  let disposed = false;
  let running: Promise<unknown> | undefined;
  let rerunRequested = false;

  const run = (): void => {
    if (disposed || !outbox.isOnline()) return;
    if (running) {
      rerunRequested = true;
      return;
    }
    running = outbox
      .flush()
      .then((result) => options.onFlushed?.(result))
      .catch((error) => options.onError?.(error))
      .finally(() => {
        running = undefined;
        if (rerunRequested) {
          rerunRequested = false;
          run();
        }
      });
  };
  const onVisible = (): void => {
    if (!visibilityTarget || visibilityTarget.visibilityState === "visible") run();
  };

  onlineTarget?.addEventListener("online", run);
  visibilityTarget?.addEventListener("visibilitychange", onVisible);
  const unsubscribe = outbox.subscribeEnqueue(run);
  const interval = scheduleInterval(run, options.intervalMs ?? 30_000);
  if (options.flushOnStart !== false) run();

  return () => {
    if (disposed) return;
    disposed = true;
    onlineTarget?.removeEventListener("online", run);
    visibilityTarget?.removeEventListener("visibilitychange", onVisible);
    unsubscribe();
    cancelInterval(interval);
  };
}
