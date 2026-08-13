import { checkList, dateField, el, field, inputField, openModal, toast } from "@hypo/ui";
import { inheritedShootGear, inheritedShootLocations } from "./shoots-selectors.ts";
import type { ShootGearKind, ShootRecord, ShootServices, ShootValue } from "./shoots-types.ts";
import { createWorkflowOccurrenceEditor } from "./workflow-occurrences.ts";

export function placeSummary(place: ShootValue | null | undefined): string {
  if (!place) return "not set";
  const placemark = place.placemark;
  if (placemark?.name)
    return [placemark.name, placemark.locality, placemark.administrativeArea].filter(Boolean).join(", ");
  if (place.latitude != null) return `${(place.latitude / 1e7).toFixed(5)}, ${(place.longitude / 1e7).toFixed(5)}`;
  return "location set";
}

export function createShootGearChecklist(
  kind: ShootGearKind,
  selected: readonly string[],
  locked: readonly string[],
  services: ShootServices,
) {
  const lockedSet = new Set(locked);
  const items = (services.getStore().instance[kind] || []).map((item) => {
    const inherited = lockedSet.has(item.uri);
    return {
      value: item.uri,
      label: services.instanceLabel(kind, item.value),
      locked: inherited,
      lockedLabel: inherited ? "in a photo" : undefined,
      lockedTitle: inherited ? "Used by a photo in this shoot" : undefined,
    };
  });
  return checkList(items, {
    selected,
    emptyMessage: el("p", { class: "muted small" }, `No ${services.kindLabelPlural(kind).toLowerCase()} yet.`),
  });
}

export function openShootEditor(
  existing: ShootRecord | null,
  onDone: ((uri: string) => void) | undefined,
  services: ShootServices,
) {
  const value = existing?.value || {};
  const shootUri = existing?.uri;
  const { wrap: labelWrap, input: labelInput } = inputField("Label", "label", value.label || "");
  const { wrap: startWrap, input: startInput } = dateField("Started", value.startedAt || new Date().toISOString());
  const { wrap: endWrap, input: endInput } = dateField("Ended (optional)", value.endedAt || "");
  const locked = (kind: ShootGearKind) => (shootUri ? inheritedShootGear(shootUri, kind, services.getStore()) : []);
  const cameras = createShootGearChecklist("camera", value.cameras || [], locked("camera"), services);
  const lenses = createShootGearChecklist("lens", value.lenses || [], locked("lens"), services);
  const rolls = createShootGearChecklist("filmRoll", value.rolls || [], locked("filmRoll"), services);
  const filters = createShootGearChecklist("filter", value.filters || [], locked("filter"), services);
  const { wrap: notesWrap, input: notesInput } = inputField("Notes", "notes", value.notes || "");
  const workflowSelect = el("select", {}, [
    el("option", { value: "" }, "No workflow yet"),
    ...(services.getStore().workflowTemplates || []).map((template) =>
      el("option", { value: template.uri }, template.value.name || "Untitled workflow"),
    ),
  ]);
  const occurrences = createWorkflowOccurrenceEditor(
    workflowSelect,
    services.getStore().workflowTemplates || [],
    services.stageLabels,
  );

  const inheritedLocations = shootUri ? inheritedShootLocations(shootUri, services.getStore()) : [];
  const manualPlaces: ShootValue[] = [...(value.places || (value.place ? [value.place] : []))];
  const placesWrap = el("div", { class: "places-list" });
  const renderPlaces = () => {
    placesWrap.replaceChildren();
    if (inheritedLocations.length) {
      placesWrap.append(
        el(
          "p",
          { class: "muted small" },
          `${inheritedLocations.length} location${inheritedLocations.length === 1 ? "" : "s"} inherited from photos in this shoot.`,
        ),
      );
    }
    manualPlaces.forEach((place, index) => {
      placesWrap.append(
        el("div", { class: "place-row row between" }, [
          el("span", { class: "muted small" }, placeSummary(place)),
          el(
            "button",
            {
              class: "ghost small-btn danger",
              type: "button",
              title: "Remove",
              "aria-label": "Remove",
              onclick: () => {
                manualPlaces.splice(index, 1);
                renderPlaces();
              },
            },
            [services.icon("trash", 14)],
          ),
        ]),
      );
    });
    if (!inheritedLocations.length && !manualPlaces.length)
      placesWrap.append(el("p", { class: "muted small" }, "No locations yet."));
  };
  renderPlaces();

  const addPlaceButton = el("button", { class: "ghost small-btn", type: "button" }, [
    services.icon("map-pin", 14),
    el("span", {}, "Add location"),
  ]);
  addPlaceButton.addEventListener("click", async () => {
    addPlaceButton.disabled = true;
    try {
      manualPlaces.push(await services.captureLocation());
      renderPlaces();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      addPlaceButton.disabled = false;
    }
  });

  return openModal(
    existing ? "Edit shoot" : "Start a shoot",
    [
      labelWrap,
      startWrap,
      endWrap,
      el("h3", { class: "modal-sub" }, "Cameras"),
      cameras.node,
      el("h3", { class: "modal-sub" }, "Lenses"),
      lenses.node,
      el("h3", { class: "modal-sub" }, "Rolls (film)"),
      rolls.node,
      el("h3", { class: "modal-sub" }, "Filters"),
      filters.node,
      (services.getStore().workflowTemplates || []).length ? el("h3", { class: "modal-sub" }, "Workflow") : null,
      (services.getStore().workflowTemplates || []).length
        ? field(existing ? "Start another workflow (optional)" : "Start a workflow (optional)", workflowSelect)
        : null,
      occurrences.node,
      el("h3", { class: "modal-sub" }, "Locations"),
      placesWrap,
      el("div", { class: "row" }, [addPlaceButton]),
      notesWrap,
    ],
    async () => {
      const record: ShootValue = {
        label: labelInput.value.trim() || "Shoot",
        cameras: cameras.getSelected(),
        lenses: lenses.getSelected(),
        rolls: rolls.getSelected(),
        filters: filters.getSelected(),
        createdAt: value.createdAt || new Date().toISOString(),
      };
      if (startInput.value) record.startedAt = new Date(startInput.value).toISOString();
      if (endInput.value) record.endedAt = new Date(endInput.value).toISOString();
      if (manualPlaces.length) record.places = manualPlaces;
      if (notesInput.value.trim()) record.notes = notesInput.value.trim();
      if (existing) record.updatedAt = new Date().toISOString();
      else record.provenance = { source: "manual", assertedAt: new Date().toISOString() };
      const uri = await services.saveRecord(services.collections.capture, record, existing);
      const template = (services.getStore().workflowTemplates || []).find((item) => item.uri === workflowSelect.value);
      if (template && services.instantiateWorkflow) {
        await services.instantiateWorkflow(
          template,
          [{ kind: "scene", ref: uri, label: record.label }],
          {
            shoot: uri,
            camera: record.cameras?.[0],
            lens: record.lenses?.[0],
            filmRoll: record.rolls?.[0],
          },
          occurrences.read(),
        );
      }
      await services.reloadStore();
      if (record.endedAt) await services.advanceWorkflowStage?.("capture", [uri]);
      onDone?.(uri);
    },
  );
}
