export const PRELOAD_FAILURE_KEY = "hypo:last-preload-failure";

interface PreloadErrorEvent extends Event {
  payload?: unknown;
}

export interface PreloadRecoveryOptions {
  target: Window;
  storage: Storage;
  hasUnsavedChanges(): boolean;
  reload(): void;
  confirmReload(): boolean;
  notify(reload: () => void): void;
}

function failureIdentity(payload: unknown): string {
  if (payload instanceof Error) return payload.message || payload.name;
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(payload || "unknown preload failure");
}

function storedFailure(storage: Storage): { available: boolean; identity: string | null } {
  try {
    return { available: true, identity: storage.getItem(PRELOAD_FAILURE_KEY) };
  } catch {
    return { available: false, identity: null };
  }
}

function rememberFailure(storage: Storage, identity: string): boolean {
  try {
    storage.setItem(PRELOAD_FAILURE_KEY, identity);
    return true;
  } catch {
    // Without a durable per-tab marker, an automatic reload could loop.
    return false;
  }
}

/**
 * Recover from a deployment replacing a lazy Vite chunk.
 *
 * The event must remain unhandled: Vite interprets preventDefault() as a
 * successful replacement module and resolves the import to undefined. Leaving
 * the event alone preserves the rejected import while this coordinator either
 * reloads the current application shell or offers a safe manual reload.
 */
export function installPreloadRecovery(options: PreloadRecoveryOptions): () => void {
  let prompted = false;
  const onPreloadError = (event: Event): void => {
    const identity = failureIdentity((event as PreloadErrorEvent).payload);
    const hasUnsavedChanges = options.hasUnsavedChanges();

    // A hashed chunk URL identifies one deployment failure. Reload it once per
    // tab; if the same asset still fails after reloading, stop looping and let
    // the user decide when to retry.
    const previous = storedFailure(options.storage);
    if (!hasUnsavedChanges && previous.available && previous.identity !== identity) {
      if (rememberFailure(options.storage, identity)) {
        options.reload();
        return;
      }
    }

    if (prompted) return;
    prompted = true;
    options.notify(() => {
      if (!options.hasUnsavedChanges() || options.confirmReload()) options.reload();
    });
  };

  options.target.addEventListener("vite:preloadError", onPreloadError);
  return () => options.target.removeEventListener("vite:preloadError", onPreloadError);
}
