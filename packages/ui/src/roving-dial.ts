import { el } from "./element.ts";

export interface RovingDialOptions<Value extends string> {
  className?: string;
  buttonClassName?: string;
  label?: string;
  valueText?: (value: Value) => string;
}

/** Keep a native range/spinbutton's spoken value synchronized with its current value. */
export function bindValueText(
  control: HTMLInputElement,
  valueText: (value: string, control: HTMLInputElement) => string,
): () => void {
  const sync = () => control.setAttribute("aria-valuetext", valueText(control.value, control));
  control.addEventListener("input", sync);
  sync();
  return sync;
}

/** Build a keyboard-operable dial with a roving tabindex and pressed state. */
export function createRovingDial<Value extends string>(
  values: readonly Value[],
  get: () => Value | null,
  set: (value: Value) => void,
  {
    className = "dial-row",
    buttonClassName = "dial-btn",
    label = "Value",
    valueText = String,
  }: RovingDialOptions<Value> = {},
): HTMLDivElement {
  const row = el("div", { class: className, role: "toolbar", "aria-label": label });
  const paint = () => {
    let hasSelected = false;
    let selectedValue: Value | null = null;
    for (const child of row.children) {
      const button = child as HTMLButtonElement;
      const selected = button.dataset.val === String(get());
      hasSelected ||= selected;
      if (selected) selectedValue = button.dataset.val as Value;
      button.classList.toggle("on", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    if (!hasSelected && row.firstElementChild) (row.firstElementChild as HTMLElement).tabIndex = 0;
    row.setAttribute("aria-label", selectedValue == null ? label : `${label}: ${valueText(selectedValue)}`);
  };
  const selectAt = (index: number) => {
    const button = row.children[Math.max(0, Math.min(values.length - 1, index))] as HTMLButtonElement | undefined;
    if (!button) return;
    set(button.dataset.val as Value);
    paint();
    button.focus();
  };
  for (const [index, value] of values.entries()) {
    const button = el(
      "button",
      { class: buttonClassName, type: "button", "aria-label": `${label}: ${valueText(value)}` },
      String(value),
    );
    button.dataset.val = String(value);
    button.addEventListener("click", () => {
      set(value);
      paint();
    });
    button.addEventListener("keydown", (event) => {
      let target: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") target = (index + 1) % values.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
        target = (index - 1 + values.length) % values.length;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = values.length - 1;
      if (target === null) return;
      event.preventDefault();
      selectAt(target);
    });
    row.append(button);
  }
  paint();
  return row;
}
