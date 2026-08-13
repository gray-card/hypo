import type { Panproto } from "@panproto/core";

export type PanprotoEngine = Panproto;
export type PanprotoEngineLoader = () => Promise<PanprotoEngine>;

let enginePromise: Promise<PanprotoEngine> | undefined;

/** Load the WASM runtime only when a record needs a schema migration. */
export function loadPanproto(): Promise<PanprotoEngine> {
  enginePromise ??= import("@panproto/core").then(({ Panproto }) => Panproto.init());
  return enginePromise;
}

/** Test hook; application code should keep the shared lazy engine. */
export function resetPanprotoForTests(): void {
  enginePromise = undefined;
}
