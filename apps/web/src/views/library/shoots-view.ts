import { confirmModal, el } from "@hypo/ui";
import { effectiveShootGearUris, shootExposures } from "./shoots-selectors.ts";
import type { ShootRecord, ShootServices } from "./shoots-types.ts";

export interface ShootViewActions {
  startShoot(onDone: (uri: string) => void): void;
  editShoot(shoot: ShootRecord, onDone: () => void): void;
  openLogger(shoot: ShootRecord): void;
  render(): void;
}

const shootLabel = (shoot: ShootRecord) => shoot.value.label || "Shoot";

export function renderShootsView(body: HTMLElement, services: ShootServices, actions: ShootViewActions): void {
  const pendingCount = services.pendingCount();
  const card = el("div", { class: "card" });
  card.append(
    el("div", { class: "row between" }, [
      el("h2", {}, "Shoots"),
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
    const list = el("ul", { class: "gear-list" });
    for (const shoot of shoots) {
      const shotCount = shootExposures(shoot.uri, services.getStore()).length;
      const cameraCount = effectiveShootGearUris(shoot, "camera", services.getStore()).length;
      list.append(
        el("li", { class: "gear-row row between" }, [
          el("span", { class: "row type-label" }, [
            el("span", {}, shootLabel(shoot)),
            cameraCount
              ? el("span", { class: "muted small" }, `· ${cameraCount} camera${cameraCount === 1 ? "" : "s"}`)
              : null,
            shotCount ? el("span", { class: "muted small" }, `· ${shotCount} shot${shotCount === 1 ? "" : "s"}`) : null,
          ]),
          el("span", { class: "row" }, [
            el("button", { class: "ghost small-btn primary-btn", onclick: () => actions.openLogger(shoot) }, [
              services.icon("camera", 14),
              el("span", {}, "Log"),
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
                title: "Edit",
                "aria-label": "Edit",
                onclick: () => actions.editShoot(shoot, actions.render),
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
                  if (!(await confirmModal("Remove this shoot?"))) return;
                  await services.deleteRecord(shoot.uri);
                  await services.reloadStore();
                  actions.render();
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
