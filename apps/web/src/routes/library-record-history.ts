export type LibraryRecordTarget = { type: "roll"; rkey: string } | { type: "gear"; kind: string; rkey: string };

type LibraryTab = "cameras" | "lenses" | "filters" | "film" | "darkroom" | "scanning";

interface Route {
  name: string;
  params: Readonly<Record<string, string | undefined>>;
}

interface Router {
  current(): Route;
  navigate(name: string, params?: Record<string, string>, state?: unknown): unknown;
  replace(name: string, params?: Record<string, string>, state?: unknown): unknown;
}

interface History {
  readonly state: unknown;
  back(): void;
}

const DARKROOM_KINDS = new Set(["chemistry", "enlarger", "enlargingLens", "lightSource", "printer"]);
const SCANNING_KINDS = new Set(["scanner", "storageLocation", "labAccount"]);

export function libraryTabForRecord(target: LibraryRecordTarget): LibraryTab {
  if (target.type === "roll" || target.kind === "filmRoll" || target.kind === "filmStockpile") return "film";
  if (target.kind === "lens") return "lenses";
  if (target.kind === "filter") return "filters";
  if (DARKROOM_KINDS.has(target.kind)) return "darkroom";
  if (SCANNING_KINDS.has(target.kind)) return "scanning";
  return "cameras";
}

function routeMatches(route: Route, target: LibraryRecordTarget): boolean {
  if (target.type === "roll") return route.name === "roll" && route.params.rkey === target.rkey;
  return route.name === "gear" && route.params.kind === target.kind && route.params.rkey === target.rkey;
}

export function createLibraryRecordHistory({ router, history }: { router: Router; history: History }) {
  return {
    navigateRecordRoute(target: LibraryRecordTarget): unknown {
      if (target.type === "roll") {
        return router.navigate("roll", { rkey: target.rkey }, { libraryRecordModal: true });
      }
      return router.navigate("gear", { kind: target.kind, rkey: target.rkey }, { libraryRecordModal: true });
    },
    closeRecordRoute(target: LibraryRecordTarget): unknown {
      if (!routeMatches(router.current(), target)) return undefined;
      const state = history.state as { libraryRecordModal?: unknown } | null;
      if (state?.libraryRecordModal === true) return history.back();
      return router.replace("library", { tab: libraryTabForRecord(target) });
    },
  };
}
