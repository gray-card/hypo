import { el, field, openModal } from "@hypo/ui";
import { framesForRoll } from "./film-helpers.ts";
import type { FilmRecord, FilmValue, FilmViewServices } from "./film-types.ts";

export async function syncRollExposureCount(rollUri: string, services: FilmViewServices): Promise<void> {
  const roll = (services.getStore().instance.filmRoll || []).find((record) => record.uri === rollUri);
  if (!roll) return;
  const used = framesForRoll(services.getStore(), rollUri).length;
  let status = roll.value.status;
  const total = roll.value.exposuresTotal;
  if (used > 0 && ["loaded", undefined].includes(status)) status = "partial";
  if (used > 0 && total && used >= total) status = "exposed";
  const next: FilmValue = { ...roll.value, exposuresUsed: used, status };
  const now = new Date().toISOString();
  if (["partial", "exposed"].includes(status) && !next.partialAt) next.partialAt = now;
  if (status === "exposed" && !next.exposedAt) next.exposedAt = now;
  if (
    (roll.value.exposuresUsed || 0) === used &&
    status === roll.value.status &&
    next.partialAt === roll.value.partialAt &&
    next.exposedAt === roll.value.exposedAt
  )
    return;
  try {
    await services.saveRecord(services.collections.filmRoll, { ...next, updatedAt: now }, roll);
  } catch {
    // Derived roll counts are best-effort; linting derives the same invariant.
  }
}

export async function openAddFrame(
  roll: FilmRecord,
  onAdded: (() => void) | undefined,
  services: FilmViewServices,
): Promise<void> {
  const numberInput = el("input", { type: "number", min: "0", placeholder: "Frame # (optional)" });
  const noteInput = el("input", { type: "text", placeholder: "Note (optional)" });
  const grid = el("div", { class: "photo-pick-grid" }, [el("p", { class: "muted small" }, "Loading your photos…")]);
  let chosenPhoto: string | null = null;
  openModal(
    "Add frame",
    [
      field("Frame number", numberInput),
      field("Note", noteInput),
      el("h3", { class: "modal-sub" }, "Link a photo (optional)"),
      grid,
    ],
    async () => {
      const record: FilmValue = {
        roll: roll.uri,
        createdAt: new Date().toISOString(),
        provenance: { source: "manual", assertedAt: new Date().toISOString() },
      };
      const frameNumber = Number.parseInt(numberInput.value, 10);
      if (Number.isFinite(frameNumber)) record.frameNumber = frameNumber;
      if (noteInput.value.trim()) record.note = noteInput.value.trim();
      if (chosenPhoto) record.photo = chosenPhoto;
      await services.saveRecord(services.collections.exposure, record, null);
      await services.reloadStore();
      void syncRollExposureCount(roll.uri, services);
      onAdded?.();
    },
  );

  try {
    const photos = await services.getPhotos();
    grid.replaceChildren();
    if (!photos.length) {
      grid.append(el("p", { class: "muted small" }, "No photos found."));
      return;
    }
    for (const [index, photo] of photos.slice(0, 60).entries()) {
      const cell = el("button", {
        class: "photo-pick",
        type: "button",
        "aria-label": photo.value.alt?.trim() || `Photo ${index + 1}`,
        "aria-pressed": "false",
      });
      cell.addEventListener("click", () => {
        chosenPhoto = chosenPhoto === photo.uri ? null : photo.uri;
        for (const candidate of grid.querySelectorAll(".photo-pick")) {
          candidate.classList.remove("chosen");
          candidate.setAttribute("aria-pressed", "false");
        }
        if (chosenPhoto) {
          cell.classList.add("chosen");
          cell.setAttribute("aria-pressed", "true");
        }
      });
      grid.append(cell);
      services
        .blobUrl(photo.value.photo)
        .then((url) => {
          if (url) cell.style.backgroundImage = `url(${url})`;
        })
        .catch(() => {});
    }
  } catch {
    grid.replaceChildren(el("p", { class: "muted small" }, "Couldn't load photos."));
  }
}
