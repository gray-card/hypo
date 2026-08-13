import { confirmModal, el } from "@hypo/ui";
import { compareRollsByStatus, filmDating, filmStockLabel, framesForRoll, reserveQuantity } from "./film-helpers.ts";
import { maybeRemoveDepletedStockpile, openDuplicateReserve, openLoadRoll } from "./film-roll.ts";
import type { FilmRecord, FilmViewServices } from "./film-types.ts";

const ROLLS_PREVIEW = 5;

const stockLabel = (services: FilmViewServices, stockUri: string | undefined) =>
  filmStockLabel(services.getStore(), stockUri, services.catalogLabel);

async function refreshFilm(services: FilmViewServices): Promise<void> {
  await services.reloadStore();
  services.renderLibrary();
}

function reserveCard(services: FilmViewServices): HTMLDivElement {
  const stockpiles = (services.getStore().instance.filmStockpile || []).filter(
    (stockpile) => reserveQuantity(stockpile.value) > 0,
  );
  const card = el("div", { class: "card gear-section" });
  card.append(
    el("div", { class: "row between" }, [
      el("h2", {}, "Film in reserve"),
      el(
        "button",
        { class: "ghost small-btn add-gear", onclick: () => services.addGear("filmStockpile", services.renderLibrary) },
        [services.icon("plus", 15), el("span", {}, "Add film")],
      ),
    ]),
  );
  if (!stockpiles.length) {
    card.append(
      el("p", { class: "muted small gear-empty" }, "No film in reserve yet. Add the stocks you keep on hand."),
    );
    return card;
  }
  const list = el("ul", { class: "gear-list" });
  for (const stockpile of stockpiles) {
    const quantity = reserveQuantity(stockpile.value);
    const adjust = async (delta: number) => {
      const next = Math.max(0, quantity + delta);
      await services.saveRecord(
        services.collections.filmStockpile,
        { ...stockpile.value, quantity: next, updatedAt: new Date().toISOString() },
        stockpile,
      );
      if (next === 0) await maybeRemoveDepletedStockpile(stockpile, services);
      await refreshFilm(services);
    };
    const dating = filmDating(stockpile.value, services.enumLabel);
    list.append(
      el("li", { class: `gear-row row between${dating.expired || dating.soon ? " warn-row" : ""}` }, [
        el("span", { class: "row type-label" }, [
          services.instanceThumb("filmStockpile", stockpile.value),
          el("span", { class: "reserve-id" }, [
            el("span", { class: "row", style: "gap:8px" }, [
              el("span", {}, stockLabel(services, stockpile.value.stock)),
              el("span", { class: "qty-badge" }, `×${quantity}`),
              dating.expired
                ? el("span", { class: "status-chip warn" }, "expired")
                : dating.soon
                  ? el("span", { class: "status-chip warn" }, "expiring")
                  : null,
            ]),
            dating.text ? el("div", { class: "muted small" }, dating.text) : null,
          ]),
        ]),
        el("span", { class: "row" }, [
          el(
            "button",
            { class: "ghost small-btn", title: "One fewer", "aria-label": "One fewer", onclick: () => adjust(-1) },
            "−",
          ),
          el(
            "button",
            { class: "ghost small-btn", title: "One more", "aria-label": "One more", onclick: () => adjust(1) },
            "+",
          ),
          el("button", { class: "ghost small-btn", onclick: () => openLoadRoll(stockpile, services) }, [
            services.icon("camera", 14),
            el("span", {}, "Load"),
          ]),
          el(
            "button",
            {
              class: "ghost small-btn",
              title: "Log another batch of this stock",
              "aria-label": "Duplicate reserve",
              onclick: () => openDuplicateReserve(stockpile, services),
            },
            [services.icon("copy", 15)],
          ),
          services.isAdvanced()
            ? el(
                "button",
                {
                  class: "ghost small-btn",
                  title: "Inspect record",
                  "aria-label": "Inspect record",
                  onclick: () => services.inspect(stockpile),
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
              onclick: () => services.editGear("filmStockpile", stockpile, services.renderLibrary),
            },
            [services.icon("edit", 15)],
          ),
          el(
            "button",
            {
              class: "ghost small-btn danger",
              title: "Remove",
              "aria-label": "Remove",
              onclick: async () => {
                if (!(await confirmModal("Remove this reserve?"))) return;
                await services.deleteRecord(stockpile.uri);
                await refreshFilm(services);
              },
            },
            [services.icon("trash", 15)],
          ),
        ]),
      ]),
    );
  }
  card.append(list);
  return card;
}

function rollRow(roll: FilmRecord, services: FilmViewServices): HTMLLIElement {
  const value = roll.value;
  const camera = value.camera
    ? (services.getStore().instance.camera || []).find((record) => record.uri === value.camera)
    : null;
  const cameraLabel = camera ? services.instanceLabel("camera", camera.value) : null;
  const frameCount = framesForRoll(services.getStore(), roll.uri).length;
  const dating = filmDating(value, services.enumLabel);
  return el("li", { class: `gear-row row between${dating.expired || dating.soon ? " warn-row" : ""}` }, [
    el("span", { class: "row type-label" }, [
      services.instanceThumb("filmRoll", value),
      el("span", { class: "reserve-id" }, [
        el("span", { class: "row", style: "gap:8px" }, [
          el(
            "span",
            {},
            value.label ? `${value.label} · ${stockLabel(services, value.stock)}` : stockLabel(services, value.stock),
          ),
          value.status ? el("span", { class: "status-chip" }, services.enumLabel(value.status)) : null,
          cameraLabel ? el("span", { class: "muted small" }, `in ${cameraLabel}`) : null,
          frameCount
            ? el("span", { class: "muted small" }, `· ${frameCount} frame${frameCount === 1 ? "" : "s"}`)
            : null,
        ]),
        dating.text ? el("div", { class: "muted small" }, dating.text) : null,
      ]),
    ]),
    el("span", { class: "row" }, [
      el("button", { class: "ghost small-btn", onclick: () => services.openRoll(roll) }, [
        services.icon("film", 14),
        el("span", {}, "Open"),
      ]),
      services.isAdvanced()
        ? el(
            "button",
            {
              class: "ghost small-btn",
              title: "Inspect record",
              "aria-label": "Inspect record",
              onclick: () => services.inspect(roll),
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
          onclick: () => services.editGear("filmRoll", roll, services.renderLibrary),
        },
        [services.icon("edit", 15)],
      ),
      el(
        "button",
        {
          class: "ghost small-btn danger",
          title: "Remove",
          "aria-label": "Remove",
          onclick: async () => {
            if (!(await confirmModal("Remove this roll?"))) return;
            await services.deleteRecord(roll.uri);
            await refreshFilm(services);
          },
        },
        [services.icon("trash", 15)],
      ),
    ]),
  ]);
}

function rollsCard(services: FilmViewServices): HTMLDivElement {
  const rolls = services.getStore().instance.filmRoll || [];
  const card = el("div", { class: "card gear-section" });
  card.append(
    el("div", { class: "row between" }, [
      el("h2", {}, "Rolls"),
      el(
        "button",
        { class: "ghost small-btn add-gear", onclick: () => services.addGear("filmRoll", services.renderLibrary) },
        [services.icon("plus", 15), el("span", {}, "New roll")],
      ),
    ]),
  );
  if (!rolls.length) {
    card.append(
      el(
        "p",
        { class: "muted small gear-empty" },
        "No rolls yet. Load one from reserve, or add a roll you've already shot.",
      ),
    );
    return card;
  }
  const sorted = [...rolls].sort((left, right) => compareRollsByStatus(left, right, services.rollStatuses));
  const list = el("ul", { class: "gear-list" });
  for (const roll of sorted.slice(0, ROLLS_PREVIEW)) list.append(rollRow(roll, services));
  if (sorted.length <= ROLLS_PREVIEW) {
    card.append(list);
    return card;
  }
  const hidden = el("ul", { class: "gear-list hidden" });
  for (const roll of sorted.slice(ROLLS_PREVIEW)) hidden.append(rollRow(roll, services));
  const remaining = sorted.length - ROLLS_PREVIEW;
  const more = el("button", { class: "ghost small-btn reveal-summary", type: "button", style: "margin-top:8px" }, [
    `Show ${remaining} more roll${remaining === 1 ? "" : "s"}`,
    el("span", { class: "reveal-caret", "aria-hidden": "true" }, "⌄"),
  ]);
  more.addEventListener("click", () => {
    hidden.classList.remove("hidden");
    more.remove();
  });
  card.append(list, more, hidden);
  return card;
}

export function renderFilmView(body: HTMLElement, services: FilmViewServices): void {
  body.append(reserveCard(services), rollsCard(services));
}
