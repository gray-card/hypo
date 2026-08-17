import {
  formatFramesShutterSpeed,
  framesExposureProgram,
  framesLocation,
  framesMeteringMode,
  inferFrameShoots,
  parseFramesArchive,
  type FrameClusteringSensitivity,
  type FrameShootCluster,
  type FramesArchive,
  type FramesFrame,
} from "@hypo/domain";
import { el, field, openModal, toast } from "@hypo/ui";
import { syncRollExposureCount } from "./film-frame.ts";
import { filmStockLabel } from "./film-helpers.ts";
import type { FilmValue, FilmViewServices } from "./film-types.ts";

interface EditableCluster {
  frames: FramesFrame[];
  startedAt?: string;
  endedAt?: string;
  boundaryBefore?: FrameShootCluster["boundaryBefore"];
  label: string;
}

interface ArchiveImportState {
  readonly archive: FramesArchive;
  readonly rollSelect: HTMLSelectElement;
  readonly cameraSelect: HTMLSelectElement;
  readonly sensitivitySelect: HTMLSelectElement;
  readonly createShoots: HTMLInputElement;
  readonly useLocation: HTMLInputElement;
  readonly clustersNode: HTMLDivElement;
  clusters: EditableCluster[];
}

const normalize = (value: unknown) =>
  String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const compactDate = (iso: string | undefined, timeZone?: string): string => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Undated";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      timeZone: timeZone || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
};

const compactTime = (iso: string | undefined, timeZone?: string): string => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
};

const clusterLabel = (
  archive: FramesArchive,
  cluster: FrameShootCluster,
  index: number,
  total: number,
  duplicateDate = false,
): string => {
  const first = cluster.frames[0];
  const timeZone = first?.timeZoneIdentifier || first?.placemark?.timeZoneIdentifier || undefined;
  const date = compactDate(cluster.startedAt, timeZone);
  if (total <= 1) return archive.name;
  const suffix = duplicateDate ? `${date}, ${compactTime(cluster.startedAt, timeZone)}` : date;
  return `${archive.name} · ${suffix || `Shoot ${index + 1}`}`;
};

function inferredClusters(
  archive: FramesArchive,
  sensitivity: FrameClusteringSensitivity,
  useLocation = true,
): EditableCluster[] {
  const result = inferFrameShoots(archive.frames, { sensitivity, useLocation });
  const dateKeys = result.clusters.map((cluster) => {
    const frame = cluster.frames[0];
    return compactDate(
      cluster.startedAt,
      frame?.timeZoneIdentifier || frame?.placemark?.timeZoneIdentifier || undefined,
    );
  });
  return result.clusters.map((cluster, index) => ({
    frames: [...cluster.frames],
    startedAt: cluster.startedAt,
    endedAt: cluster.endedAt,
    boundaryBefore: cluster.boundaryBefore,
    label: clusterLabel(
      archive,
      cluster,
      index,
      result.clusters.length,
      dateKeys.filter((date) => date === dateKeys[index]).length > 1,
    ),
  }));
}

function formatGap(seconds: number): string {
  if (seconds >= 86400) return `${Number((seconds / 86400).toFixed(1))} days`;
  if (seconds >= 3600) return `${Number((seconds / 3600).toFixed(1))} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

function frameRange(cluster: EditableCluster): string {
  const numbers = cluster.frames.map((frame) => Number(frame.number)).filter((number) => Number.isFinite(number));
  if (!numbers.length) return `${cluster.frames.length} frame${cluster.frames.length === 1 ? "" : "s"}`;
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return first === last ? `Frame ${first}` : `Frames ${first}–${last}`;
}

function renderClusters(state: ArchiveImportState): void {
  const render = () => renderClusters(state);
  state.clustersNode.replaceChildren();
  state.clusters.forEach((cluster, index) => {
    const label = el("input", { type: "text", value: cluster.label, maxlength: "128", "aria-label": "Shoot label" });
    label.addEventListener("input", () => (cluster.label = label.value));
    const actions = el("div", { class: "row wrap frames-cluster-actions" });
    if (index > 0) {
      actions.append(
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn",
            onclick: () => {
              const previous = state.clusters[index - 1]!;
              previous.frames.push(...cluster.frames);
              previous.endedAt = cluster.endedAt || previous.endedAt;
              state.clusters.splice(index, 1);
              render();
            },
          },
          "Merge with previous",
        ),
      );
    }
    if (cluster.frames.length > 1) {
      const splitSelect = el(
        "select",
        { "aria-label": `Split ${cluster.label} after frame` },
        cluster.frames
          .slice(0, -1)
          .map((frame, frameIndex) =>
            el(
              "option",
              { value: String(frameIndex + 1) },
              `After ${Number.isFinite(Number(frame.number)) ? `frame ${frame.number}` : `item ${frameIndex + 1}`}`,
            ),
          ),
      );
      actions.append(
        splitSelect,
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn",
            onclick: () => {
              const splitAt = Number.parseInt(splitSelect.value, 10);
              if (!Number.isFinite(splitAt) || splitAt <= 0 || splitAt >= cluster.frames.length) return;
              const rightFrames = cluster.frames.splice(splitAt);
              const right: EditableCluster = {
                frames: rightFrames,
                startedAt: rightFrames[0]?.createdAt || undefined,
                endedAt: rightFrames.at(-1)?.createdAt || undefined,
                label: `${state.archive.name} · ${compactDate(rightFrames[0]?.createdAt || undefined)}`,
              };
              cluster.endedAt = cluster.frames.at(-1)?.createdAt || cluster.startedAt;
              state.clusters.splice(index + 1, 0, right);
              render();
            },
          },
          "Split",
        ),
      );
    }
    state.clustersNode.append(
      el("section", { class: "frames-cluster-card" }, [
        cluster.boundaryBefore
          ? el(
              "div",
              { class: "frames-gap-marker mono" },
              `${formatGap(cluster.boundaryBefore.gapSeconds)} since the previous frame${cluster.boundaryBefore.distanceKm != null ? ` · ${Number(cluster.boundaryBefore.distanceKm.toFixed(1))} km away` : ""}`,
            )
          : null,
        field("Shoot name", label),
        el("div", { class: "row wrap muted small frames-cluster-meta" }, [
          el(
            "span",
            {},
            `${frameRange(cluster)} · ${cluster.frames.length} exposure${cluster.frames.length === 1 ? "" : "s"}`,
          ),
          cluster.startedAt
            ? el(
                "span",
                {},
                `${compactDate(cluster.startedAt, cluster.frames[0]?.timeZoneIdentifier || undefined)} · ${compactTime(cluster.startedAt, cluster.frames[0]?.timeZoneIdentifier || undefined)}–${compactTime(cluster.endedAt, cluster.frames.at(-1)?.timeZoneIdentifier || undefined)}`,
              )
            : null,
        ]),
        actions,
      ]),
    );
  });
}

function rollOptions(services: FilmViewServices): HTMLOptionElement[] {
  return [
    el("option", { value: "" }, "Choose a roll…"),
    ...(services.getStore().instance.filmRoll || []).map((roll) =>
      el(
        "option",
        { value: roll.uri },
        roll.value.label
          ? `${roll.value.label} · ${filmStockLabel(services.getStore(), roll.value.stock, services.catalogLabel)}`
          : filmStockLabel(services.getStore(), roll.value.stock, services.catalogLabel),
      ),
    ),
  ];
}

function preselectedRoll(archive: FramesArchive, services: FilmViewServices): string {
  const target = normalize(archive.name);
  const candidates = (services.getStore().instance.filmRoll || []).filter((roll) => {
    const label = normalize(roll.value.label);
    return label && (label === target || label.includes(target) || target.includes(label));
  });
  return candidates.length === 1 ? candidates[0]!.uri : "";
}

function preselectedCamera(archive: FramesArchive, services: FilmViewServices): string {
  if (!archive.camera) return "";
  const matches =
    services.matchGear({ make: archive.camera.make, model: archive.camera.model }).camera?.instances || [];
  if (archive.camera.serial) {
    const serialMatch = (services.getStore().instance.camera || []).find(
      (record) =>
        matches.some((match: FilmValue) => match.uri === record.uri) &&
        normalize(record.value.serialNumber) === normalize(archive.camera?.serial),
    );
    if (serialMatch) return serialMatch.uri;
  }
  return matches.length === 1 ? matches[0]!.uri : "";
}

function uniqueGearMatch(
  kind: "lens" | "camera",
  gear: FramesArchive["camera"] | FramesFrame["lens"],
  services: FilmViewServices,
): string | undefined {
  if (!gear) return undefined;
  const match = services.matchGear(
    kind === "lens" ? { lensMake: gear.make, lensModel: gear.model } : { make: gear.make, model: gear.model },
  )[kind];
  if (!match?.instances?.length) return undefined;
  if (gear.serial) {
    const serial = normalize(gear.serial);
    const record = (services.getStore().instance[kind] || []).find(
      (candidate) =>
        match.instances.some((item: FilmValue) => item.uri === candidate.uri) &&
        normalize(candidate.value.serialNumber) === serial,
    );
    if (record) return record.uri;
  }
  return match.instances.length === 1 ? match.instances[0]!.uri : undefined;
}

function exposureValue(
  archive: FramesArchive,
  frame: FramesFrame,
  options: {
    readonly roll: string;
    readonly shoot?: string;
    readonly camera?: string;
    readonly includeLocation: boolean;
    readonly assertedAt: string;
  },
  services: FilmViewServices,
): FilmValue {
  const value: FilmValue = {
    roll: options.roll,
    shoot: options.shoot,
    camera: options.camera,
    lens: uniqueGearMatch("lens", frame.lens, services),
    frameNumber: Number.isFinite(Number(frame.number)) ? Math.max(0, Math.round(Number(frame.number))) : undefined,
    aperture: Number.isFinite(Number(frame.aperture)) ? String(frame.aperture) : undefined,
    shutterSpeed: formatFramesShutterSpeed(frame.shutterSpeed),
    focalLength: Number.isFinite(Number(frame.focal)) ? Math.max(1, Math.round(Number(frame.focal))) : undefined,
    focusDistance:
      typeof frame.focusDistance === "string"
        ? frame.focusDistance
        : Number.isFinite(Number(frame.focusDistance))
          ? `${Number(frame.focusDistance)}m`
          : undefined,
    meteringMode: framesMeteringMode(frame.meteringMode),
    exposureProgram: framesExposureProgram(frame.exposureProgram),
    exposureCompensation:
      Number.isFinite(Number(frame.exposure)) && Number(frame.exposure) !== 0
        ? `${Number(frame.exposure) > 0 ? "+" : ""}${Number(frame.exposure)}`
        : undefined,
    flash: typeof frame.hasFlash === "boolean" ? frame.hasFlash : undefined,
    shotAtIso: Number.isFinite(Number(archive.iso || archive.stock?.iso))
      ? Math.max(1, Math.round(Number(archive.iso || archive.stock?.iso)))
      : undefined,
    takenAt: frame.createdAt || undefined,
    timeZone: frame.timeZoneIdentifier || frame.placemark?.timeZoneIdentifier || undefined,
    location: options.includeLocation ? framesLocation(frame) : undefined,
    sourceIdentifier: frame.id ? `frames:${frame.id}` : undefined,
    provenance: {
      confidence: "certain",
      assertedAt: options.assertedAt,
      note: `Imported from ${archive.sourceName}`.slice(0, 500),
    },
    note: frame.notes || undefined,
    createdAt: options.assertedAt,
  };
  return Object.fromEntries(Object.entries(value).filter(([, candidate]) => candidate !== undefined));
}

function shootValue(
  state: ArchiveImportState,
  cluster: EditableCluster,
  roll: string,
  assertedAt: string,
  services: FilmViewServices,
): FilmValue {
  const lenses = [
    ...new Set(cluster.frames.map((frame) => uniqueGearMatch("lens", frame.lens, services)).filter(Boolean)),
  ];
  return {
    label: cluster.label.trim() || state.archive.name,
    startedAt: cluster.startedAt,
    endedAt: cluster.endedAt,
    cameras: state.cameraSelect.value ? [state.cameraSelect.value] : undefined,
    lenses: lenses.length ? lenses : undefined,
    rolls: [roll],
    provenance: {
      source: "inferred",
      confidence: "likely",
      assertedAt,
      note: "Shoot boundaries inferred from consecutive .frames time and location gaps with a two-regime common-shape gamma mixture; reviewed during import.",
    },
    createdAt: assertedAt,
  };
}

export async function readFramesFiles(files: Iterable<File>): Promise<FramesArchive[]> {
  const archives: FramesArchive[] = [];
  for (const file of files) {
    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} is not valid JSON`);
    }
    archives.push(parseFramesArchive(value, file.name));
  }
  return archives;
}

export function openFramesImportReview(archives: readonly FramesArchive[], services: FilmViewServices) {
  if (!archives.length) throw new Error("Choose at least one .frames file");
  const includeLocations = el("input", { type: "checkbox" });
  const states: ArchiveImportState[] = archives.map((archive) => {
    const rollSelect = el("select", { "aria-label": `Roll for ${archive.name}` }, rollOptions(services));
    rollSelect.value = preselectedRoll(archive, services);
    const cameraSelect = services.instanceSelect("camera", preselectedCamera(archive, services));
    cameraSelect.setAttribute("aria-label", `Camera for ${archive.name}`);
    const sensitivitySelect = el(
      "select",
      { "aria-label": `Shoot sensitivity for ${archive.name}` },
      [
        ["conservative", "Fewer shoots"],
        ["balanced", "Balanced"],
        ["detailed", "More shoots"],
      ].map(([value, label]) => el("option", { value }, label)),
    );
    sensitivitySelect.value = "balanced";
    const createShoots = el("input", { type: "checkbox", checked: true });
    const useLocation = el("input", { type: "checkbox", checked: true });
    const clustersNode = el("div", { class: "frames-clusters" });
    const state: ArchiveImportState = {
      archive,
      rollSelect,
      cameraSelect,
      sensitivitySelect,
      createShoots,
      useLocation,
      clustersNode,
      clusters: inferredClusters(archive, "balanced", true),
    };
    const reinfer = () => {
      state.clusters = inferredClusters(
        archive,
        sensitivitySelect.value as FrameClusteringSensitivity,
        useLocation.checked,
      );
      renderClusters(state);
    };
    sensitivitySelect.addEventListener("change", () => {
      reinfer();
    });
    useLocation.addEventListener("change", reinfer);
    createShoots.addEventListener("change", () => {
      clustersNode.classList.toggle("hidden", !createShoots.checked);
    });
    renderClusters(state);
    return state;
  });

  const existingSourceIds = new Set(
    (services.getStore().instance.exposure || [])
      .map((record) => record.value.sourceIdentifier)
      .filter((value): value is string => typeof value === "string" && Boolean(value)),
  );
  const duplicateCount = archives
    .flatMap((archive) => archive.frames)
    .filter((frame) => frame.id && existingSourceIds.has(`frames:${frame.id}`)).length;
  const totalFrames = archives.reduce((sum, archive) => sum + archive.frames.length, 0);

  return openModal(
    archives.length === 1 ? `Import ${archives[0]!.name}` : `Import ${archives.length} .frames files`,
    [
      el(
        "p",
        { class: "muted small" },
        "Each file becomes exposures on the roll you choose. Hypo proposes shoots from the pauses between frames; review, merge, or split them before importing.",
      ),
      duplicateCount
        ? el(
            "p",
            { class: "notice small" },
            `${duplicateCount} frame${duplicateCount === 1 ? "" : "s"} already imported will be skipped.`,
          )
        : null,
      el("label", { class: "check-row frames-location-choice" }, [
        includeLocations,
        el("span", {}, [
          el("strong", {}, "Publish frame locations"),
          el(
            "span",
            { class: "muted small" },
            " Off by default. Location and altitude are written to your public PDS only when selected.",
          ),
        ]),
      ]),
      ...states.map((state) => {
        const archive = state.archive;
        const timed = archive.frames.filter((frame) => frame.createdAt);
        const stock = [archive.stock?.make, archive.stock?.model, archive.iso ? `ISO ${archive.iso}` : null]
          .filter(Boolean)
          .join(" · ");
        return el("section", { class: "frames-import-file" }, [
          el("div", { class: "row between wrap frames-import-heading" }, [
            el("div", {}, [
              el("h3", { class: "modal-sub" }, archive.name),
              el(
                "div",
                { class: "muted small" },
                `${archive.frames.length} frames${stock ? ` · ${stock}` : ""}${timed.length ? ` · ${compactDate(timed[0]?.createdAt || undefined)}–${compactDate(timed.at(-1)?.createdAt || undefined)}` : ""}`,
              ),
            ]),
            el("span", { class: "mono status-chip" }, archive.sourceName),
          ]),
          el("div", { class: "frames-import-assignment" }, [
            field("Film roll", state.rollSelect),
            field("Camera", state.cameraSelect),
            field("Shoot inference", state.sensitivitySelect),
          ]),
          el("label", { class: "check-row frames-shoot-choice" }, [
            state.createShoots,
            el("span", {}, "Create and link the proposed shoots"),
          ]),
          el("label", { class: "check-row frames-shoot-choice" }, [
            state.useLocation,
            el("span", {}, [
              el("span", {}, "Use location to refine shoot boundaries"),
              el(
                "span",
                { class: "muted small" },
                " Coordinates are analyzed in this browser and are not published unless the location option above is also selected.",
              ),
            ]),
          ]),
          state.clustersNode,
        ]);
      }),
    ],
    async () => {
      for (const state of states) {
        if (!state.rollSelect.value) throw new Error(`Choose a film roll for ${state.archive.name}`);
      }
      const assertedAt = new Date().toISOString();
      const touchedRolls = new Set<string>();
      let imported = 0;
      let shoots = 0;
      for (const state of states) {
        const roll = state.rollSelect.value;
        touchedRolls.add(roll);
        for (const cluster of state.clusters) {
          const newFrames = cluster.frames.filter((frame) => {
            const sourceIdentifier = frame.id ? `frames:${frame.id}` : undefined;
            return !sourceIdentifier || !existingSourceIds.has(sourceIdentifier);
          });
          if (!newFrames.length) continue;
          let shoot: string | undefined;
          if (state.createShoots.checked) {
            const importCluster: EditableCluster = {
              ...cluster,
              frames: newFrames,
              startedAt: newFrames[0]?.createdAt || cluster.startedAt,
              endedAt: newFrames.at(-1)?.createdAt || cluster.endedAt,
            };
            shoot = await services.saveRecord(
              services.collections.capture,
              shootValue(state, importCluster, roll, assertedAt, services),
              null,
            );
            shoots += 1;
          }
          for (const frame of newFrames) {
            const sourceIdentifier = frame.id ? `frames:${frame.id}` : undefined;
            await services.saveRecord(
              services.collections.exposure,
              exposureValue(
                state.archive,
                frame,
                {
                  roll,
                  shoot,
                  camera: state.cameraSelect.value || undefined,
                  includeLocation: includeLocations.checked,
                  assertedAt,
                },
                services,
              ),
              null,
            );
            if (sourceIdentifier) existingSourceIds.add(sourceIdentifier);
            imported += 1;
          }
        }
      }
      await services.reloadStore();
      for (const roll of touchedRolls) await syncRollExposureCount(roll, services);
      await services.reloadStore();
      services.renderLibrary();
      toast(
        imported
          ? `Imported ${imported} frame${imported === 1 ? "" : "s"}${shoots ? ` into ${shoots} shoot${shoots === 1 ? "" : "s"}` : ""}`
          : "Every frame was already imported",
        "ok",
      );
    },
    { saveLabel: `Import ${totalFrames - duplicateCount} frame${totalFrames - duplicateCount === 1 ? "" : "s"}` },
  );
}

export function openFramesFilePicker(services: FilmViewServices): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".frames,application/json";
  input.multiple = true;
  input.addEventListener(
    "change",
    async () => {
      try {
        const archives = await readFramesFiles(input.files || []);
        if (archives.length) openFramesImportReview(archives, services);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "err");
      }
    },
    { once: true },
  );
  input.click();
}
