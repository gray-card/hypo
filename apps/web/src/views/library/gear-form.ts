import { el, field, isoToLocalInput, openModal } from "@hypo/ui";
import {
  ENUM_LIST,
  INSTANCE_ENUM_OPTIONS,
  INSTANCE_FIELDS,
  STRING_LIST,
  TYPE_IDENTITY,
  TYPE_KEY,
  TYPE_OF_INSTANCE,
} from "./gear-config.ts";
import { createTechnicalFields, createTypeAssetFields, gearFieldControl, readGearFormFields } from "./gear-controls.ts";
import { resolveGearTypeForSave } from "./gear-save.ts";
import type { GearFormOptions, GearInput, GearInputMap, GearRecord, GearServices, GearValue } from "./gear-types.ts";

const GUIDED_IDENTITY: Readonly<Record<string, readonly string[]>> = {
  cameraType: ["make", "model", "mount", "format", "category"],
  lensType: ["make", "model", "mount", "focalLengthMin", "focalLengthMax", "maxAperture"],
  filmStock: ["brand", "name", "iso", "filmType", "process"],
  chemistryType: ["brand", "name", "roles", "productKind", "process", "form", "defaultDilution", "defaultTemperature"],
  scannerType: ["make", "model", "scannerKind"],
  filterType: ["make", "name", "filterKind", "threadDiameterMm"],
  lab: ["name", "website", "location"],
  enlargerType: ["make", "model", "maxFormat", "headType"],
  enlargingLensType: ["make", "model", "focalLengthMm", "coversFormat"],
  printerType: ["make", "model", "printerTechnology"],
  lightSourceType: ["make", "model", "lightTechnology"],
};

const GUIDED_INSTANCE: Readonly<Record<string, readonly string[]>> = {
  camera: ["nickname"],
  lens: ["nickname"],
  filter: ["nickname", "threadSize"],
  chemistry: ["nickname", "componentName", "dilution"],
  scanner: ["nickname"],
  filmStockpile: ["quantity", "format", "storage"],
  labAccount: ["nickname"],
  enlarger: ["nickname"],
  enlargingLens: ["nickname"],
  printer: ["nickname"],
  lightSource: ["nickname"],
  storageLocation: ["name", "storage"],
};

const valueOf = (input: GearInput | undefined) => input?.value || "";
const nativeInput = (input: GearInput | undefined): HTMLInputElement | HTMLSelectElement | null =>
  input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? input : null;

function instanceFieldControl(kind: string, key: string, label: string, services: GearServices) {
  return gearFieldControl(key, label, "", services, INSTANCE_ENUM_OPTIONS[kind]?.[key]);
}

function setPresetField(key: string, value: unknown, inputs: GearInputMap, services: GearServices): void {
  const input = inputs[key];
  if (!input || value == null) return;
  let displayValue = value;
  if (key === "shutterSpeedSteps" && Array.isArray(value))
    displayValue = services.formatScaledList(value, services.shutterScaledToDisplay);
  else if (key === "apertureSteps" && Array.isArray(value))
    displayValue = services.formatScaledList(value, services.scaledToDisplay);
  else if (["minShutterSpeed", "maxShutterSpeed"].includes(key) && typeof value === "number")
    displayValue = services.shutterScaledToDisplay(value);
  else if (Array.isArray(value) && (ENUM_LIST.has(key) || STRING_LIST.has(key))) displayValue = value.join("\n");
  else if (typeof value === "object") return;
  const text = String(displayValue);
  const native = nativeInput(input);
  if (native instanceof HTMLSelectElement && ![...native.options].some((option) => option.value === text)) {
    native.append(el("option", { value: text }, services.enumLabel(text)));
  }
  input.value = text;
}

export function openGearForm(
  kind: string,
  onDone: (() => void) | undefined,
  prefill: GearValue,
  existing: GearRecord | null,
  options: GearFormOptions,
  services: GearServices,
) {
  const guided = Boolean(options.guided);
  const typeKind = TYPE_OF_INSTANCE[kind];
  const preset = typeKind ? services.getPreset(typeKind) : null;
  const presetLoad = preset ? services.loadCatalogPresets(typeKind) : null;
  const typeInputs: GearInputMap = {};
  const typeNodes: Record<string, HTMLElement> = {};
  const instanceInputs: GearInputMap = {};
  const nodes: Node[] = [];
  let labLocation: ReturnType<GearServices["locationField"]> | null = null;
  const currentTypeUri = typeKind ? existing?.value[TYPE_KEY[kind]] || null : null;
  const currentType = currentTypeUri
    ? (services.getStore().catalog[typeKind] || []).find((item) => item.uri === currentTypeUri)?.value || null
    : null;
  let technical: ReturnType<typeof createTechnicalFields> | null = null;
  let matchedPreset: GearValue | null = null;
  let akaHint: HTMLParagraphElement | null = null;
  let applyPresetFromCatalog = () => {};

  if (typeKind) {
    nodes.push(
      el(
        "h3",
        { class: "modal-sub" },
        kind === "filmRoll" ? "Which film?" : `Which ${services.kindLabel(kind).toLowerCase()}?`,
      ),
    );
    if (presetLoad && services.presetCatalogStatus(typeKind).status !== "ready") {
      const status = el(
        "p",
        { class: "muted small catalog-load-status", role: "status", "aria-live": "polite" },
        "Loading catalog suggestions…",
      );
      nodes.push(status);
      const finish = () => {
        status.textContent = "Catalog suggestions loaded.";
        status.classList.add("ok");
        applyPresetFromCatalog();
      };
      const fail = (error: unknown) => {
        status.classList.add("err");
        const retry = el("button", { class: "linkbtn small", type: "button" }, "Try again");
        retry.addEventListener("click", async () => {
          retry.disabled = true;
          status.classList.remove("err");
          status.replaceChildren("Loading catalog suggestions…");
          try {
            await services.loadCatalogPresets(typeKind);
            finish();
          } catch (retryError) {
            fail(retryError);
          }
        });
        const message = error instanceof Error ? error.message : String(error);
        status.replaceChildren(
          `Catalog suggestions are unavailable (${message}). You can still enter this item manually. `,
          retry,
        );
      };
      void presetLoad.then(finish).catch(fail);
    }

    for (const [key, label, required] of TYPE_IDENTITY[typeKind]) {
      if (guided && GUIDED_IDENTITY[typeKind] && !GUIDED_IDENTITY[typeKind].includes(key)) continue;
      const control = gearFieldControl(key, label + (required ? " *" : ""), "", services);
      typeInputs[key] = control.input;
      typeNodes[key] = control.node;
      const input = nativeInput(control.input);
      if ((key === "brand" || key === "make") && input instanceof HTMLInputElement)
        services.autocomplete(control.node, input, services.manufacturers());
      nodes.push(control.node);
    }
    for (const [key, value] of Object.entries(prefill)) {
      if (typeInputs[key] && value != null) typeInputs[key].value = String(value);
    }
    if (typeKind === "filmStock") {
      akaHint = el("p", { class: "muted small aka-hint hidden" });
      nodes.push(akaHint);
    }
    if (typeKind === "lab") {
      labLocation = services.locationField(prefill.geo || null);
      nodes.push(field("Map location", labLocation.node));
    }
    const primaryInput = preset ? nativeInput(typeInputs[preset.primary]) : null;
    if (preset && primaryInput instanceof HTMLInputElement) {
      const primaryKey = preset.primary;
      const makeKey = typeInputs.make ? "make" : typeInputs.brand ? "brand" : null;
      const normalized = (value: unknown) =>
        String(value || "")
          .trim()
          .toLowerCase();
      const makeOf = (item: GearValue) => normalized(item.make || item.brand);
      services.autocomplete(typeNodes[primaryKey], primaryInput, () => {
        const make = makeKey ? normalized(valueOf(typeInputs[makeKey])) : "";
        const seen = new Set<string>();
        return preset.items.flatMap((item) => {
          if (make && makeOf(item) !== make && !makeOf(item).startsWith(make)) return [];
          const label = item[primaryKey];
          if (!label || seen.has(label)) return [];
          seen.add(label);
          return [label];
        });
      });
      const applyPreset = () => {
        matchedPreset = null;
        const model = normalized(valueOf(typeInputs[primaryKey]));
        if (!model) return;
        const make = makeKey ? normalized(valueOf(typeInputs[makeKey])) : "";
        const item =
          preset.items.find(
            (candidate) => normalized(candidate[primaryKey]) === model && (!make || makeOf(candidate) === make),
          ) || preset.items.find((candidate) => normalized(candidate[primaryKey]) === model);
        if (!item) return;
        matchedPreset = item;
        for (const [key, value] of Object.entries(item)) setPresetField(key, value, typeInputs, services);
        technical?.set({ ...(currentType || {}), ...item });
        if (akaHint) {
          const aka = Array.isArray(item.aka) ? item.aka : [];
          akaHint.textContent = aka.length ? `Same film, also sold as ${aka.join(", ")}.` : "";
          akaHint.classList.toggle("hidden", !aka.length);
        }
      };
      applyPresetFromCatalog = applyPreset;
      primaryInput.addEventListener("input", applyPreset);
    }
  }

  if (kind === "lens" && !guided) {
    const suggest = el("button", { class: "linkbtn small", type: "button" }, [
      services.icon("plus", 13),
      " Can't find your lens? Suggest it",
    ]);
    suggest.addEventListener("click", () => {
      const fields = Object.fromEntries(Object.entries(typeInputs).map(([key, input]) => [key, input.value || ""]));
      window.open(services.lensIssueUrl(fields), "_blank", "noopener");
    });
    nodes.push(el("p", { class: "muted small suggest-lens" }, suggest));
  }

  // A lab is a service provider, not a piece of equipment. Its catalog record
  // intentionally has no model picture, datasheet, or technical-spec block.
  const typeAssets =
    typeKind && typeKind !== "lab" && !guided ? createTypeAssetFields(typeKind, currentType, services) : null;
  if (typeAssets) {
    nodes.push(...typeAssets.nodes);
    technical = createTechnicalFields(typeKind, currentType || prefill, services);
    nodes.push(technical.node);
  }

  const allInstanceFields = INSTANCE_FIELDS[kind] || [["nickname", "Nickname"]];
  const instanceFields =
    guided && GUIDED_INSTANCE[kind]
      ? allInstanceFields.filter(([key]) => GUIDED_INSTANCE[kind].includes(key))
      : allInstanceFields;
  if (typeKind) {
    const title =
      kind === "filmRoll"
        ? "This roll (optional)"
        : kind === "filmStockpile"
          ? "In reserve"
          : kind === "labAccount"
            ? "My account (optional)"
            : "Your copy (optional)";
    nodes.push(el("h3", { class: "modal-sub" }, title));
  }
  for (const [key, label, required] of instanceFields) {
    if (label.startsWith("@")) {
      const select = services.instanceSelect(label.slice(1), "");
      instanceInputs[key] = select;
      nodes.push(field(services.kindLabel(label.slice(1)), select));
    } else {
      const control = instanceFieldControl(kind, key, label + (required ? " *" : ""), services);
      instanceInputs[key] = control.input;
      nodes.push(control.node);
    }
  }
  for (const [key, value] of Object.entries(prefill)) {
    const input = instanceInputs[key];
    if (!input || value == null || (typeof value === "object" && !(key === "roles" && Array.isArray(value)))) continue;
    const native = nativeInput(input);
    if (native instanceof HTMLInputElement && (native.type === "datetime-local" || native.type === "date")) {
      native.value = isoToLocalInput(String(value), native.type !== "date");
      continue;
    }
    const text = Array.isArray(value) ? value.join(",") : String(value);
    if (native instanceof HTMLSelectElement && ![...native.options].some((option) => option.value === text))
      native.append(el("option", { value: text }, services.enumLabel(text)));
    input.value = text;
  }

  const photoInput = guided || kind === "labAccount" ? null : el("input", { type: "file", accept: "image/*" });
  if (photoInput) nodes.push(field("Photo (optional, a stock image is used otherwise)", photoInput));

  return openModal(
    `${existing ? "Edit" : "Add"} ${services.kindLabel(kind).toLowerCase()}`,
    nodes,
    async () => {
      let typeUri: string | null = null;
      if (typeKind) {
        const typeRecord = readGearFormFields(typeInputs, services, {
          scaledKeys: ["focalLengthMin", "focalLengthMax", "maxAperture", "minAperture"],
          shutterScaledKeys: ["minShutterSpeed", "maxShutterSpeed"],
          scaledArrayKeys: {
            apertureSteps: (value) => services.displayToScaled(value),
            shutterSpeedSteps: (value) => services.displayToShutterScaled(value),
          },
          measureKeys: { defaultTemperature: "celsius" },
        });
        const required = TYPE_IDENTITY[typeKind].filter(([, , isRequired]) => isRequired).map(([key]) => key);
        if (required.some((key) => !valueOf(typeInputs[key]).trim()))
          throw new Error("Please fill the required fields");
        if (technical) Object.assign(typeRecord, technical.read(), typeRecord);
        if (matchedPreset?.datasheetUrl && typeKind === "filmStock")
          typeRecord.datasheetUrl = matchedPreset.datasheetUrl;
        if (typeKind === "lab") {
          const geo = labLocation?.get();
          if (geo) typeRecord.geo = geo;
        }
        if (typeAssets) Object.assign(typeRecord, await typeAssets.read());
        const submittedLabel = services.catalogLabel(typeKind, typeRecord).toLowerCase().trim();
        const knownType = (services.getStore().catalog[typeKind] || []).find(
          (item) => services.catalogLabel(typeKind, item.value).toLowerCase().trim() === submittedLabel,
        );
        if (matchedPreset?.datasheetUrl && !typeRecord.datasheet && !knownType?.value.datasheet)
          typeRecord.datasheet = { url: matchedPreset.datasheetUrl };
        typeUri = await resolveGearTypeForSave(
          typeKind,
          typeRecord,
          matchedPreset?.wikidata || null,
          kind,
          existing,
          services,
        );
      }
      const submitted = readGearFormFields(instanceInputs, services);
      // Instance forms intentionally expose only a useful subset of each
      // record. Preserve every undisplayed field on edits, while treating a
      // blank visible control as a deliberate request to clear that field.
      const record: GearValue = existing ? { ...existing.value } : {};
      for (const [key] of instanceFields) delete record[key];
      Object.assign(record, submitted);
      if (instanceFields.some(([key, , required]) => required && !valueOf(instanceInputs[key]).trim()))
        throw new Error("Please fill the required fields");
      if (typeUri) record[TYPE_KEY[kind]] = typeUri;
      const photo = photoInput?.files?.[0];
      if (photo) record.image = await services.uploadBlob(photo, "image/jpeg");
      else if (existing?.value.image) record.image = existing.value.image;
      if (existing) {
        record.createdAt = existing.value.createdAt || record.createdAt;
        record.updatedAt = new Date().toISOString();
      }
      await services.saveRecord(services.collections.instance[kind], record, existing);
      if (kind === "filmStockpile" && existing && Number(record.quantity ?? 0) === 0)
        await services.confirmDepletedStockpile(existing);
      await services.reloadStore();
      onDone?.();
    },
    { onClose: options.onClose, restoreFocus: options.restoreFocus },
  );
}

export function openGearEditor(
  kind: string,
  item: GearRecord,
  onDone: (() => void) | undefined,
  options: GearFormOptions,
  services: GearServices,
) {
  const typeKind = TYPE_OF_INSTANCE[kind];
  const prefill = { ...item.value };
  if (typeKind) {
    const typeUri = item.value[TYPE_KEY[kind]];
    const typeValue = services.getStore().catalog[typeKind]?.find((record) => record.uri === typeUri)?.value;
    if (typeValue) {
      const converted = { ...typeValue };
      for (const key of ["focalLengthMin", "focalLengthMax", "maxAperture", "minAperture"])
        if (converted[key] != null) converted[key] = services.scaledToDisplay(converted[key]);
      for (const key of ["minShutterSpeed", "maxShutterSpeed"])
        if (converted[key] != null) converted[key] = services.shutterScaledToDisplay(converted[key]);
      if (converted.apertureSteps?.length)
        converted.apertureSteps = services.formatScaledList(converted.apertureSteps, services.scaledToDisplay);
      if (converted.shutterSpeedSteps?.length)
        converted.shutterSpeedSteps = services.formatScaledList(
          converted.shutterSpeedSteps,
          services.shutterScaledToDisplay,
        );
      if (converted.defaultTemperature != null)
        converted.defaultTemperature = services.measureToDisplay(converted.defaultTemperature);
      Object.assign(prefill, converted);
    }
  }
  return openGearForm(kind, onDone, prefill, item, options, services);
}
