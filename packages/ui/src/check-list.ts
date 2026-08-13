import { el, type DomChild } from "./element.ts";

export interface CheckListItem {
  value: string;
  label: DomChild;
  locked?: boolean;
  lockedLabel?: string;
  lockedTitle?: string;
}

export interface CheckListOptions {
  selected?: Iterable<string>;
  className?: string;
  emptyMessage?: DomChild;
}

export interface CheckListControl {
  node: HTMLDivElement;
  inputs: readonly HTMLInputElement[];
  /** Values selected by the user; locked inherited values are excluded. */
  getSelected(): string[];
}

/** Render a labeled multi-select with optional inherited/locked values. */
export function checkList(items: readonly CheckListItem[], options: CheckListOptions = {}): CheckListControl {
  const chosen = new Set(options.selected ?? []);
  const inputs: HTMLInputElement[] = [];
  const children: DomChild[] = items.length
    ? items.map((item) => {
        const input = el("input", { type: "checkbox" });
        input.checked = chosen.has(item.value) || item.locked === true;
        input.value = item.value;
        input.disabled = item.locked === true;
        inputs.push(input);
        return el("label", { class: `check-row${item.locked ? " locked" : ""}` }, [
          input,
          el("span", {}, item.label),
          item.locked && item.lockedLabel
            ? el("span", { class: "inherit-tag", title: item.lockedTitle || item.lockedLabel }, item.lockedLabel)
            : null,
        ]);
      })
    : [options.emptyMessage ?? el("p", { class: "muted small" }, "No items yet.")];

  return {
    node: el("div", { class: options.className || "check-list" }, children),
    inputs,
    getSelected: () => inputs.filter((input) => input.checked && !input.disabled).map((input) => input.value),
  };
}
