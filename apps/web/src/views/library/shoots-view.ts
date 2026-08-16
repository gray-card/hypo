import { confirmModal, el, field } from "@hypo/ui";
import { effectiveShootGearUris, shootExposures } from "./shoots-selectors.ts";
import type { ShootRecord, ShootServices } from "./shoots-types.ts";

export interface ShootViewActions {
  startShoot(onDone: (uri: string) => void): void;
  editShoot(shoot: ShootRecord, onDone: () => void): void;
  openLogger(shoot: ShootRecord): void;
  render(): void;
}

const shootLabel = (shoot: ShootRecord) => shoot.value.label || "Shoot";
const SHOOTS_PAGE_SIZE = 24;

export function renderShootsView(body: HTMLElement, services: ShootServices, actions: ShootViewActions): void {
  const pendingCount = services.pendingCount();
  const card = el("div", { class: "card" });
  card.append(
    el("div", { class: "row between wrap" }, [
      el("div", {}, [
        el("h2", {}, "Shoot library"),
        el(
          "p",
          { class: "muted small library-section-intro" },
          "Browse sessions by date, state, gear, roll, or frame count.",
        ),
      ]),
      el(
        "button",
        {
          class: "ghost small-btn add-gear",
          onclick: () =>
            actions.startShoot((uri) => {
              actions.render();
              const shoot = services.getStore().shoots?.find((item) => item.uri === uri);
              if (shoot) actions.openLogger(shoot);
            }),
        },
        [services.icon("plus", 15), el("span", {}, "Start a shoot")],
      ),
    ]),
  );
  if (pendingCount) {
    card.append(
      el(
        "p",
        { class: "muted small" },
        `${pendingCount} shot${pendingCount === 1 ? "" : "s"} queued offline — will sync when you're back online.`,
      ),
    );
  }

  const shoots = services.getStore().shoots || [];
  if (!shoots.length) {
    card.append(el("p", { class: "muted small gear-empty" }, "No shoots yet. Start one to log frames as you shoot."));
  } else {
    const list = el("ul", { class: "gear-list shoot-library-list", "aria-live": "polite" });
    const search = el("input", {
      type: "search",
      class: "search-input library-filter-input",
      placeholder: "Search shoots, rolls, cameras, lenses, places…",
      "aria-label": "Search shoots",
    });
    const sort = el(
      "select",
      { "aria-label": "Sort shoots" },
      [
        ["recent", "Newest first"],
        ["oldest", "Oldest first"],
        ["frames", "Most frames"],
        ["name", "Name"],
      ].map(([value, label]) => el("option", { value }, label)),
    );
    const resultSummary = el("p", { class: "muted small library-result-summary", role: "status" });
    const more = el("button", { class: "ghost small-btn reveal-summary hidden", type: "button" });
    const empty = el("p", { class: "muted small gear-empty hidden" }, "No shoots match these filters.");
    const activeCount = shoots.filter((shoot) => !shoot.value.endedAt).length;
    const withFilmCount = shoots.filter(
      (shoot) => effectiveShootGearUris(shoot, "filmRoll", services.getStore()).length,
    ).length;
    const totalShots = shoots.reduce((sum, shoot) => sum + shootExposures(shoot.uri, services.getStore()).length, 0);
    const scopeCounts = {
      all: shoots.length,
      active: activeCount,
      film: withFilmCount,
      complete: shoots.length - activeCount,
    };
    let scope = "all";
    let visibleCount = SHOOTS_PAGE_SIZE;
    const matchesScope = (shoot: ShootRecord) => {
      if (scope === "active") return !shoot.value.endedAt;
      if (scope === "film") return effectiveShootGearUris(shoot, "filmRoll", services.getStore()).length > 0;
      if (scope === "complete") return Boolean(shoot.value.endedAt);
      return true;
    };
    const dateKey = (shoot: ShootRecord) => shoot.value.startedAt || shoot.value.createdAt || "";
    const relatedLabels = (shoot: ShootRecord, kind: "camera" | "lens" | "filmRoll") =>
      effectiveShootGearUris(shoot, kind, services.getStore())
        .map((uri) => (services.getStore().instance[kind] || []).find((record) => record.uri === uri))
        .filter(Boolean)
        .map((record) => services.instanceLabel(kind, record!.value));
    const searchText = (shoot: ShootRecord) =>
      [
        shoot.value.label,
        shoot.value.notes,
        ...relatedLabels(shoot, "camera"),
        ...relatedLabels(shoot, "lens"),
        ...relatedLabels(shoot, "filmRoll"),
        ...(shoot.value.places || []).flatMap((place: Record<string, any>) =>
          [
            place.placemark?.name,
            place.placemark?.locality,
            place.placemark?.administrativeArea,
            place.placemark?.country,
          ].filter(Boolean),
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const scopeButtons = new Map<string, HTMLButtonElement>();
    const renderShootRow = (shoot: ShootRecord) => {
      const shotCount = shootExposures(shoot.uri, services.getStore()).length;
      const cameraCount = effectiveShootGearUris(shoot, "camera", services.getStore()).length;
      const rollCount = effectiveShootGearUris(shoot, "filmRoll", services.getStore()).length;
      const started = shoot.value.startedAt || shoot.value.createdAt;
      const date = started
        ? new Date(started).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
        : "Date not recorded";
      return el("li", { class: "gear-row row between" }, [
        el("span", { class: "row type-label" }, [
          el("span", { class: "shoot-row-identity" }, [
            el("strong", {}, shootLabel(shoot)),
            el("span", { class: "muted small mono" }, date),
          ]),
          !shoot.value.endedAt ? el("span", { class: "status-chip active" }, "in progress") : null,
          cameraCount
            ? el("span", { class: "muted small" }, `· ${cameraCount} camera${cameraCount === 1 ? "" : "s"}`)
            : null,
          rollCount ? el("span", { class: "muted small" }, `· ${rollCount} roll${rollCount === 1 ? "" : "s"}`) : null,
          shotCount ? el("span", { class: "muted small" }, `· ${shotCount} shot${shotCount === 1 ? "" : "s"}`) : null,
        ]),
        el("span", { class: "row" }, [
          el("button", { class: "ghost small-btn primary-btn", onclick: () => actions.openLogger(shoot) }, [
            services.icon("camera", 14),
            el("span", {}, "Add frames"),
          ]),
          services.isAdvanced()
            ? el(
                "button",
                {
                  class: "ghost small-btn",
                  title: "Inspect record",
                  "aria-label": "Inspect record",
                  onclick: () => services.inspect(shoot),
                },
                "{ }",
              )
            : null,
          el(
            "button",
            {
              class: "ghost small-btn",
              title: "Edit shoot details, dates, gear, and locations",
              onclick: () => actions.editShoot(shoot, actions.render),
            },
            [services.icon("edit", 15), el("span", {}, "Edit details")],
          ),
          el(
            "button",
            {
              class: "ghost small-btn danger",
              title: "Remove",
              "aria-label": "Remove",
              onclick: async () => {
                if (!(await confirmModal("Remove this shoot?"))) return;
                await services.deleteRecord(shoot.uri);
                await services.reloadStore();
                actions.render();
              },
            },
            [services.icon("trash", 15)],
          ),
        ]),
      ]);
    };
    const render = () => {
      const query = search.value.trim().toLowerCase();
      let filtered = shoots.filter((shoot) => matchesScope(shoot) && (!query || searchText(shoot).includes(query)));
      filtered = [...filtered].sort((left, right) => {
        if (sort.value === "oldest") return dateKey(left).localeCompare(dateKey(right));
        if (sort.value === "frames")
          return (
            shootExposures(right.uri, services.getStore()).length -
              shootExposures(left.uri, services.getStore()).length || dateKey(right).localeCompare(dateKey(left))
          );
        if (sort.value === "name") return shootLabel(left).localeCompare(shootLabel(right));
        return dateKey(right).localeCompare(dateKey(left));
      });
      list.replaceChildren(...filtered.slice(0, visibleCount).map(renderShootRow));
      empty.classList.toggle("hidden", filtered.length > 0);
      const shown = Math.min(visibleCount, filtered.length);
      resultSummary.textContent = `${filtered.length} shoot${filtered.length === 1 ? "" : "s"}${shown < filtered.length ? ` · showing ${shown}` : ""}`;
      const remaining = filtered.length - shown;
      more.classList.toggle("hidden", remaining <= 0);
      more.textContent = remaining > 0 ? `Show ${Math.min(SHOOTS_PAGE_SIZE, remaining)} more` : "";
      scopeButtons.forEach((button, key) => {
        button.classList.toggle("active", key === scope);
        button.setAttribute("aria-pressed", String(key === scope));
      });
    };
    const scopeBar = el("div", { class: "library-scope-bar", role: "group", "aria-label": "Filter shoots by state" });
    const scopes = [
      ["all", "All shoots", scopeCounts.all],
      ["active", "In progress", scopeCounts.active],
      ["film", "Film shoots", scopeCounts.film],
      ["complete", "Completed", scopeCounts.complete],
    ] as const;
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
            visibleCount = SHOOTS_PAGE_SIZE;
            render();
          },
        },
        [el("span", {}, label), el("span", { class: "mono library-scope-count" }, String(count))],
      );
      scopeButtons.set(key, button);
      scopeBar.append(button);
    }
    const stats = el("div", { class: "library-ledger-strip", "aria-label": "Shoot totals" }, [
      el("span", {}, [el("strong", {}, String(shoots.length)), el("span", {}, " shoots")]),
      el("span", {}, [el("strong", {}, String(totalShots)), el("span", {}, " frames logged")]),
      el("span", {}, [el("strong", {}, String(withFilmCount)), el("span", {}, " film shoots")]),
    ]);
    search.addEventListener("input", () => {
      visibleCount = SHOOTS_PAGE_SIZE;
      render();
    });
    sort.addEventListener("change", render);
    more.addEventListener("click", () => {
      visibleCount += SHOOTS_PAGE_SIZE;
      render();
    });
    card.append(
      stats,
      scopeBar,
      el("div", { class: "library-filter-bar" }, [search, field("Sort", sort)]),
      resultSummary,
      list,
      empty,
      more,
    );
    render();
  }
  body.append(card);
}
