// library.js: graycard types, instances, workflows UI
import {
  NS,
  loadStore,
  saveRecord,
  deleteRecord,
  catalogLabel,
  instanceLabel,
  displayToScaled,
  displayToMeasure,
  scaledToDisplay,
  measureToDisplay,
  chemistryRoles,
  saveWorkflowTemplate,
  splitRollFromStockpile,
} from "../graycard.js";
import { el, toast, isAdvanced, autocomplete, openModal, showView } from "./dom.js";
import { locationField } from "./mapView.js";
import { blobUrl, getPhotos, recordStore } from "../grain.js";
import {
  STAGE_LABELS,
  STAGE_PROCESS_KIND,
  cancelWorkflowRun,
  MEDIUMS,
  completeWorkflowStageAndAdvance,
  findNextActionableStage,
  getActionableWorkflowStages,
  instantiateWorkflowTemplate,
  skipWorkflowStageAndAdvance,
} from "../workflow.js";
import {
  PRESETS,
  MANUFACTURERS,
  FIELD_ENUMS,
  ENUMS,
  loadCatalogPresets,
  presetCatalogStatus,
} from "../data/presets.js";
import { loadDevRecipes } from "../devRecipes.js";
import { catalogImageUrl } from "../data/catalogImage.js";
import { openInspector } from "./inspect.js";
import { instanceImageUrl } from "../data/gearImage.js";
import { kindLabel, kindLabelPlural, enumLabel, technicalFieldLabel as techLabel } from "./labels.js";
import { icon } from "./icons.js";
import { fuzzyMatches } from "./fuzzy.js";
import { lensIssueUrl } from "../data/lensSuggest.js";
import { captureGeolocation } from "../geo.js";
import { repoClient } from "../pds.js";
import * as outbox from "../outbox.js";
import { activeDevRun } from "./devTimerState.js";
import { loadShotLoggerState, saveShotLoggerState } from "./shotLoggerState.js";
import { renderFilmView } from "../../apps/web/src/views/library/film-view.ts";
import { maybeRemoveDepletedStockpile, openRollDetail } from "../../apps/web/src/views/library/film-roll.ts";
import { createLibraryRecordRouteController } from "../../apps/web/src/views/library/library-record-route.ts";
import { consumeGearRouteFocus, rememberGearRouteFocus } from "../../apps/web/src/routes/library-record-focus.ts";
import {
  filmStockLabel as filmStockLabelForStore,
  framesForRoll as framesForRollInStore,
  reserveQuantity,
} from "../../apps/web/src/views/library/film-helpers.ts";
import { GEAR_TABS, countTypeReferences } from "../../apps/web/src/views/library/gear-config.ts";
import { openGearEditor, openGearForm } from "../../apps/web/src/views/library/gear-form.ts";
import { resolveGearTypeForSave } from "../../apps/web/src/views/library/gear-save.ts";
import { openGearMaintenance } from "../../apps/web/src/views/library/gear-maintenance.ts";
import { createGearThumb, renderGearTabView } from "../../apps/web/src/views/library/gear-tab.ts";
import { openShootEditor as openShootEditorView } from "../../apps/web/src/views/library/shoots-editor.ts";
import { renderShootsView } from "../../apps/web/src/views/library/shoots-view.ts";
import {
  effectiveShootGear as effectiveShootGearFromServices,
  openShootLogger,
} from "../../apps/web/src/views/library/shoots-logger.ts";
import {
  createCatalogSelect,
  createChemistrySelect,
  createInstanceSelect,
  createShootSelect,
} from "../../apps/web/src/views/library/maintenance-selectors.ts";
import {
  openManualDevelopment,
  renderDarkroomHeader as renderDarkroomHeaderView,
  saveCompletedDevelopmentRecords,
} from "../../apps/web/src/views/library/maintenance-darkroom.ts";
import { renderRulesView, renderWorkflowsView } from "../../apps/web/src/views/library/workflows-view.ts";
import {
  openScanSession,
  renderScanningHeader as renderScanningHeaderView,
} from "../../apps/web/src/views/library/scanning-view.ts";
import { renderInsightsView } from "../../apps/web/src/views/library/insights-view.ts";
import { renderLibraryShell } from "../../apps/web/src/views/library/maintenance-shell.ts";
import { computeLintFindings } from "../lint.js";
import cameraTypeLexicon from "../../lexicons/app/graycard/catalog/cameraType.json";
import lensTypeLexicon from "../../lexicons/app/graycard/catalog/lensType.json";
import filmStockLexicon from "../../lexicons/app/graycard/catalog/filmStock.json";
import chemistryTypeLexicon from "../../lexicons/app/graycard/catalog/chemistryType.json";
import {
  buildApertureOptions,
  buildShutterOptions,
  STOP_FRACTIONS,
  usesExactApertureSteps,
  usesExactShutterSteps,
  parseScaledList,
  formatScaledList,
  shutterScaledToDisplay,
  displayToShutterScaled,
} from "../exposureDials.js";
import "./shotLogger.css";

async function openDevTimerLazy(ctx, opts) {
  const loading = toast("Loading manufacturer development recipes…", "info", 60_000);
  try {
    await loadDevRecipes();
    loading();
    const { openDevTimer } = await import("./devTimer.js");
    return openDevTimer(ctx, opts);
  } catch (error) {
    loading();
    toast(
      `Could not load development recipes: ${error?.message || error}. Check your connection and try again.`,
      "err",
      6000,
    );
    return null;
  }
}

// ordered to follow the flow of photography production:
// gear (cameras -> lenses -> filters) -> film -> shoot -> develop -> scan,
// then the activity tabs.
const TAB_LABELS = {
  cameras: "Cameras",
  lenses: "Lenses",
  filters: "Filters",
  film: "Film",
  shoots: "Shoots",
  darkroom: "Darkroom",
  scanning: "Scanning",
  workflows: "Workflows",
  rules: "Rules",
  insights: "Insights",
};

let ctx = null;

export function initLibrary(context) {
  recordRouteController.close();
  ctx = context;
}

const TECH_SCHEMA_KEYS = Object.fromEntries(
  Object.entries({
    cameraType: cameraTypeLexicon,
    lensType: lensTypeLexicon,
    filmStock: filmStockLexicon,
    chemistryType: chemistryTypeLexicon,
  }).map(([kind, lexicon]) => [kind, new Set(Object.keys(lexicon.defs.main.record.properties))]),
);

function gearServices() {
  return {
    collections: {
      catalog: NS.catalog,
      instance: NS.instance,
      maintenanceSession: NS.process.maintenanceSession,
    },
    technicalSchemaKeys: TECH_SCHEMA_KEYS,
    getStore: () => ctx.store,
    reloadStore: async () => {
      ctx.store = await loadStore(ctx.agent, ctx.did);
    },
    saveRecord: (collection, value, existing) => saveRecord(ctx.agent, ctx.did, collection, value, existing),
    deleteRecord: (uri) => deleteRecord(ctx.agent, ctx.did, uri),
    uploadBlob: async (file, fallbackMime) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return repoClient(ctx.agent).uploadBlob({ bytes, mimeType: file.type || fallbackMime });
    },
    catalogImageUrl: (kind, value) =>
      catalogImageUrl(kind, value, { blobUrl: (blob) => blobUrl(ctx.agent, ctx.did, blob) }),
    instanceImageUrl: (kind, value) => instanceImageUrl(ctx.agent, ctx.did, ctx.store, kind, value),
    catalogLabel,
    instanceLabel: (kind, value) => instanceLabel(kind, value, ctx.store),
    kindLabel,
    kindLabelPlural,
    enumLabel,
    technicalFieldLabel: techLabel,
    icon,
    isAdvanced,
    inspect: openInspector,
    autocomplete,
    instanceSelect,
    locationField,
    lensIssueUrl,
    getPreset: (typeKind) => PRESETS[typeKind] || null,
    manufacturers: () => MANUFACTURERS,
    enumOptions: (key) => FIELD_ENUMS[key] || ENUMS[key] || [],
    loadCatalogPresets,
    presetCatalogStatus,
    displayToScaled,
    scaledToDisplay,
    displayToShutterScaled,
    shutterScaledToDisplay,
    parseScaledList,
    formatScaledList,
    displayToMeasure,
    measureToDisplay,
    confirmDepletedStockpile: (existing) => maybeRemoveDepletedStockpile(existing, filmViewServices(null)),
  };
}

export function countTypeRefs(typeKind, typeUri, exceptUri) {
  return countTypeReferences(ctx.store, typeKind, typeUri, exceptUri);
}

export function resolveTypeForSave(typeKind, typeRec, wikidata, kind, existing) {
  return resolveGearTypeForSave(typeKind, typeRec, wikidata, kind, existing, gearServices());
}

export function openAddGear(kind, onDone, prefill = {}, existing = null, opts = {}) {
  return openGearForm(kind, onDone, prefill, existing, opts, gearServices());
}

export const openCreateInstanceModal = (kind, onDone) => openAddGear(kind, onDone);

export function openEditGear(kind, item, onDone, opts = {}) {
  return openGearEditor(kind, item, onDone, opts, gearServices());
}

const recordRkey = (item) => item.rkey || item.uri?.split("/").filter(Boolean).at(-1);

function openEditGearRoute(kind, item, onDone) {
  const rkey = recordRkey(item);
  if (!rkey || !ctx?.navigateRecordRoute) return openEditGear(kind, item, onDone);
  rememberGearRouteFocus({ kind, rkey });
  return ctx.navigateRecordRoute({ type: "gear", kind, rkey });
}

function openRollRoute(roll) {
  const rkey = recordRkey(roll);
  if (!rkey || !ctx?.navigateRecordRoute) return openRollDetail(roll, filmViewServices(null));
  return ctx.navigateRecordRoute({ type: "roll", rkey });
}

function instanceThumb(kind, value) {
  return createGearThumb(kind, value, gearServices());
}

function openMaintenanceModal(subjectUri, onDone) {
  return openGearMaintenance(subjectUri, onDone, gearServices());
}

function renderGearTab(body, kinds) {
  const services = gearServices();
  renderGearTabView(body, kinds, services, {
    addGear: openAddGear,
    editGear: openEditGearRoute,
    maintain: openMaintenanceModal,
    render: () => renderLibrary(body),
  });
}

// -- Film: compatibility wiring for the extracted Film view -------------------

function filmStockLabel(stockUri) {
  return filmStockLabelForStore(ctx.store, stockUri, catalogLabel);
}

function framesForRoll(rollUri) {
  return framesForRollInStore(ctx.store, rollUri);
}

async function advanceWorkflowStageForSubjects(kind, subjectUris, sessionUri) {
  let advanced = 0;
  for (const subjectUri of new Set(subjectUris.filter(Boolean))) {
    const next = findNextActionableStage(ctx.store, subjectUri, { kind });
    if (!next) continue;
    await completeWorkflowStageAndAdvance(ctx.agent, ctx.did, {
      store: ctx.store,
      ...next,
      sessionUri,
    });
    advanced += 1;
    ctx.store = await loadStore(ctx.agent, ctx.did);
  }
  return advanced;
}

function filmViewServices(body) {
  return {
    stageLabels: STAGE_LABELS,
    collections: {
      filmStockpile: NS.instance.filmStockpile,
      filmRoll: NS.instance.filmRoll,
      exposure: NS.instance.exposure,
    },
    getStore: () => ctx.store,
    reloadStore: async () => {
      ctx.store = await loadStore(ctx.agent, ctx.did);
    },
    renderLibrary: () => renderLibrary(body),
    saveRecord: (collection, value, existing) => saveRecord(ctx.agent, ctx.did, collection, value, existing),
    deleteRecord: (uri) => deleteRecord(ctx.agent, ctx.did, uri),
    splitRoll: (stockpile, options) => splitRollFromStockpile(ctx.agent, ctx.did, stockpile, options),
    instantiateWorkflow: (template, subjects, processDefaults, occurrences) =>
      instantiateWorkflowTemplate(ctx.agent, ctx.did, {
        template,
        templateUri: template.uri,
        templateCid: template.cid,
        subjects,
        processDefaults,
        occurrences,
        store: ctx.store,
      }),
    advanceWorkflowStage: advanceWorkflowStageForSubjects,
    addGear: (kind, onDone, prefill) => openAddGear(kind, onDone, prefill),
    editGear: openEditGearRoute,
    openRoll: openRollRoute,
    openCompletedDevelopment: (roll, onDone) =>
      openManualDevelopment(onDone, activityServices(), { selectedRolls: [roll.uri] }),
    openScanSession: (roll, onDone) => openScanSession(onDone, activityServices(), { selectedRoll: roll.uri }),
    instanceSelect,
    instanceThumb,
    instanceLabel: (kind, value) => instanceLabel(kind, value, ctx.store),
    catalogLabel,
    enumLabel,
    icon,
    isAdvanced,
    inspect: openInspector,
    getPhotos: () => getPhotos(ctx.agent, ctx.did),
    blobUrl: (blob) => blobUrl(ctx.agent, ctx.did, blob),
    rollStatuses: ENUMS.rollStatus,
    cassetteTypes: ENUMS.cassetteType,
  };
}

function renderFilmTab(body) {
  renderFilmView(body, filmViewServices(body));
}

// -- Shoots: typed view + logger wiring behind application services ------------

function shootServices() {
  return {
    stageLabels: STAGE_LABELS,
    collections: {
      capture: NS.session.capture,
      exposure: NS.instance.exposure,
      meterReading: NS.meter.reading,
    },
    getStore: () => ctx.store,
    reloadStore: async () => {
      ctx.store = await loadStore(ctx.agent, ctx.did);
    },
    loadStore: () => loadStore(ctx.agent, ctx.did),
    setStore: (store) => {
      ctx.store = store;
    },
    saveRecord: (collection, value, existing) => saveRecord(ctx.agent, ctx.did, collection, value, existing),
    instantiateWorkflow: (template, subjects, processDefaults, occurrences) =>
      instantiateWorkflowTemplate(ctx.agent, ctx.did, {
        template,
        templateUri: template.uri,
        templateCid: template.cid,
        subjects,
        processDefaults,
        occurrences,
        store: ctx.store,
      }),
    advanceWorkflowStage: advanceWorkflowStageForSubjects,
    deleteRecord: (uri) => deleteRecord(ctx.agent, ctx.did, uri),
    pendingExposures: () => outbox.pending(ctx.did, NS.instance.exposure),
    subscribePendingAcknowledgements: (listener) =>
      outbox.subscribeAcknowledgements(ctx.did, (ack) =>
        ack.operation.collection === NS.instance.exposure ? listener() : undefined,
      ),
    pendingCount: () => outbox.pendingCount(ctx.did),
    pendingMeterReadingCount: () => outbox.pending(ctx.did, NS.meter.reading).length,
    enqueueExposure: (record) => outbox.enqueue(ctx.did, NS.instance.exposure, record),
    flushOutbox: () => outbox.flush(ctx.agent, ctx.did),
    isOnline: () => outbox.isOnline(),
    loadMeterReadings: () =>
      repoClient(ctx.agent).listAll({
        repo: ctx.did,
        collection: NS.meter.reading,
        limit: 100,
      }),
    loadSticky: (shootUri) => loadShotLoggerState(ctx.did, shootUri),
    saveSticky: (shootUri, state) => saveShotLoggerState(ctx.did, shootUri, state),
    captureLocation: captureGeolocation,
    framesForRoll,
    filmStockLabel,
    instanceLabel: (kind, value) => instanceLabel(kind, value, ctx.store),
    kindLabelPlural,
    enumLabel,
    icon,
    isAdvanced,
    inspect: openInspector,
    meteringModes: ENUMS.meteringMode,
    stopFractions: STOP_FRACTIONS,
    buildApertureOptions,
    buildShutterOptions,
    usesExactApertureSteps,
    usesExactShutterSteps,
  };
}

function openShootEditor(existing, onDone) {
  return openShootEditorView(existing, onDone, shootServices());
}

function renderShootsTab(body) {
  const services = shootServices();
  renderShootsView(body, services, {
    startShoot: (onDone) => openShootEditor(null, onDone),
    editShoot: openShootEditor,
    openLogger: (shoot) => openShootLogger(shoot, services, () => renderLibrary(body)),
    render: () => renderLibrary(body),
  });
}

export function effectiveShootGear(shoot, kind) {
  return [...effectiveShootGearFromServices(shoot, kind, shootServices())];
}

export function openShotLogger(shoot, body) {
  return openShootLogger(shoot, shootServices(), body ? () => renderLibrary(body) : undefined);
}

function activityServices() {
  const openWorkflowStageLogger = async (run, stage, onDone) => {
    const variant =
      String(stage.value.$type || "")
        .split("#")[1]
        ?.replace(/Stage$/, "") || "other";
    const kind = variant === "other" ? stage.value.kind || "other" : variant;
    const processKind = STAGE_PROCESS_KIND[kind];
    const defaults = {
      ...(stage.value.processDefaults || {}),
      ...(stage.value.processDefaults?.filmRoll ? { filmRolls: [stage.value.processDefaults.filmRoll] } : {}),
    };
    const form = processKind
      ? (await import("./processForms.ts")).buildProcessSessionForm(processKind, ctx.store, defaults, {
          signals: recordStore(ctx.did),
        })
      : null;
    const title = processKind ? `Log ${STAGE_LABELS[kind] || kind}` : `Complete ${STAGE_LABELS[kind] || kind}`;
    openModal(
      title,
      form?.nodes?.length
        ? form.nodes
        : [
            el(
              "p",
              { class: "muted" },
              "This step does not require a separate process-session record. Completing it advances every dependent branch.",
            ),
          ],
      async () => {
        const completedAt = new Date().toISOString();
        const sessionValue = processKind ? form.read() : undefined;
        const sessionUri = processKind
          ? processKind === "developSession"
            ? await saveCompletedDevelopmentRecords(activityServices(), sessionValue, "home")
            : await saveRecord(ctx.agent, ctx.did, NS.process[processKind], sessionValue, null)
          : undefined;
        await completeWorkflowStageAndAdvance(ctx.agent, ctx.did, {
          store: ctx.store,
          run,
          stage,
          sessionUri,
          completedAt,
        });
        ctx.store = await loadStore(ctx.agent, ctx.did);
        onDone?.();
      },
      { onClose: () => form?.dispose?.() },
    );
  };
  return {
    collections: {
      workflowTemplate: NS.workflow.template,
      developSession: NS.process.developSession,
      filmRoll: NS.instance.filmRoll,
      chemistry: NS.instance.chemistry,
      digitizeSession: NS.process.digitizeSession,
      exposure: NS.instance.exposure,
    },
    stageLabels: STAGE_LABELS,
    mediums: MEDIUMS,
    getStore: () => ctx.store,
    reloadStore: async () => {
      ctx.store = await loadStore(ctx.agent, ctx.did);
    },
    saveRecord: (collection, value, existing) => saveRecord(ctx.agent, ctx.did, collection, value, existing),
    deleteRecord: (uri) => deleteRecord(ctx.agent, ctx.did, uri),
    saveWorkflowTemplate: (value, existing) => saveWorkflowTemplate(ctx.agent, ctx.did, value, existing),
    instanceLabel: (kind, value) => instanceLabel(kind, value, ctx.store),
    catalogLabel,
    chemistryRoles: (value) => chemistryRoles(value, ctx.store),
    enumLabel,
    kindLabelPlural,
    icon,
    isAdvanced,
    inspect: openInspector,
    activeDevelopment: () => activeDevRun(ctx.did),
    openDevelopmentTimer: (options) =>
      openDevTimerLazy(ctx, {
        ...options,
        onSessionLogged: async (event) => {
          await advanceWorkflowStageForSubjects("develop", event.rollUris || [], event.sessionUri);
          await options.onSessionLogged?.(event);
        },
      }),
    advanceWorkflowStage: advanceWorkflowStageForSubjects,
    workflowActions: (run) => getActionableWorkflowStages(ctx.store, run),
    openWorkflowStageLogger,
    skipWorkflowStage: async (run, stage, onDone) => {
      await skipWorkflowStageAndAdvance(ctx.agent, ctx.did, { store: ctx.store, run, stage });
      ctx.store = await loadStore(ctx.agent, ctx.did);
      onDone?.();
    },
    cancelWorkflowRun: async (run, onDone) => {
      await cancelWorkflowRun(ctx.agent, ctx.did, { store: ctx.store, run });
      ctx.store = await loadStore(ctx.agent, ctx.did);
      onDone?.();
    },
    capturePhotos: () => getPhotos(ctx.agent, ctx.did),
    blobUrl: (blob) => blobUrl(ctx.agent, ctx.did, blob),
    computeLintFindings: () => computeLintFindings(ctx.store),
    reserveQuantity,
    filmStockLabel,
  };
}

export function catalogSelect(catalogKind, value = "") {
  return createCatalogSelect(catalogKind, value, activityServices());
}

export function chemistrySelect(value = "", { roles } = {}) {
  return createChemistrySelect(value, roles, activityServices());
}

function renderWorkflowsTab(body) {
  renderWorkflowsView(body, activityServices(), () => renderLibrary(body));
}

function renderRulesTab(body) {
  renderRulesView(body, activityServices());
}

function renderDarkroomHeader(body) {
  renderDarkroomHeaderView(body, activityServices(), () => renderLibrary(body));
}

function renderScanningHeader(body) {
  renderScanningHeaderView(body, activityServices(), () => renderLibrary(body));
}

function renderInsightsTab(body) {
  renderInsightsView(body, activityServices());
}

export function renderLibrary(bodyElement) {
  return renderLibraryShell(bodyElement, {
    tabLabels: TAB_LABELS,
    gearTabs: GEAR_TABS,
    hasStore: () => Boolean(ctx?.store),
    loadStore: async () => {
      ctx.store = await loadStore(ctx.agent, ctx.did);
    },
    matches: fuzzyMatches,
    renderFilm: renderFilmTab,
    renderDarkroomHeader,
    renderScanningHeader,
    renderGear: renderGearTab,
    renderShoots: renderShootsTab,
    renderWorkflows: renderWorkflowsTab,
    renderRules: renderRulesTab,
    renderInsights: renderInsightsTab,
  });
}

export async function openLibrary() {
  // if the session was lost (or Setup is opened before login), bounce to login
  // instead of throwing on a null context.
  if (!ctx?.agent || !ctx?.did) {
    showView("login-view");
    return;
  }
  ctx.store = null; // force a fresh load; renderLibrary shows the skeleton meanwhile
  await renderLibrary();
}

export function instanceSelect(kind, value = "", onChange = () => {}) {
  return createInstanceSelect(kind, value, activityServices(), onChange);
}

export function shootSelect(value = "", onChange = () => {}) {
  return createShootSelect(value, activityServices(), onChange);
}

export function getStore() {
  return ctx?.store;
}

export function refreshStore() {
  return loadStore(ctx.agent, ctx.did, { refresh: true }).then((s) => {
    ctx.store = s;
    return s;
  });
}

const recordRouteController = createLibraryRecordRouteController({
  getStore,
  refreshStore,
  openRoll: (roll, onClose) => openRollDetail(roll, filmViewServices(null), { onClose }),
  openGear: (kind, item, onClose) => {
    const rkey = recordRkey(item);
    const restoreFocus = consumeGearRouteFocus(kind, rkey);
    return openEditGear(kind, item, () => renderLibrary(), {
      onClose,
      restoreFocus,
    });
  },
  onRouteModalClosed: (target) => ctx?.closeRecordRoute?.(target),
});

export const openLibraryRecordRoute = (target) => recordRouteController.open(target);
export const closeLibraryRecordRoute = () => recordRouteController.close();
