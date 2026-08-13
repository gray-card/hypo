import { describe, expect, it, vi } from "vitest";
import {
  createLibraryRecordHistory,
  libraryTabForRecord,
  type LibraryRecordTarget,
} from "../apps/web/src/routes/library-record-history.ts";

function harness(route: { name: string; params: Record<string, string> }, state: unknown = null) {
  const router = {
    current: vi.fn(() => route),
    navigate: vi.fn(),
    replace: vi.fn(),
  };
  const history = { state, back: vi.fn() };
  return { history, router, routes: createLibraryRecordHistory({ router, history }) };
}

describe("Library record history", () => {
  it.each<[LibraryRecordTarget, string]>([
    [{ type: "roll", rkey: "r" }, "film"],
    [{ type: "gear", kind: "lens", rkey: "l" }, "lenses"],
    [{ type: "gear", kind: "chemistry", rkey: "c" }, "darkroom"],
    [{ type: "gear", kind: "scanner", rkey: "s" }, "scanning"],
  ])("maps $type records to their underlying Library tab", (target, tab) => {
    expect(libraryTabForRecord(target)).toBe(tab);
  });

  it("pushes a marked modal route so closing can return with Back", () => {
    const target = { type: "gear", kind: "camera", rkey: "body 1" } as const;
    const { router, routes } = harness({ name: "library", params: { tab: "cameras" } });

    routes.navigateRecordRoute(target);

    expect(router.navigate).toHaveBeenCalledWith(
      "gear",
      { kind: "camera", rkey: "body 1" },
      { libraryRecordModal: true },
    );
  });

  it("uses Back for UI-pushed modals and replaces cold deep links with their Library context", () => {
    const target = { type: "roll", rkey: "roll-1" } as const;
    const pushed = harness({ name: "roll", params: { rkey: "roll-1" } }, { libraryRecordModal: true });
    pushed.routes.closeRecordRoute(target);
    expect(pushed.history.back).toHaveBeenCalledOnce();
    expect(pushed.router.replace).not.toHaveBeenCalled();

    const cold = harness({ name: "roll", params: { rkey: "roll-1" } });
    cold.routes.closeRecordRoute(target);
    expect(cold.router.replace).toHaveBeenCalledWith("library", { tab: "film" });
  });

  it("ignores a stale modal close after history has moved to another record", () => {
    const { history, router, routes } = harness(
      { name: "gear", params: { kind: "camera", rkey: "body-2" } },
      { libraryRecordModal: true },
    );
    routes.closeRecordRoute({ type: "gear", kind: "camera", rkey: "body-1" });
    expect(history.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
