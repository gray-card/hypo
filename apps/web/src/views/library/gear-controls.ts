import { dateField, el, field, inputField } from "@hypo/ui";
import { DATE_ONLY, ENUM_LIST, ENUM_SELECT, STRING_LIST, TYPE_IDENTITY } from "./gear-config.ts";
import type { GearInput, GearInputMap, GearServices, GearValue } from "./gear-types.ts";

const INT_FORM_KEYS = new Set([
  "rollsProcessed",
  "sessionsUsed",
  "exposuresTotal",
  "exposuresUsed",
  "frameIndex",
  "iso",
  "bitDepth",
  "quantity",
  "shotAtIso",
  "threadDiameterMm",
  "threadSize",
  "frameNumber",
  "focalLength",
]);

export function readGearFormFields(
  inputs: GearInputMap,
  services: GearServices,
  options: {
    scaledKeys?: readonly string[];
    shutterScaledKeys?: readonly string[];
    scaledArrayKeys?: Readonly<Record<string, (value: string) => number>>;
    measureKeys?: Readonly<Record<string, string>>;
  } = {},
): GearValue {
  const { scaledKeys = [], shutterScaledKeys = [], scaledArrayKeys = {}, measureKeys = {} } = options;
  const record: GearValue = { createdAt: new Date().toISOString() };
  for (const [key, input] of Object.entries(inputs)) {
    const text = input.value?.trim();
    if (!text) continue;
    if (scaledKeys.includes(key)) record[key] = services.displayToScaled(text);
    else if (shutterScaledKeys.includes(key)) record[key] = services.displayToShutterScaled(text);
    else if (scaledArrayKeys[key]) {
      const values = services.parseScaledList(text, scaledArrayKeys[key]);
      if (values.length) record[key] = values;
    } else if (measureKeys[key]) record[key] = services.displayToMeasure(text, measureKeys[key]);
    else if (STRING_LIST.has(key)) {
      const values = text
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length) record[key] = [...new Set(values)];
    } else if (ENUM_LIST.has(key)) {
      const values = text
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length) record[key] = [...new Set(values)];
    } else if (INT_FORM_KEYS.has(key)) {
      const value = Number.parseInt(text, 10);
      if (Number.isFinite(value)) record[key] = value;
    } else if (key.endsWith("At")) record[key] = new Date(text).toISOString();
    else record[key] = text;
  }
  return record;
}

const ENUM_CUSTOM = "__custom__";

function enumControl(options: readonly string[], value: string, enumLabel: (value: string) => string) {
  const known = new Set(options);
  const select = el("select", {}, [
    el("option", { value: "" }, "(none)"),
    ...options.map((option) => el("option", { value: option }, enumLabel(option))),
    el("option", { value: ENUM_CUSTOM }, "Custom…"),
  ]);
  const text = el("input", { type: "text", class: "enum-custom hidden", placeholder: "Enter your own" });
  const showText = (show: boolean) => text.classList.toggle("hidden", !show);
  const input: GearInput = {
    get value() {
      return select.value === ENUM_CUSTOM ? text.value.trim() : select.value;
    },
    set value(next: string) {
      if (!next) {
        select.value = "";
        showText(false);
      } else if (known.has(next)) {
        select.value = next;
        showText(false);
      } else {
        select.value = ENUM_CUSTOM;
        text.value = next;
        showText(true);
      }
    },
    addEventListener(type, listener) {
      select.addEventListener(type, listener);
    },
  };
  input.value = value;
  select.addEventListener("change", () => {
    const custom = select.value === ENUM_CUSTOM;
    showText(custom);
    if (custom) setTimeout(() => text.focus(), 0);
  });
  return { node: el("div", { class: "enum-control" }, [select, text]), input };
}

function enumListControl(options: readonly string[], value: string, enumLabel: (value: string) => string) {
  const known = new Set(options);
  const initial = new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const checks = options.map((option) => {
    const input = el("input", { type: "checkbox", value: option, checked: initial.has(option) });
    return { option, input, label: el("label", { class: "enum-list-option" }, [input, enumLabel(option)]) };
  });
  const custom = el("input", {
    type: "text",
    class: "enum-list-custom",
    placeholder: "Other roles, comma-separated",
    value: [...initial].filter((option) => !known.has(option)).join(", "),
  });
  const input: GearInput = {
    get value() {
      const selected = checks.filter((item) => item.input.checked).map((item) => item.option);
      const extras = custom.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return [...new Set([...selected, ...extras])].join(",");
    },
    set value(next: string) {
      const selected = new Set(
        String(next || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      for (const item of checks) item.input.checked = selected.has(item.option);
      custom.value = [...selected].filter((option) => !known.has(option)).join(", ");
    },
    addEventListener(type, listener) {
      for (const item of checks) item.input.addEventListener(type, listener);
      custom.addEventListener(type, listener);
    },
  };
  return { node: el("div", { class: "enum-list-control" }, [...checks.map((item) => item.label), custom]), input };
}

export function gearFieldControl(
  key: string,
  label: string,
  value: string,
  services: GearServices,
  enumOptions?: readonly string[],
) {
  if (ENUM_SELECT.has(key)) {
    const result = enumControl(enumOptions ?? services.enumOptions(key), value, services.enumLabel);
    return { node: field(label, result.node), input: result.input };
  }
  if (ENUM_LIST.has(key)) {
    const result = enumListControl(enumOptions ?? services.enumOptions(key), value, services.enumLabel);
    return { node: field(label, result.node), input: result.input };
  }
  if (STRING_LIST.has(key)) {
    const input = el("textarea", {
      rows: "3",
      placeholder: "One name per line, or separate names with commas",
      "aria-describedby": `${key}-help`,
    });
    input.value = value;
    return {
      node: el("label", { class: "field" }, [
        el("span", {}, label),
        input,
        el(
          "small",
          { id: `${key}-help`, class: "muted" },
          "Names used by EXIF or other catalogs, such as “Nikkor 50mm f/1.4 non-AI”.",
        ),
      ]),
      input: input as GearInput,
    };
  }
  if (key.endsWith("At")) {
    const cleanLabel = label.replace(/\s*\(ISO 8601\)/i, "");
    const type = DATE_ONLY.has(key) ? "date" : "datetime-local";
    const result = dateField(cleanLabel, value, { type });
    return { node: result.wrap, input: result.input as GearInput };
  }
  const result = inputField(label, key, value);
  return { node: result.wrap, input: result.input as GearInput };
}

export function createTypeAssetFields(typeKind: string, typeValue: GearValue | null, services: GearServices) {
  const hadImageUrl = Boolean(typeValue?.image?.url);
  const hadSheetUrl = Boolean(typeValue?.datasheet?.url);
  const imageUrl = el("input", {
    type: "url",
    placeholder: "https://…  (blank uses the stock picture)",
    value: typeValue?.image?.url || "",
  });
  const imageFile = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
  const datasheetUrl = el("input", {
    type: "url",
    placeholder: "https://…  datasheet PDF",
    value: typeValue?.datasheet?.url || typeValue?.datasheetUrl || "",
  });
  const datasheetFile = el("input", { type: "file", accept: "application/pdf,image/png,image/jpeg" });
  const preview = el("div", { class: "type-thumb", "aria-hidden": "true" });
  const paint = (url: string | null | undefined) => {
    preview.style.backgroundImage = url ? `url("${url}")` : "";
    preview.classList.toggle("has-img", Boolean(url));
  };
  if (typeValue)
    void services
      .catalogImageUrl(typeKind, typeValue)
      .then(paint)
      .catch(() => {});
  imageUrl.addEventListener("input", () => paint(imageUrl.value.trim()));
  imageFile.addEventListener("change", () => {
    const file = imageFile.files?.[0];
    if (file) paint(URL.createObjectURL(file));
  });
  const nodes = [
    el("h3", { class: "modal-sub" }, "Picture and datasheet"),
    el(
      "p",
      { class: "muted small" },
      "These describe the model itself, so everyone who uses it sees them. Leave blank to keep the manufacturer picture.",
    ),
    el("div", { class: "row type-asset-row" }, [
      preview,
      el("div", { class: "type-asset-fields" }, [
        field("Picture link", imageUrl),
        field("or upload a picture", imageFile),
      ]),
    ]),
    field("Datasheet link", datasheetUrl),
    field("or upload a datasheet", datasheetFile),
  ];
  return {
    nodes,
    async read(): Promise<GearValue> {
      const output: GearValue = {};
      const image = imageFile.files?.[0];
      const imageLink = imageUrl.value.trim();
      if (image)
        output.image = { file: await services.uploadBlob(image, "image/jpeg"), mimeType: image.type || "image/jpeg" };
      else if (imageLink) output.image = { url: imageLink };
      else if (typeValue?.image && !hadImageUrl) output.image = typeValue.image;
      else if (typeValue) output.image = undefined;
      const datasheet = datasheetFile.files?.[0];
      const datasheetLink = datasheetUrl.value.trim();
      if (datasheet)
        output.datasheet = {
          file: await services.uploadBlob(datasheet, "application/pdf"),
          mimeType: datasheet.type || "application/pdf",
        };
      else if (datasheetLink) output.datasheet = { url: datasheetLink };
      else if (typeValue?.datasheet && !hadSheetUrl) output.datasheet = typeValue.datasheet;
      else if (typeValue) output.datasheet = undefined;
      return output;
    },
  };
}

const TECH_LOCAL_KEYS = new Set(["source", "wikidata"]);
const TECH_SEPARATE_KEYS = new Set(["image", "datasheet", "datasheetUrl", "createdAt", "updatedAt"]);
const TECH_SCALED_KEYS = new Set([
  "cropFactor",
  "effectiveMegapixels",
  "exposureCompensationMin",
  "exposureCompensationMax",
  "maxReproductionRatio",
  "stabilizationStops",
  "viewfinderMagnification",
]);
const populated = (value: unknown) =>
  value != null &&
  value !== "" &&
  (!Array.isArray(value) || value.length > 0) &&
  (typeof value !== "object" || Array.isArray(value) || Object.keys(value as object).length > 0);

export function technicalPayload(
  typeKind: string,
  value: GearValue = {},
  services: GearServices,
  schemaOnly = false,
): GearValue {
  const identity = new Set((TYPE_IDENTITY[typeKind] || []).map(([key]) => key));
  const schema = services.technicalSchemaKeys[typeKind];
  return Object.fromEntries(
    Object.entries(value).filter(([key, fieldValue]) => {
      if (key.startsWith("$") || (schemaOnly && schema && !schema.has(key))) return false;
      return !identity.has(key) && !TECH_SEPARATE_KEYS.has(key) && !TECH_LOCAL_KEYS.has(key) && populated(fieldValue);
    }),
  );
}

function valueText(value: unknown, key: string, services: GearServices): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && key === "flashSyncSpeed") return services.shutterScaledToDisplay(value);
  if (typeof value === "number" && key === "viewfinderCoverage") return `${services.scaledToDisplay(value) * 100}%`;
  if (typeof value === "number" && TECH_SCALED_KEYS.has(key)) return String(services.scaledToDisplay(value));
  if (Array.isArray(value) && value.every((item) => item == null || typeof item !== "object"))
    return value.map(String).join(", ");
  if (value && typeof value === "object") {
    const object = value as GearValue;
    if (typeof object.value === "number" && object.unit)
      return `${object.value / (object.scale || 1)} ${services.enumLabel(object.unit)}`;
    if (object.uri) return object.label ? `${object.label} (${object.uri})` : object.uri;
    if (object.url) return object.url;
    return JSON.stringify(object, null, 2);
  }
  return String(value);
}

function normalizePresetTechnical(typeKind: string, value: GearValue, services: GearServices): GearValue {
  const output = { ...value };
  if (typeKind === "cameraType") {
    for (const key of ["cropFactor", "effectiveMegapixels"]) {
      if (typeof output[key] === "number" && Math.abs(output[key]) < 1000)
        output[key] = services.displayToScaled(output[key]);
    }
  }
  return output;
}

export function createTechnicalFields(typeKind: string, initial: GearValue, services: GearServices) {
  let payload = technicalPayload(typeKind, initial, services);
  const rows = el("dl", { class: "technical-spec-list" });
  const empty = el(
    "p",
    { class: "muted small technical-spec-empty" },
    "No technical specifications have been recorded yet.",
  );
  const editor = el("textarea", {
    class: "technical-spec-json",
    rows: "12",
    spellcheck: "false",
    "aria-label": "Technical specifications JSON",
  });
  const render = (next: GearValue = payload) => {
    payload = technicalPayload(typeKind, next, services);
    rows.replaceChildren(
      ...Object.entries(payload)
        .sort(([a], [b]) => services.technicalFieldLabel(a).localeCompare(services.technicalFieldLabel(b)))
        .flatMap(([key, value]) => [
          el("dt", {}, services.technicalFieldLabel(key)),
          el(
            "dd",
            { class: value && typeof value === "object" ? "technical-spec-structured" : "" },
            valueText(value, key, services),
          ),
        ]),
    );
    empty.classList.toggle("hidden", Object.keys(payload).length > 0);
    editor.value = JSON.stringify(payload, null, 2);
  };
  render();
  const advanced = el("details", { class: "technical-spec-edit" }, [
    el("summary", {}, "Edit structured data (advanced)"),
    el(
      "p",
      { class: "muted small" },
      "Edit the JSON object below. Identity, picture, and datasheet fields are managed above.",
    ),
    editor,
  ]);
  const node = el("details", { class: "technical-specs" }, [
    el("summary", {}, "Technical specifications"),
    el("div", { class: "technical-spec-view" }, [rows, empty]),
    advanced,
  ]);
  return {
    node,
    set(next: GearValue) {
      render(normalizePresetTechnical(typeKind, technicalPayload(typeKind, next, services, true), services));
    },
    read(): GearValue {
      const text = editor.value.trim();
      if (!text) return {};
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Technical specifications must be valid JSON");
      }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error("Technical specifications must be a JSON object");
      return technicalPayload(typeKind, parsed as GearValue, services, true);
    },
  };
}
