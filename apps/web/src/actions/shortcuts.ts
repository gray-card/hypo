import { el, type DomChild, type OpenModalOptions, type OpenModalResult } from "@hypo/ui";

type OpenModal = (
  title: string,
  body: Iterable<DomChild>,
  onSave: (() => unknown | Promise<unknown>) | null,
  options?: OpenModalOptions,
) => OpenModalResult;

export const SHORTCUT_ROWS = [
  ["⌘/Ctrl K", "Command palette"],
  ["⌘/Ctrl S", "Save all (editor)"],
  ["/", "Focus search"],
  ["J / K", "Next / previous photo"],
  ["? ", "This help"],
  ["Esc", "Close dialog"],
] as const;

/** Render shortcut help through the app's shared modal service. */
export function createShortcutActions(services: { openModal: OpenModal }) {
  const openShortcuts = (): void => {
    services.openModal(
      "Keyboard shortcuts",
      [
        el(
          "div",
          {},
          SHORTCUT_ROWS.map(([key, description]) =>
            el("div", { class: "row between shortcut-row" }, [el("span", {}, description), el("kbd", {}, key)]),
          ),
        ),
      ],
      null,
      { hideSave: true, cancelLabel: "Close" },
    );
  };

  return { openShortcuts };
}
