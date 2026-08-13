import { confirmModal, el, toast } from "@hypo/ui";
import { MAINTAINABLE } from "./gear-config.ts";
import type { GearRecord, GearServices, GearValue } from "./gear-types.ts";

export interface GearTabActions {
  addGear(kind: string, onDone: () => void): void;
  editGear(kind: string, item: GearRecord, onDone: () => void): void;
  maintain(subjectUri: string, onDone: () => void): void;
  render(): void;
}

function recordKey(item: GearRecord): string {
  return item.rkey || item.uri.split("/").filter(Boolean).at(-1) || "";
}

function processChip(value: GearValue, services: GearServices): Node | null {
  const process = value.process;
  if (!process) return null;
  const className =
    ({ c41: "c41", ra4: "c41", e6: "e6", ecn2: "ecn2", bw: "bw", "reversal-bw": "bw" } as Record<string, string>)[
      process
    ] || "bw";
  return el("span", { class: `chip ${className}` }, services.enumLabel(process));
}

export function createGearThumb(kind: string, value: GearValue, services: GearServices): HTMLDivElement {
  const thumb = el("div", { class: "type-thumb", "aria-hidden": "true" });
  void services
    .instanceImageUrl(kind, value)
    .then((url) => {
      if (!url) return;
      thumb.style.backgroundImage = `url("${url}")`;
      thumb.classList.add("has-img");
    })
    .catch(() => {});
  return thumb;
}

export function renderGearTabView(
  body: HTMLElement,
  kinds: readonly string[],
  services: GearServices,
  actions: GearTabActions,
): void {
  for (const kind of kinds) {
    const items = services.getStore().instance[kind] || [];
    const card = el("div", { class: "card gear-section" });
    card.append(
      el("div", { class: "row between" }, [
        el("h2", {}, services.kindLabelPlural(kind)),
        el("button", { class: "ghost small-btn add-gear", onclick: () => actions.addGear(kind, actions.render) }, [
          services.icon("plus", 15),
          el("span", {}, `Add ${services.kindLabel(kind).toLowerCase()}`),
        ]),
      ]),
    );
    if (!items.length) {
      card.append(
        el("p", { class: "muted small gear-empty" }, `No ${services.kindLabelPlural(kind).toLowerCase()} yet.`),
      );
    } else {
      const list = el("ul", { class: "gear-list" });
      for (const item of items) {
        list.append(
          el("li", { class: "gear-row row between" }, [
            el("span", { class: "row type-label" }, [
              createGearThumb(kind, item.value, services),
              el("span", {}, services.instanceLabel(kind, item.value)),
              processChip(item.value, services),
            ]),
            el("span", { class: "row" }, [
              services.isAdvanced()
                ? el(
                    "button",
                    {
                      class: "ghost small-btn",
                      title: "Inspect record",
                      "aria-label": "Inspect record",
                      onclick: () => services.inspect(item),
                    },
                    "{ }",
                  )
                : null,
              el(
                "button",
                {
                  class: "ghost small-btn",
                  title: "Edit",
                  "aria-label": "Edit",
                  "data-gear-kind": kind,
                  "data-record-rkey": recordKey(item),
                  onclick: () => actions.editGear(kind, item, actions.render),
                },
                [services.icon("edit", 15)],
              ),
              MAINTAINABLE.has(kind)
                ? el(
                    "button",
                    { class: "ghost small-btn", onclick: () => actions.maintain(item.uri, actions.render) },
                    "Service",
                  )
                : null,
              el(
                "button",
                {
                  class: "ghost small-btn danger",
                  title: "Remove",
                  "aria-label": "Remove",
                  onclick: async () => {
                    if (!(await confirmModal(`Remove this ${services.kindLabel(kind).toLowerCase()}?`))) return;
                    const snapshot = item.value;
                    await services.deleteRecord(item.uri);
                    await services.reloadStore();
                    actions.render();
                    toast("Removed", "ok", 6000, {
                      label: "Undo",
                      fn: async () => {
                        await services.saveRecord(services.collections.instance[kind], snapshot, null);
                        await services.reloadStore();
                        actions.render();
                      },
                    });
                  },
                },
                [services.icon("trash", 15)],
              ),
            ]),
          ]),
        );
      }
      card.append(list);
    }
    body.append(card);
  }
}
