import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeGearRouteFocus,
  rememberGearRouteFocus,
  restorePendingGearRouteFocus,
} from "../apps/web/src/routes/library-record-focus.ts";

describe("library record route focus", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it("restores focus to the trigger replaced by a Library refresh", () => {
    const original = document.createElement("button");
    original.dataset.gearKind = "camera";
    original.dataset.recordRkey = "camera-1";
    document.body.append(original);

    rememberGearRouteFocus({ kind: "camera", rkey: "camera-1" });
    const restoreBeforeNavigation = consumeGearRouteFocus("camera", "camera-1");
    restoreBeforeNavigation?.();
    expect(document.activeElement).toBe(original);

    const refreshed = original.cloneNode() as HTMLButtonElement;
    original.replaceWith(refreshed);
    restorePendingGearRouteFocus();

    expect(document.activeElement).toBe(refreshed);
  });
});
