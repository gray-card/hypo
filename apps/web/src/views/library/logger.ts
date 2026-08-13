import { createRovingDial, el, field, toast } from "@hypo/ui";
import { createGearChips, createInitialShotLoggerState } from "./logger-controls.ts";
import { createMeterReadingField } from "./logger-readings.ts";
import { createLoggerLocationTracker } from "./logger-location.ts";
import { renderRecentExposures } from "./logger-recent.ts";
import type {
  LoggerGearKind,
  LoggerRecord,
  LoggerValue,
  ShotLoggerController,
  ShotLoggerDependencies,
} from "./logger-types.ts";

export { createRovingDial as createLoggerDial } from "@hypo/ui";

export type * from "./logger-types.ts";

const EV_SCALE = ["-3", "-2", "-1", "-2/3", "-1/3", "0", "+1/3", "+2/3", "+1", "+2", "+3"];

/** Build and mount the full-screen, offline-capable shot logger. */
export function openShotLoggerView(options: ShotLoggerDependencies): ShotLoggerController {
  const { shoot, gear, sticky = {} } = options;
  const { camera: cameras, lens: lenses, filter: filters, filmRoll: rolls } = gear;
  let store = options.store;
  const state = createInitialShotLoggerState(gear, sticky);
  const persistSticky = () => options.persistSticky(state);
  const pendingExposures = () => options.pendingExposures();
  const nextFrameNumber = (rollUri: string | null) => {
    if (!rollUri) return null;
    const stored = options.framesForRoll(rollUri).map((exposure) => exposure.value.frameNumber ?? 0);
    const queued = pendingExposures()
      .filter((write) => write.record.roll === rollUri)
      .map((write) => write.record.frameNumber ?? 0);
    return Math.max(0, ...stored, ...queued) + 1;
  };
  const countAtFrame = (rollUri: string, frameNumber: number) => {
    const stored = options
      .framesForRoll(rollUri)
      .filter((exposure) => exposure.value.frameNumber === frameNumber).length;
    const queued = pendingExposures().filter(
      (write) => write.record.roll === rollUri && write.record.frameNumber === frameNumber,
    ).length;
    return stored + queued;
  };
  const pickRollFor = (cameraUri: string | null) =>
    rolls.find((roll) => roll.value.camera === cameraUri)?.uri || rolls[0]?.uri || null;
  if (!state.roll) state.roll = pickRollFor(state.camera);

  const overlay = el("div", { class: "logger-overlay" });
  const gpsPill = el("span", { class: "gps-pill" }, "GPS…");
  const locationTracker = createLoggerLocationTracker(() => state.gps, gpsPill);

  const frameLabel = el("span", { class: "logger-frame" });
  const recent = el("div", { class: "logger-recent" });
  const refreshFrame = () => {
    const frameNumber = nextFrameNumber(state.roll);
    const roll = rolls.find((candidate) => candidate.uri === state.roll);
    frameLabel.textContent = state.roll
      ? `${roll ? options.filmStockLabel(roll.value.stock as string | undefined) : "Roll"} · frame ${frameNumber}`
      : "Digital · no roll";
  };
  const renderRecent = () => {
    const stored = state.roll
      ? options.framesForRoll(state.roll)
      : (store.instance.exposure || []).filter((exposure) => exposure.value.shoot === shoot.uri);
    const queued = pendingExposures().filter((write) =>
      state.roll ? write.record.roll === state.roll : write.record.shoot === shoot.uri,
    );
    renderRecentExposures(recent, stored, queued);
  };
  let closed = false;
  const unsubscribePending =
    options.subscribePendingAcknowledgements?.(async () => {
      if (closed) return;
      renderRecent();
      store = await options.reloadStore();
      if (closed) return;
      options.onStoreReloaded(store);
      refreshFrame();
      renderRecent();
    }) || (() => {});

  let updateSameButton = () => {};
  let renderStickySummary = () => {};
  const cameraChips = createGearChips(
    cameras,
    "camera",
    () => state.camera,
    (uri) => {
      state.camera = uri;
      state.roll = pickRollFor(uri);
      state.lastFrame = null;
      persistSticky();
      refreshFrame();
      renderRecent();
      updateSameButton();
      rollChips.paint();
      renderStickySummary();
    },
    options.instanceLabel,
  );
  const rollChips = createGearChips(
    rolls,
    "filmRoll",
    () => state.roll,
    (uri) => {
      state.roll = uri;
      state.lastFrame = null;
      persistSticky();
      refreshFrame();
      renderRecent();
      updateSameButton();
      renderStickySummary();
    },
    options.instanceLabel,
    true,
  );
  const lensChips = createGearChips(
    lenses,
    "lens",
    () => state.lens,
    (uri) => {
      state.lens = uri;
      persistSticky();
      renderStickySummary();
    },
    options.instanceLabel,
  );
  const filterChips = createGearChips(
    filters,
    "filter",
    () => state.filter,
    (uri) => {
      state.filter = uri;
      persistSticky();
      renderStickySummary();
    },
    options.instanceLabel,
    true,
  );

  const activeLensType = () => {
    const lens = lenses.find((candidate) => candidate.uri === state.lens);
    return lens && store.catalog.lensType?.find((type) => type.uri === lens.value.type)?.value;
  };
  const activeCameraType = () => {
    const camera = cameras.find((candidate) => candidate.uri === state.camera);
    return camera && store.catalog.cameraType?.find((type) => type.uri === camera.value.type)?.value;
  };
  const clampDial = (get: () => string | null, set: (value: string | null) => void, values: readonly string[]) => {
    const current = get();
    if (current && !values.includes(current)) set(null);
  };
  const apertureOptions = () => options.buildApertureOptions(activeLensType(), state.apertureStopFraction);
  const shutterOptions = () => options.buildShutterOptions(activeCameraType(), state.shutterStopFraction);

  const apertureIncrement = el(
    "select",
    { class: "logger-select logger-inc", "aria-label": "Aperture stop increment" },
    options.stopFractions.map((fraction) => el("option", { value: fraction }, `${fraction} stop`)),
  );
  apertureIncrement.value = state.apertureStopFraction;
  const shutterIncrement = el(
    "select",
    { class: "logger-select logger-inc", "aria-label": "Shutter speed stop increment" },
    options.stopFractions.map((fraction) => el("option", { value: fraction }, `${fraction} stop`)),
  );
  shutterIncrement.value = state.shutterStopFraction;

  const apertureRow = el("div");
  const renderApertures = () => {
    const values = apertureOptions();
    clampDial(
      () => state.aperture,
      (value) => {
        state.aperture = value;
        persistSticky();
      },
      values,
    );
    apertureRow.replaceChildren(
      createRovingDial(
        values,
        () => state.aperture,
        (value) => {
          state.aperture = value;
          persistSticky();
        },
        { label: "Aperture", valueText: (value) => `f/${value}` },
      ),
    );
    apertureIncrement.classList.toggle("hidden", options.usesExactApertureSteps(activeLensType()));
  };
  const shutterRow = el("div");
  const renderShutters = () => {
    const values = shutterOptions();
    clampDial(
      () => state.shutter,
      (value) => {
        state.shutter = value;
        persistSticky();
      },
      values,
    );
    shutterRow.replaceChildren(
      createRovingDial(
        values,
        () => state.shutter,
        (value) => {
          state.shutter = value;
          persistSticky();
        },
        { label: "Shutter speed", valueText: (value) => value },
      ),
    );
    shutterIncrement.classList.toggle("hidden", options.usesExactShutterSteps(activeCameraType()));
  };
  apertureIncrement.addEventListener("change", () => {
    state.apertureStopFraction = apertureIncrement.value;
    persistSticky();
    renderApertures();
  });
  shutterIncrement.addEventListener("change", () => {
    state.shutterStopFraction = shutterIncrement.value;
    persistSticky();
    renderShutters();
  });
  renderApertures();
  renderShutters();

  const stickySummary = el("div", { class: "logger-sticky-summary", "aria-live": "polite" });
  const stickyItemLabel = (items: readonly LoggerRecord[], kind: LoggerGearKind, uri: string | null) => {
    const item = items.find((candidate) => candidate.uri === uri);
    return item ? options.instanceLabel(kind, item.value) : null;
  };
  renderStickySummary = () => {
    stickySummary.textContent = [
      stickyItemLabel(cameras, "camera", state.camera),
      stickyItemLabel(lenses, "lens", state.lens),
      stickyItemLabel(rolls, "filmRoll", state.roll),
      stickyItemLabel(filters, "filter", state.filter),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const {
    select: readingSelect,
    status: readingStatus,
    populate: populateMeterReadings,
  } = createMeterReadingField({
    load: options.loadMeterReadings,
    pendingCount: options.pendingMeterReadingCount,
    filmStockLabel: options.filmStockLabel,
  });

  const noteInput = el("input", { type: "text", class: "logger-note", placeholder: "Note (optional)" });
  noteInput.addEventListener("input", () => {
    state.note = noteInput.value;
  });
  const gpsToggle = el("button", { class: "ghost small-btn logger-optin", type: "button", "aria-pressed": "false" }, [
    options.icon("map-pin", 14),
    el("span", {}, "Add location"),
  ]);
  gpsToggle.classList.toggle("on", state.gps);
  gpsToggle.addEventListener("click", () => {
    state.gps = !state.gps;
    gpsToggle.classList.toggle("on", state.gps);
    gpsToggle.setAttribute("aria-pressed", String(state.gps));
    if (state.gps) locationTracker.start();
    else {
      locationTracker.stop();
      locationTracker.clear();
    }
    locationTracker.syncPill();
  });
  const flashToggle = el(
    "button",
    { class: "ghost small-btn logger-optin", type: "button", "aria-pressed": String(state.flash) },
    "Flash",
  );
  flashToggle.classList.toggle("on", state.flash);
  flashToggle.addEventListener("click", () => {
    state.flash = !state.flash;
    flashToggle.classList.toggle("on", state.flash);
    flashToggle.setAttribute("aria-pressed", String(state.flash));
    persistSticky();
  });
  const meterSelect = el(
    "select",
    { class: "logger-select" },
    options.meteringModes.map((mode) => el("option", { value: mode }, options.enumLabel(mode))),
  );
  meterSelect.value = state.metering;
  meterSelect.addEventListener("change", () => {
    state.metering = meterSelect.value;
    persistSticky();
  });

  const quickToggle = el(
    "button",
    { class: "ghost small-btn logger-mode-btn", type: "button", "aria-pressed": String(state.quick) },
    "Quick",
  );
  const syncQuickMode = () => {
    overlay.classList.toggle("quick", state.quick);
    quickToggle.setAttribute("aria-pressed", String(state.quick));
    quickToggle.textContent = state.quick ? "Full controls" : "Quick mode";
  };
  quickToggle.addEventListener("click", () => {
    state.quick = !state.quick;
    persistSticky();
    syncQuickMode();
  });

  const sameButton = el("button", { class: "log-btn secondary", type: "button" }, "+ Same frame");
  const logButton = el("button", { class: "log-btn" }, [options.icon("camera", 18), el("span", {}, "Log frame")]);
  updateSameButton = () => {
    sameButton.classList.toggle("hidden", !(state.roll && state.lastFrame != null));
  };

  const logExposure = (sameFrame = false) => {
    const now = new Date().toISOString();
    const record: LoggerValue = { shoot: shoot.uri, createdAt: now, takenAt: now };
    if (state.camera) record.camera = state.camera;
    if (state.lens) record.lens = state.lens;
    if (state.filter) record.filter = state.filter;
    if (state.roll) {
      if (sameFrame && state.lastFrame != null) {
        record.roll = state.roll;
        record.frameNumber = state.lastFrame;
        record.frameExposureIndex = countAtFrame(state.roll, state.lastFrame) + 1;
        record.multipleExposure = true;
      } else {
        const frameNumber = nextFrameNumber(state.roll);
        record.roll = state.roll;
        record.frameNumber = frameNumber;
        record.frameExposureIndex = 1;
        state.lastFrame = frameNumber;
      }
    } else if (sameFrame) record.multipleExposure = true;
    if (state.aperture) record.aperture = state.aperture;
    if (state.shutter) record.shutterSpeed = state.shutter;
    if (state.ev && state.ev !== "0") record.exposureCompensation = state.ev;
    if (state.metering) record.meteringMode = state.metering;
    if (state.flash) record.flash = true;
    if (state.gps && locationTracker.value) record.location = locationTracker.value;
    if (readingSelect.value) record.meterReadings = [readingSelect.value];
    if (state.note.trim()) record.note = state.note.trim();
    options.enqueueExposure(record);
    state.note = "";
    noteInput.value = "";
    readingSelect.value = "";
    refreshFrame();
    renderRecent();
    updateSameButton();
    const button = sameFrame ? sameButton : logButton;
    button.classList.add("flash");
    setTimeout(() => button.classList.remove("flash"), 220);
    const online = options.isOnline();
    toast(
      online ? (sameFrame ? "Stacked on frame ✓" : "Logged ✓") : "Logged offline — will sync",
      online ? "ok" : "info",
      1800,
    );
    const flushing = options.flush();
    if (!options.subscribePendingAcknowledgements) {
      flushing.then(async (result) => {
        if (!result.sent) return;
        store = await options.reloadStore();
        options.onStoreReloaded(store);
        renderRecent();
      });
    }
    return record;
  };
  logButton.addEventListener("click", () => logExposure(false));
  sameButton.addEventListener("click", () => logExposure(true));

  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribePending();
    locationTracker.stop();
    overlay.remove();
    // Repaint immediately from the remote-plus-pending projection. A cache
    // refresh must not keep the dismissed logger's underlying view stale.
    options.onClose?.();
    void options
      .reloadStore()
      .then((reloaded) => {
        store = reloaded;
        options.onStoreReloaded(store);
      })
      .catch((error) => console.warn("Shot logger store refresh failed:", error?.message || error));
  };

  overlay.append(
    el("div", { class: "logger-top row between" }, [
      el("div", { class: "row" }, [el("strong", {}, shoot.value.label || "Shoot"), gpsPill]),
      el("div", { class: "row" }, [quickToggle, el("button", { class: "ghost small-btn", onclick: close }, "Done")]),
    ]),
    frameLabel,
    stickySummary,
    el("div", { class: "logger-scroll" }, [
      cameras.length > 1
        ? el("div", { class: "logger-group logger-extended" }, [
            el("span", { class: "logger-lab" }, "Camera"),
            cameraChips.row,
          ])
        : null,
      rolls.length
        ? el("div", { class: "logger-group logger-extended" }, [
            el("span", { class: "logger-lab" }, "Roll"),
            rollChips.row,
          ])
        : null,
      el("div", { class: "logger-group logger-extended" }, [
        el("span", { class: "logger-lab" }, "Lens"),
        lensChips.row,
      ]),
      filters.length
        ? el("div", { class: "logger-group logger-extended" }, [
            el("span", { class: "logger-lab" }, "Filter"),
            filterChips.row,
          ])
        : null,
      el("div", { class: "logger-group" }, [
        el("span", { class: "logger-lab row" }, ["Aperture ƒ/", apertureIncrement]),
        apertureRow,
      ]),
      el("div", { class: "logger-group" }, [
        el("span", { class: "logger-lab row" }, ["Shutter", shutterIncrement]),
        shutterRow,
      ]),
      el("div", { class: "logger-group" }, [
        el("span", { class: "logger-lab" }, "Exposure comp (EV)"),
        createRovingDial(
          EV_SCALE,
          () => state.ev,
          (value) => {
            state.ev = value;
            persistSticky();
          },
          { label: "Exposure compensation", valueText: (value) => `${value} EV` },
        ),
      ]),
      el("div", { class: "logger-quick-tools" }, [
        el("label", { class: "logger-group logger-meter-field", for: "logger-meter-reading" }, [
          el("span", { class: "logger-lab" }, "Attach meter reading"),
          readingSelect,
          readingStatus,
        ]),
        flashToggle,
        gpsToggle,
      ]),
      el("div", { class: "logger-group row logger-extended" }, [field("Metering", meterSelect)]),
      el("div", { class: "logger-extended" }, [noteInput]),
      el("div", { class: "logger-extended" }, [recent]),
    ]),
    el("div", { class: "log-actions" }, [sameButton, logButton]),
  );
  lensChips.row.addEventListener("click", renderApertures);
  cameraChips.row.addEventListener("click", renderShutters);
  document.body.append(overlay);
  refreshFrame();
  renderRecent();
  updateSameButton();
  locationTracker.syncPill();
  renderStickySummary();
  syncQuickMode();
  persistSticky();
  void populateMeterReadings();
  return { overlay, state, close, logExposure };
}
