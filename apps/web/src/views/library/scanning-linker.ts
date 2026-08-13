import { el, field, openModal, toast } from "@hypo/ui";
import { createInstanceSelect } from "./maintenance-selectors.ts";
import type { ActivityServices, LibraryRecord } from "./maintenance-types.ts";

export function openFrameLinker(onDone: (() => void) | undefined, services: ActivityServices) {
  const rollSelect = createInstanceSelect("filmRoll", "", services);
  const list = el("div", { class: "framelink-list" }, [
    el("p", { class: "muted small" }, "Choose a roll to see its frames."),
  ]);
  let photos: readonly LibraryRecord[] = [];
  let photosLoaded = false;
  const chosen = new Map<string, string | undefined>();
  const exposuresForRoll = (rollUri: string) =>
    [...(services.getStore().instance.exposure || [])]
      .filter((exposure) => exposure.value.roll === rollUri)
      .sort((left, right) => (left.value.frameNumber ?? 0) - (right.value.frameNumber ?? 0));

  const pickPhoto = (exposureUri: string, after?: () => void) => {
    const grid = el("div", { class: "photo-pick-grid" });
    openModal("Pick the scanned photo", [grid], async () => after?.(), { saveLabel: "Done" });
    for (const [index, photo] of photos.slice(0, 80).entries()) {
      const selected = chosen.get(exposureUri) === photo.uri;
      const cell = el("button", {
        class: `photo-pick${selected ? " chosen" : ""}`,
        type: "button",
        "aria-label": photo.value.alt?.trim() || `Photo ${index + 1}`,
        "aria-pressed": String(selected),
      });
      cell.addEventListener("click", () => {
        chosen.set(exposureUri, chosen.get(exposureUri) === photo.uri ? undefined : photo.uri);
        for (const candidate of grid.querySelectorAll(".photo-pick")) {
          candidate.classList.remove("chosen");
          candidate.setAttribute("aria-pressed", "false");
        }
        if (chosen.get(exposureUri)) {
          cell.classList.add("chosen");
          cell.setAttribute("aria-pressed", "true");
        }
      });
      grid.append(cell);
      void services
        .blobUrl(photo.value.photo)
        .then((url) => {
          if (url) cell.style.backgroundImage = `url(${url})`;
        })
        .catch(() => {});
    }
  };

  const renderRows = (rollUri: string) => {
    const exposures = exposuresForRoll(rollUri);
    chosen.clear();
    for (const exposure of exposures) if (exposure.value.photo) chosen.set(exposure.uri, exposure.value.photo);
    if (!exposures.length) {
      list.replaceChildren(
        el(
          "p",
          { class: "muted small" },
          "No frames logged for this roll yet — log them in the Film tab or the shot logger.",
        ),
      );
      return;
    }
    const rows = el("div", { class: "gear-list" });
    const paint = () => {
      rows.replaceChildren(
        ...exposures.map((exposure) => {
          const current = chosen.get(exposure.uri);
          const thumb = el("div", { class: "framelink-thumb" });
          if (current) {
            const photo = photos.find((candidate) => candidate.uri === current);
            if (photo) {
              void services
                .blobUrl(photo.value.photo)
                .then((url) => {
                  if (url) thumb.style.backgroundImage = `url(${url})`;
                })
                .catch(() => {});
            }
          }
          return el("div", { class: "gear-row row between" }, [
            el("div", { class: "row", style: "gap:10px;align-items:center" }, [
              thumb,
              el("span", {}, `Frame ${exposure.value.frameNumber ?? "—"}`),
            ]),
            el(
              "button",
              {
                class: "ghost small-btn",
                disabled: !photosLoaded,
                onclick: () => pickPhoto(exposure.uri, paint),
              },
              current ? "Change" : "Link photo",
            ),
          ]);
        }),
      );
    };
    const autoMatch = el(
      "button",
      {
        class: "ghost small-btn",
        type: "button",
        disabled: !photosLoaded,
        onclick: () => {
          exposures.forEach((exposure, index) => {
            if (photos[index]) chosen.set(exposure.uri, photos[index].uri);
          });
          paint();
        },
      },
      "Auto-match in order",
    );
    list.replaceChildren(
      el("div", { class: "row between" }, [
        el("span", { class: "muted small" }, `${exposures.length} frame${exposures.length === 1 ? "" : "s"}`),
        autoMatch,
      ]),
      rows,
    );
    paint();
  };

  rollSelect.addEventListener("change", () => {
    if (rollSelect.value) renderRows(rollSelect.value);
  });
  const modal = openModal(
    "Link frames → photos",
    [field("Roll", rollSelect), list],
    async () => {
      let linked = 0;
      for (const [exposureUri, photoUri] of chosen) {
        if (!photoUri) continue;
        const exposure = (services.getStore().instance.exposure || []).find((item) => item.uri === exposureUri);
        if (!exposure || exposure.value.photo === photoUri) continue;
        await services.saveRecord(
          services.collections.exposure,
          { ...exposure.value, photo: photoUri, updatedAt: new Date().toISOString() },
          exposure,
        );
        linked += 1;
      }
      await services.reloadStore();
      toast(linked ? `Linked ${linked} frame${linked === 1 ? "" : "s"}` : "No changes", "ok");
      onDone?.();
    },
    { saveLabel: "Save links" },
  );
  void services
    .capturePhotos()
    .then((records) => {
      photos = records || [];
      photosLoaded = true;
      if (rollSelect.value) renderRows(rollSelect.value);
    })
    .catch(() => {
      photosLoaded = true;
      if (rollSelect.value) renderRows(rollSelect.value);
    });
  return modal;
}
