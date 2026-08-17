import { confirmModal, el, field } from "@hypo/ui";
import { compareRollsByStatus, filmDating, filmStockLabel, framesForRoll, reserveQuantity } from "./film-helpers.ts";
import { openFramesFilePicker } from "./film-frames-import.ts";
import { maybeRemoveDepletedStockpile, openDuplicateReserve, openLoadRoll } from "./film-roll.ts";
import type { FilmRecord, FilmViewServices } from "./film-types.ts";

const ROLLS_PAGE_SIZE = 24;

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
      el("button", { class: "ghost small-btn primary-btn", onclick: () => services.openRoll(roll) }, [
        services.icon("film", 14),
        el("span", {}, "Manage"),
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
    el("div", { class: "row between wrap" }, [
      el("div", {}, [
        el("h2", {}, "Roll library"),
        rolls.length
          ? el(
              "p",
              { class: "muted small library-section-intro" },
              "Find a roll, then manage its frames and processing in one place.",
            )
          : null,
      ]),
      el("div", { class: "row wrap" }, [
        el("button", { class: "ghost small-btn", onclick: () => openFramesFilePicker(services) }, [
          services.icon("upload", 15),
          el("span", {}, "Import .frames"),
        ]),
        el(
          "button",
          { class: "ghost small-btn add-gear", onclick: () => services.addGear("filmRoll", services.renderLibrary) },
          [services.icon("plus", 15), el("span", {}, "New roll")],
        ),
      ]),
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

  const activeStatuses = new Set(["loaded", "partial"]);
  const waitingStatuses = new Set(["exposed", "at-lab", "developing"]);
  const processedStatuses = new Set(["developed", "scanned"]);
  const matchesScope = (roll: FilmRecord, scope: string) => {
    const status = String(roll.value.status || "loaded");
    if (scope === "active") return activeStatuses.has(status);
    if (scope === "waiting") return waitingStatuses.has(status);
    if (scope === "processed") return processedStatuses.has(status);
    if (scope === "archived") return status === "archived";
    return true;
  };
  const scopeCounts = {
    all: rolls.length,
    active: rolls.filter((roll) => matchesScope(roll, "active")).length,
    waiting: rolls.filter((roll) => matchesScope(roll, "waiting")).length,
    processed: rolls.filter((roll) => matchesScope(roll, "processed")).length,
    archived: rolls.filter((roll) => matchesScope(roll, "archived")).length,
  };
  const search = el("input", {
    type: "search",
    class: "search-input library-filter-input",
    placeholder: "Search labels, film stocks, cameras, batches…",
    "aria-label": "Search film rolls",
  });
  const sort = el(
    "select",
    { "aria-label": "Sort film rolls" },
    [
      ["recent", "Recently active"],
      ["status", "Workflow status"],
      ["oldest", "Oldest first"],
      ["stock", "Film stock"],
      ["frames", "Most frames"],
    ].map(([value, label]) => el("option", { value }, label)),
  );
  const list = el("ul", { class: "gear-list roll-library-list", "aria-live": "polite" });
  const resultSummary = el("p", { class: "muted small library-result-summary", role: "status" });
  const more = el("button", { class: "ghost small-btn reveal-summary hidden", type: "button" });
  const empty = el("p", { class: "muted small gear-empty hidden" }, "No rolls match these filters.");
  let scope = "all";
  let visibleCount = ROLLS_PAGE_SIZE;

  const activityDate = (roll: FilmRecord) =>
    [
      roll.value.updatedAt,
      roll.value.archivedAt,
      roll.value.scannedAt,
      roll.value.developedAt,
      roll.value.exposedAt,
      roll.value.partialAt,
      roll.value.loadedAt,
      roll.value.createdAt,
    ].find((value) => typeof value === "string" && value) || "";
  const searchText = (roll: FilmRecord) => {
    const value = roll.value;
    const camera = value.camera
      ? (services.getStore().instance.camera || []).find((record) => record.uri === value.camera)
      : undefined;
    return [
      value.label,
      value.rollNumber,
      value.serialNumber,
      value.emulsionBatch,
      value.status,
      stockLabel(services, value.stock),
      camera ? services.instanceLabel("camera", camera.value) : "",
      services.enumLabel(String(value.status || "")),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  };
  const scopeButtons = new Map<string, HTMLButtonElement>();
  const scopes = [
    ["all", "All", scopeCounts.all],
    ["active", "In cameras", scopeCounts.active],
    ["waiting", "Needs processing", scopeCounts.waiting],
    ["processed", "Processed", scopeCounts.processed],
    ["archived", "Archived", scopeCounts.archived],
  ] as const;
  const render = () => {
    const query = search.value.trim().toLowerCase();
    let filtered = rolls.filter((roll) => matchesScope(roll, scope) && (!query || searchText(roll).includes(query)));
    filtered = [...filtered].sort((left, right) => {
      if (sort.value === "status") return compareRollsByStatus(left, right, services.rollStatuses);
      if (sort.value === "oldest") return activityDate(left).localeCompare(activityDate(right));
      if (sort.value === "stock")
        return stockLabel(services, left.value.stock).localeCompare(stockLabel(services, right.value.stock));
      if (sort.value === "frames")
        return (
          framesForRoll(services.getStore(), right.uri).length - framesForRoll(services.getStore(), left.uri).length ||
          activityDate(right).localeCompare(activityDate(left))
        );
      return activityDate(right).localeCompare(activityDate(left));
    });
    list.replaceChildren(...filtered.slice(0, visibleCount).map((roll) => rollRow(roll, services)));
    empty.classList.toggle("hidden", filtered.length > 0);
    const shown = Math.min(visibleCount, filtered.length);
    resultSummary.textContent = `${filtered.length} roll${filtered.length === 1 ? "" : "s"}${shown < filtered.length ? ` · showing ${shown}` : ""}`;
    const remaining = filtered.length - shown;
    more.classList.toggle("hidden", remaining <= 0);
    more.textContent = remaining > 0 ? `Show ${Math.min(ROLLS_PAGE_SIZE, remaining)} more` : "";
    scopeButtons.forEach((button, key) => {
      button.classList.toggle("active", key === scope);
      button.setAttribute("aria-pressed", String(key === scope));
    });
  };
  const scopeBar = el("div", { class: "library-scope-bar", role: "group", "aria-label": "Filter rolls by state" });
  for (const [key, label, count] of scopes) {
    if (key !== "all" && count === 0) continue;
    const button = el(
      "button",
      {
        type: "button",
        class: `library-scope${key === "all" ? " active" : ""}`,
        "aria-pressed": String(key === "all"),
        onclick: () => {
          scope = key;
          visibleCount = ROLLS_PAGE_SIZE;
          render();
        },
      },
      [el("span", {}, label), el("span", { class: "mono library-scope-count" }, String(count))],
    );
    scopeButtons.set(key, button);
    scopeBar.append(button);
  }
  search.addEventListener("input", () => {
    visibleCount = ROLLS_PAGE_SIZE;
    render();
  });
  sort.addEventListener("change", render);
  more.addEventListener("click", () => {
    visibleCount += ROLLS_PAGE_SIZE;
    render();
  });
  card.append(
    scopeBar,
    el("div", { class: "library-filter-bar" }, [search, field("Sort", sort)]),
    resultSummary,
    list,
    empty,
    more,
  );
  render();
  return card;
}

export function renderFilmView(body: HTMLElement, services: FilmViewServices): void {
  body.append(reserveCard(services), rollsCard(services));
}
