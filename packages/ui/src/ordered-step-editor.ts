import { el } from "./element.ts";

export interface OrderedStepOption {
  readonly kind: string;
  readonly label: string;
}

export interface OrderedStepEditorOptions<Item> {
  readonly items?: readonly Item[];
  readonly options: readonly OrderedStepOption[];
  readonly getKind: (item: Item) => string;
  readonly clone: (item: Item) => Item;
  readonly create: (kind: string) => Item;
  readonly configured?: (item: Item) => boolean;
  readonly summary?: (item: Item) => string | undefined;
  readonly onConfigure?: (item: Item, index: number, replace: (item: Item) => void) => void;
  readonly onChange?: (items: readonly Item[]) => void;
  readonly label?: string;
  readonly emptyText?: string;
}

export interface OrderedStepEditor<Item> {
  readonly node: HTMLDivElement;
  readonly status: HTMLParagraphElement;
  getItems(): Item[];
  replace(items: readonly Item[], message?: string): void;
  add(kind: string): void;
}

/**
 * A compact, keyboard-operable sequence editor shared by template and run builders.
 * It deliberately owns only ordering and occurrence-level controls; callers own the
 * domain-specific configuration form and persistence adapter.
 */
export function createOrderedStepEditor<Item>(options: OrderedStepEditorOptions<Item>): OrderedStepEditor<Item> {
  const items = [...(options.items || [])];
  const label = options.label || "Workflow steps";
  const optionLabel = (kind: string): string => options.options.find((option) => option.kind === kind)?.label || kind;
  const list = el("ol", { class: "workflow-steps", "aria-label": `${label} in order` });
  const status = el("p", {
    class: "status workflow-step-status",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  const picker = el(
    "select",
    { class: "workflow-step-select", "aria-label": `Stage to add to ${label.toLowerCase()}` },
    options.options.map((option) => el("option", { value: option.kind }, option.label)),
  );

  const announce = (message: string): void => {
    status.className = "status workflow-step-status ok";
    status.textContent = message;
  };

  const changed = (): void => options.onChange?.([...items]);

  function render(): void {
    list.replaceChildren();
    if (!items.length) {
      list.append(el("li", { class: "workflow-step-empty muted" }, options.emptyText || "No steps yet."));
      return;
    }
    items.forEach((item, index) => {
      const kind = options.getKind(item);
      const itemLabel = optionLabel(kind);
      const detail = options.summary?.(item);
      const marker = el("span", { class: "workflow-step-number", "aria-hidden": "true" }, String(index + 1));
      const identity = el("div", { class: "workflow-step-identity" }, [
        el("div", { class: "workflow-step-title" }, [
          el("strong", {}, itemLabel),
          el(
            "span",
            { class: `step-badge ${options.configured?.(item) ? "ok" : "muted"}` },
            options.configured?.(item) ? "configured" : "defaults",
          ),
        ]),
        detail ? el("span", { class: "muted small workflow-step-summary" }, detail) : null,
      ]);
      const controls = el("div", {
        class: "workflow-step-actions",
        role: "group",
        "aria-label": `${itemLabel} actions`,
      });
      if (options.onConfigure) {
        controls.append(
          el(
            "button",
            {
              type: "button",
              class: "ghost small-btn workflow-configure",
              "aria-label": `Configure ${itemLabel}, step ${index + 1}`,
              onclick: () =>
                options.onConfigure?.(item, index, (replacement) => {
                  items[index] = replacement;
                  render();
                  changed();
                  announce(`Configured ${itemLabel}, step ${index + 1}.`);
                }),
            },
            "Configure",
          ),
        );
      }
      controls.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn workflow-icon-action",
            disabled: index === 0,
            title: "Move earlier",
            "aria-label": `Move ${itemLabel}, step ${index + 1}, earlier`,
            onclick: () => {
              items.splice(index - 1, 0, items.splice(index, 1)[0]);
              render();
              changed();
              announce(`Moved ${itemLabel} to step ${index}.`);
            },
          },
          "↑",
        ),
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn workflow-icon-action",
            disabled: index === items.length - 1,
            title: "Move later",
            "aria-label": `Move ${itemLabel}, step ${index + 1}, later`,
            onclick: () => {
              items.splice(index + 1, 0, items.splice(index, 1)[0]);
              render();
              changed();
              announce(`Moved ${itemLabel} to step ${index + 2}.`);
            },
          },
          "↓",
        ),
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn",
            "aria-label": `Duplicate ${itemLabel}, step ${index + 1}`,
            onclick: () => {
              items.splice(index + 1, 0, options.clone(item));
              render();
              changed();
              announce(`Duplicated ${itemLabel} as step ${index + 2}.`);
            },
          },
          "Duplicate",
        ),
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn danger",
            "aria-label": `Remove ${itemLabel}, step ${index + 1}`,
            onclick: () => {
              items.splice(index, 1);
              render();
              changed();
              announce(`Removed ${itemLabel}.`);
            },
          },
          "Remove",
        ),
      );
      list.append(el("li", { class: "workflow-step" }, [marker, identity, controls]));
    });
  }

  const add = (kind: string): void => {
    const item = options.create(kind);
    items.push(item);
    render();
    changed();
    announce(`Added ${optionLabel(kind)} as step ${items.length}.`);
  };

  const addBar = el("div", { class: "workflow-step-add" }, [
    picker,
    el("button", { type: "button", class: "ghost small-btn", onclick: () => add(picker.value) }, "Add step"),
  ]);
  const node = el("div", { class: "ordered-step-editor" }, [addBar, list, status]);
  render();

  return {
    node,
    status,
    getItems: () => [...items],
    replace(nextItems, message) {
      items.splice(0, items.length, ...nextItems);
      render();
      changed();
      if (message) announce(message);
    },
    add,
  };
}
