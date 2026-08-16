import { confirmModal, dateField, el, field, localInputToIso, openModal } from "@hypo/ui";
import { openAddFrame, syncRollExposureCount } from "./film-frame.ts";
import { filmStockLabel, framesForRoll, reserveQuantity } from "./film-helpers.ts";
import type { FilmRecord, FilmValue, FilmViewServices } from "./film-types.ts";
import {
  formatAgitation,
  formatDevelopmentStages,
  formatDevelopmentTime,
  primaryDevelopmentStep,
} from "./maintenance-darkroom.ts";
import { createWorkflowOccurrenceEditor } from "./workflow-occurrences.ts";

const stockLabel = (services: FilmViewServices, stockUri: string | undefined) =>
  filmStockLabel(services.getStore(), stockUri, services.catalogLabel);

function workflowSelect(services: FilmViewServices): HTMLSelectElement {
  return el("select", {}, [
    el("option", { value: "" }, "No workflow yet"),
    ...(services.getStore().workflowTemplates || [])
      .filter((template) => ["film", "instant", "alt-process", "other"].includes(String(template.value.medium)))
      .map((template) => el("option", { value: template.uri }, template.value.name || "Untitled workflow")),
  ]);
}

const ROLL_LIFECYCLE_DATES = [
  ["loadedAt", "Loaded"],
  ["partialAt", "First frame exposed"],
  ["exposedAt", "Fully exposed"],
  ["unloadedAt", "Unloaded"],
  ["sentToLabAt", "Sent to lab"],
  ["developmentStartedAt", "Development started"],
  ["developedAt", "Developed"],
  ["receivedFromLabAt", "Received from lab"],
  ["scannedAt", "Scanned"],
  ["archivedAt", "Archived"],
] as const;

async function refreshFilm(services: FilmViewServices): Promise<void> {
  await services.reloadStore();
  services.renderLibrary();
}

export async function maybeRemoveDepletedStockpile(
  stockpile: FilmRecord,
  services: FilmViewServices,
): Promise<boolean> {
  const remove = await confirmModal(
    `${stockLabel(services, stockpile.value.stock)} is out of stock. Remove this reserve entry?`,
    {
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      danger: true,
    },
  );
  if (!remove) return false;
  await services.deleteRecord(stockpile.uri);
  return true;
}

export function openDuplicateReserve(stockpile: FilmRecord, services: FilmViewServices): void {
  const value = stockpile.value;
  const stock = (services.getStore().catalog.filmStock || []).find((record) => record.uri === value.stock)?.value || {};
  const prefill = {
    brand: stock.brand,
    name: stock.name,
    iso: stock.iso,
    filmType: stock.filmType,
    process: stock.process,
    format: value.format ?? stock.format,
    storage: value.storage,
    storageLocation: value.storageLocation,
    quantity: value.quantity,
  };
  services.addGear("filmStockpile", services.renderLibrary, prefill);
}

export function openLoadRoll(stockpile: FilmRecord, services: FilmViewServices): void {
  const cameraSelect = services.instanceSelect("camera", "");
  const templateSelect = workflowSelect(services);
  const occurrences = createWorkflowOccurrenceEditor(
    templateSelect,
    services.getStore().workflowTemplates || [],
    services.stageLabels,
  );
  const labelInput = el("input", { type: "text", placeholder: "e.g. Roll 12 (optional)" });
  openModal(
    `Load ${stockLabel(services, stockpile.value.stock)}`,
    [
      el(
        "p",
        { class: "muted small" },
        "Splits one roll off your reserve and marks it loaded. Its format, batch, expiry and storage carry over.",
      ),
      field("Into camera", cameraSelect),
      field("Label", labelInput),
      (services.getStore().workflowTemplates || []).length
        ? field("Start a workflow", templateSelect)
        : el("p", { class: "muted small" }, "You can create reusable workflows from Setup → Workflows."),
      occurrences.node,
    ],
    async () => {
      const previousQuantity = reserveQuantity(stockpile.value);
      const rollUri = await services.splitRoll(stockpile, {
        camera: cameraSelect.value || null,
        label: labelInput.value.trim() || null,
      });
      const template = (services.getStore().workflowTemplates || []).find((item) => item.uri === templateSelect.value);
      if (template && services.instantiateWorkflow) {
        await services.instantiateWorkflow(
          template,
          [{ kind: "film-roll-latent", ref: rollUri, label: labelInput.value.trim() || undefined }],
          { filmRoll: rollUri, camera: cameraSelect.value || undefined },
          occurrences.read(),
        );
      }
      if (previousQuantity <= 1) await maybeRemoveDepletedStockpile(stockpile, services);
      await services.reloadStore();
      const roll = (services.getStore().instance.filmRoll || []).find((record) => record.uri === rollUri);
      services.renderLibrary();
      if (roll) services.openRoll(roll);
    },
  );
}

function frameList(roll: FilmRecord, services: FilmViewServices): { node: HTMLDivElement; render(): void } {
  const node = el("div", { class: "frame-list" });
  const render = () => {
    node.replaceChildren();
    const frames = framesForRoll(services.getStore(), roll.uri);
    if (!frames.length) node.append(el("p", { class: "muted small" }, "No frames linked yet."));
    const perFrame = new Map<number, number>();
    for (const frame of frames) {
      const number = frame.value.frameNumber as number | undefined;
      if (number != null) perFrame.set(number, (perFrame.get(number) || 0) + 1);
    }
    for (const frame of frames) {
      const number = frame.value.frameNumber as number | undefined;
      const multiple = number != null && (perFrame.get(number) || 0) > 1;
      const photoLabel = frame.value.photo ? "linked photo" : "no photo";
      const settings = [frame.value.aperture ? `ƒ/${frame.value.aperture}` : "", frame.value.shutterSpeed || ""]
        .filter(Boolean)
        .join(" ");
      node.append(
        el("div", { class: "frame-row row between" }, [
          el("span", { class: "row" }, [
            el(
              "span",
              { class: "frame-num" },
              number != null
                ? `#${number}${frame.value.frameExposureIndex ? `.${frame.value.frameExposureIndex}` : ""}`
                : "#?",
            ),
            multiple ? el("span", { class: "me-badge", title: "Multiple exposure" }, "ME") : null,
            el("span", { class: "muted small" }, settings || frame.value.note || photoLabel),
          ]),
          el(
            "button",
            {
              class: "ghost small-btn danger",
              title: "Remove frame",
              "aria-label": "Remove frame",
              onclick: async () => {
                await services.deleteRecord(frame.uri);
                await services.reloadStore();
                void syncRollExposureCount(roll.uri, services);
                render();
              },
            },
            [services.icon("trash", 14)],
          ),
        ]),
      );
    }
  };
  render();
  return { node, render };
}

function rollPhotoList(
  roll: FilmRecord,
  services: FilmViewServices,
): { node: HTMLDivElement; render(): Promise<void> } {
  const node = el("div", { class: "frame-list" });
  let photosByUri: Map<string, FilmRecord> | null = null;
  const render = async () => {
    const exposed = new Set(
      framesForRoll(services.getStore(), roll.uri)
        .map((exposure) => exposure.value.photo as string | undefined)
        .filter(Boolean),
    );
    const captures = services.getStore().photoCaptureByPhoto || new Map<string, FilmRecord>();
    const linked = [...captures.entries()]
      .filter(([uri, capture]) => capture.value.filmRoll === roll.uri && !exposed.has(uri))
      .sort(
        (left, right) =>
          (left[1].value.frameIndex ?? Number.POSITIVE_INFINITY) -
          (right[1].value.frameIndex ?? Number.POSITIVE_INFINITY),
      );
    if (!linked.length) {
      node.replaceChildren(el("p", { class: "muted small" }, "No photos tagged to this roll yet."));
      return;
    }
    if (!photosByUri) {
      try {
        photosByUri = new Map((await services.getPhotos()).map((photo) => [photo.uri, photo]));
      } catch {
        photosByUri = new Map();
      }
    }
    node.replaceChildren();
    for (const [uri, capture] of linked) {
      const frameNumber = capture.value.frameIndex;
      const photo = photosByUri.get(uri);
      const thumb = el("span", {
        class: "roll-photo-thumb",
        style:
          "width:34px;height:34px;border-radius:5px;background-color:var(--surface-2,#222);background-size:cover;background-position:center;flex:0 0 auto",
      });
      if (photo) {
        services
          .blobUrl(photo.value.photo)
          .then((url) => {
            if (url) thumb.style.backgroundImage = `url(${url})`;
          })
          .catch(() => {});
      }
      node.append(
        el("div", { class: "frame-row row between" }, [
          el("span", { class: "row", style: "gap:8px;align-items:center" }, [
            el("span", { class: "frame-num" }, frameNumber != null ? `#${frameNumber}` : "#—"),
            thumb,
            el("span", { class: "muted small" }, (photo?.value?.alt || "linked photo").slice(0, 60)),
          ]),
        ]),
      );
    }
  };
  void render();
  return { node, render };
}

function measureDisplay(measure: FilmValue | undefined): string | null {
  if (!measure || !Number.isFinite(Number(measure.value))) return null;
  const scale = Number(measure.scale) || 1;
  const value = Number(measure.value) / scale;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${measure.unit ? ` ${measure.unit}` : ""}`;
}

function relatedLabel(services: FilmViewServices, kind: string, uri: unknown): string | null {
  if (typeof uri !== "string" || !uri) return null;
  const record = services.getStore().byUri?.get(uri)?.item;
  return record ? record.value.nickname || services.instanceLabel(kind, record.value) : uri.split("/").at(-1) || null;
}

function processingHistory(roll: FilmRecord, services: FilmViewServices): { node: HTMLDivElement; render(): void } {
  const node = el("div", { class: "roll-processing" });
  const render = () => {
    const developments = (services.getStore().developSessions || [])
      .filter((session) => session.value.filmRolls?.includes(roll.uri))
      .map((session) => ({ kind: "develop" as const, session }));
    const scans = (services.getStore().digitizeSessions || [])
      .filter((session) => session.value.filmRolls?.includes(roll.uri))
      .map((session) => ({ kind: "scan" as const, session }));
    const entries = [...developments, ...scans].sort((left, right) => {
      const leftAt = left.session.value.finishedAt || left.session.value.createdAt || "";
      const rightAt = right.session.value.finishedAt || right.session.value.createdAt || "";
      return rightAt.localeCompare(leftAt);
    });
    if (!entries.length) {
      node.replaceChildren(
        el(
          "p",
          { class: "muted small" },
          "No processing sessions linked yet. Log a completed development or scan to associate chemistry and scanners with this roll.",
        ),
      );
      return;
    }
    node.replaceChildren();
    for (const { kind, session } of entries) {
      const value = session.value;
      const at = value.finishedAt || value.createdAt;
      const when = at ? new Date(at).toLocaleDateString() : "Date not recorded";
      const primaryStep = kind === "develop" ? primaryDevelopmentStep(value) : undefined;
      const detail =
        kind === "develop"
          ? [
              relatedLabel(
                services,
                "chemistry",
                Array.isArray(primaryStep?.chemistries) ? primaryStep.chemistries[0] : undefined,
              ),
              formatDevelopmentTime(primaryStep?.actualTimeSeconds),
              formatAgitation(primaryStep || value),
              formatDevelopmentStages(value, services),
            ]
              .filter(Boolean)
              .join(" · ")
          : [
              relatedLabel(services, "scanner", value.scanner),
              services.enumLabel(String(value.method || "")),
              measureDisplay(value.resolution),
            ]
              .filter(Boolean)
              .join(" · ");
      node.append(
        el(
          "button",
          {
            class: "roll-processing-row",
            type: "button",
            onclick: () => services.inspect(session),
            title: `Inspect ${kind === "develop" ? "development" : "scan"} session`,
          },
          [
            el("span", { class: `roll-processing-mark ${kind}` }, kind === "develop" ? "DEV" : "SCAN"),
            el("span", { class: "roll-processing-copy" }, [
              el("strong", {}, kind === "develop" ? "Development" : "Scan"),
              el("span", { class: "muted small" }, detail || "Session details not recorded"),
            ]),
            el("span", { class: "muted small mono roll-processing-date" }, when),
          ],
        ),
      );
    }
  };
  render();
  return { node, render };
}

export function openRollDetail(
  roll: FilmRecord,
  services: FilmViewServices,
  options: { onClose?: () => void } = {},
): ReturnType<typeof openModal> {
  const value = roll.value;
  const templateSelect = workflowSelect(services);
  const occurrences = createWorkflowOccurrenceEditor(
    templateSelect,
    services.getStore().workflowTemplates || [],
    services.stageLabels,
  );
  const statusSelect = el(
    "select",
    {},
    services.rollStatuses.map((status) => el("option", { value: status }, services.enumLabel(status))),
  );
  statusSelect.value = value.status || "loaded";
  const cameraSelect = services.instanceSelect("camera", value.camera || "");
  const developerSelect = services.instanceSelect("chemistry", value.developedWith || "");
  const labSelect = services.instanceSelect("labAccount", value.lab || "");
  const cassetteSelect = el("select", {}, [
    el("option", { value: "" }, "(none)"),
    ...services.cassetteTypes.map((cassette) => el("option", { value: cassette }, services.enumLabel(cassette))),
  ]);
  cassetteSelect.value = value.cassetteType || "";
  const isoInput = el("input", { type: "number", min: "1", value: value.shotAtIso || "" });
  const lifecycleDates = Object.fromEntries(
    ROLL_LIFECYCLE_DATES.map(([key, label]) => [key, dateField(label, value[key] || "")]),
  ) as Record<(typeof ROLL_LIFECYCLE_DATES)[number][0], ReturnType<typeof dateField>>;
  const developmentLocation = el("select", {}, [
    el("option", { value: "" }, "(not recorded)"),
    ...["home", "lab", "other"].map((location) => el("option", { value: location }, services.enumLabel(location))),
  ]);
  developmentLocation.value = value.developmentLocation || "";
  const frames = frameList(roll, services);
  const rollPhotos = rollPhotoList(roll, services);
  const processing = processingHistory(roll, services);
  const refreshProcessing = async () => {
    processing.render();
    const refreshed = (services.getStore().instance.filmRoll || []).find((candidate) => candidate.uri === roll.uri);
    if (refreshed?.value.developedWith) developerSelect.value = refreshed.value.developedWith;
    if (refreshed?.value.status) statusSelect.value = refreshed.value.status;
  };
  const processingActions = el("div", { class: "row wrap roll-processing-actions" }, [
    services.openCompletedDevelopment
      ? el(
          "button",
          {
            class: "ghost small-btn",
            type: "button",
            onclick: () => services.openCompletedDevelopment?.(roll, () => void refreshProcessing()),
          },
          [services.icon("check", 14), el("span", {}, "Log development")],
        )
      : null,
    services.openScanSession
      ? el(
          "button",
          {
            class: "ghost small-btn",
            type: "button",
            onclick: () => services.openScanSession?.(roll, () => void refreshProcessing()),
          },
          [services.icon("image", 14), el("span", {}, "Log scan")],
        )
      : null,
  ]);
  const addFrameButton = el(
    "button",
    {
      class: "ghost small-btn",
      type: "button",
      onclick: () =>
        openAddFrame(
          roll,
          () => {
            frames.render();
            void rollPhotos.render();
          },
          services,
        ),
    },
    [services.icon("plus", 14), el("span", {}, "Add frame")],
  );
  return openModal(
    `Roll · ${stockLabel(services, value.stock)}`,
    [
      field("Status", statusSelect),
      field("Loaded in camera", cameraSelect),
      field("Shot at ISO (push/pull)", isoInput),
      field("Developed with (home chemistry)", developerSelect),
      field("Developed at (lab)", labSelect),
      field("Development location", developmentLocation),
      field("Cassette", cassetteSelect),
      (services.getStore().workflowTemplates || []).length
        ? field("Start another workflow (optional)", templateSelect)
        : null,
      occurrences.node,
      el("div", { class: "row between wrap roll-processing-head" }, [
        el("h3", { class: "modal-sub" }, "Processing history"),
        processingActions,
      ]),
      processing.node,
      el("h3", { class: "modal-sub" }, "Lifecycle dates (optional)"),
      ...ROLL_LIFECYCLE_DATES.map(([key]) => lifecycleDates[key].wrap),
      el("h3", { class: "modal-sub" }, "Frames"),
      frames.node,
      el("div", { class: "row" }, [addFrameButton]),
      el("h3", { class: "modal-sub" }, "Photos on this roll"),
      rollPhotos.node,
    ],
    async () => {
      const record: FilmValue = { ...value, status: statusSelect.value, updatedAt: new Date().toISOString() };
      if (cameraSelect.value) {
        record.camera = cameraSelect.value;
      } else delete record.camera;
      if (developerSelect.value) record.developedWith = developerSelect.value;
      else delete record.developedWith;
      if (labSelect.value) record.lab = labSelect.value;
      else delete record.lab;
      if (developmentLocation.value) record.developmentLocation = developmentLocation.value;
      else delete record.developmentLocation;
      if (cassetteSelect.value) record.cassetteType = cassetteSelect.value;
      else delete record.cassetteType;
      const iso = Number.parseInt(isoInput.value, 10);
      if (Number.isFinite(iso)) record.shotAtIso = iso;
      else delete record.shotAtIso;
      for (const [key] of ROLL_LIFECYCLE_DATES) {
        const timestamp = localInputToIso(lifecycleDates[key].input.value);
        if (timestamp) record[key] = timestamp;
        else delete record[key];
      }
      await services.saveRecord(services.collections.filmRoll, record, roll);
      const template = (services.getStore().workflowTemplates || []).find((item) => item.uri === templateSelect.value);
      if (template && services.instantiateWorkflow) {
        await services.instantiateWorkflow(
          template,
          [
            {
              kind: value.status === "developed" ? "film-negative" : "film-roll-latent",
              ref: roll.uri,
              label: value.label,
            },
          ],
          { filmRoll: roll.uri, camera: record.camera },
          occurrences.read(),
        );
      }
      if (["exposed", "at-lab", "developing", "developed", "scanned", "archived"].includes(record.status)) {
        await services.reloadStore();
        await services.advanceWorkflowStage?.("capture", [roll.uri]);
      }
      await refreshFilm(services);
    },
    { onClose: options.onClose },
  );
}
