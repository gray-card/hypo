import { afterEach, describe, expect, it, vi } from "vitest";
import { installPreloadRecovery, PRELOAD_FAILURE_KEY } from "../apps/web/src/preload-recovery";

function preloadError(message: string): Event {
  const event = new Event("vite:preloadError", { cancelable: true }) as Event & { payload?: unknown };
  event.payload = new Error(message);
  return event;
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("stale Vite chunk recovery", () => {
  it("reloads a new failed chunk once without canceling the import error", () => {
    const reload = vi.fn();
    const notify = vi.fn();
    const dispose = installPreloadRecovery({
      target: window,
      storage: sessionStorage,
      hasUnsavedChanges: () => false,
      reload,
      confirmReload: () => true,
      notify,
    });
    const event = preloadError("Failed to import /assets/vision-old.js");

    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(sessionStorage.getItem(PRELOAD_FAILURE_KEY)).toContain("vision-old.js");
    dispose();
  });

  it("does not loop when the same missing chunk fails after reloading", () => {
    sessionStorage.setItem(PRELOAD_FAILURE_KEY, "Failed to import /assets/vision-old.js");
    const reload = vi.fn();
    const notify = vi.fn();
    const dispose = installPreloadRecovery({
      target: window,
      storage: sessionStorage,
      hasUnsavedChanges: () => false,
      reload,
      confirmReload: () => true,
      notify,
    });

    window.dispatchEvent(preloadError("Failed to import /assets/vision-old.js"));

    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    dispose();
  });

  it("protects unsaved edits and reloads only after confirmation", () => {
    let unsaved = true;
    const reload = vi.fn();
    const confirmReload = vi.fn(() => false);
    let reloadAction: (() => void) | undefined;
    const dispose = installPreloadRecovery({
      target: window,
      storage: sessionStorage,
      hasUnsavedChanges: () => unsaved,
      reload,
      confirmReload,
      notify: (action) => {
        reloadAction = action;
      },
    });

    window.dispatchEvent(preloadError("Failed to import /assets/vision-old.js"));
    expect(reload).not.toHaveBeenCalled();

    reloadAction?.();
    expect(confirmReload).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();

    unsaved = false;
    reloadAction?.();
    expect(reload).toHaveBeenCalledOnce();
    dispose();
  });

  it("offers a manual reload instead of looping when session storage is unavailable", () => {
    const reload = vi.fn();
    const notify = vi.fn();
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    } as unknown as Storage;
    const dispose = installPreloadRecovery({
      target: window,
      storage,
      hasUnsavedChanges: () => false,
      reload,
      confirmReload: () => true,
      notify,
    });

    window.dispatchEvent(preloadError("Failed to import /assets/vision-new.js"));

    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    dispose();
  });
});
