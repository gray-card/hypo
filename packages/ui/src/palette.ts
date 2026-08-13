import { el, type DomChild } from "./element.ts";

export interface PaletteCommand {
  label: string;
  hint?: string;
  icon?: DomChild;
  run(): void;
}

export type PaletteProvider = (query: string) => readonly PaletteCommand[];

export interface CommandPalette {
  close(): void;
}

/** Open an accessible, keyboard-driven command palette. */
export function openCommandPalette(commands: PaletteProvider): CommandPalette {
  const previousFocus = document.activeElement as HTMLElement | null;
  const overlay = el("div", { class: "modal-overlay palette-overlay" });
  const box = el("div", {
    class: "palette",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Command palette",
  });
  const input = el("input", {
    class: "palette-input",
    type: "text",
    placeholder: "Type a command, gallery, or @handle…",
    autocomplete: "off",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-controls": "command-palette-list",
    "aria-expanded": "true",
  });
  const list = el("div", { id: "command-palette-list", class: "palette-list", role: "listbox" });
  let items: readonly PaletteCommand[] = [];
  let index = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    previousFocus?.focus?.();
  };
  const run = (command: PaletteCommand) => {
    close();
    command.run();
  };
  const render = () => {
    items = commands(input.value.trim().toLowerCase());
    if (index >= items.length) index = Math.max(0, items.length - 1);
    input.setAttribute("aria-activedescendant", items.length ? `command-palette-option-${index}` : "");
    list.replaceChildren(
      ...items.map((command, itemIndex) =>
        el(
          "div",
          {
            id: `command-palette-option-${itemIndex}`,
            class: `palette-item${itemIndex === index ? " active" : ""}`,
            role: "option",
            "aria-selected": String(itemIndex === index),
            onmousedown: (event: MouseEvent) => {
              event.preventDefault();
              run(command);
            },
          },
          [
            command.icon,
            el("span", { class: "palette-label" }, command.label),
            command.hint ? el("span", { class: "palette-hint muted small" }, command.hint) : null,
          ],
        ),
      ),
    );
  };
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      index = Math.min(index + 1, items.length - 1);
      render();
      list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = Math.max(index - 1, 0);
      render();
      list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Home") {
      event.preventDefault();
      index = 0;
      render();
    } else if (event.key === "End") {
      event.preventDefault();
      index = Math.max(0, items.length - 1);
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (items[index]) run(items[index]);
    }
  }

  input.addEventListener("input", () => {
    index = 0;
    render();
  });
  box.append(input, list);
  overlay.append(box);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  render();
  input.focus();
  return { close };
}
