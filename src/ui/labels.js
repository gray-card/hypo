// labels.js: compatibility helpers over the typed lexicon metadata layer.
// Nothing camelCase, kebab, or an AT-URI collection id should reach the DOM
// without passing through these functions.

import {
  ACRONYM_LABELS,
  ENUM_LABELS,
  EXTERNAL_COLLECTION_LABELS,
  GEAR_GROUPS,
  KIND_METADATA,
  RECORD_SCHEMA_META,
  TECHNICAL_FIELD_LABELS,
} from "../../packages/lexicon/src/schema-meta.ts";

export { GEAR_GROUPS, TECHNICAL_FIELD_LABELS };

export function kindLabel(kind) {
  return KIND_METADATA[kind]?.labels.one || humanize(kind);
}

export function kindLabelPlural(kind) {
  return KIND_METADATA[kind]?.labels.many || humanize(kind);
}

export function enumLabel(value) {
  if (value == null || value === "") return "";
  if (ENUM_LABELS[value]) return ENUM_LABELS[value];
  // already display-ready (proper noun, acronym, or spaced), e.g. mount names
  // "Nikon F", "Canon EF", "Micro Four Thirds": don't mangle the casing.
  if (/\s/.test(value) || /[A-Z]/.test(value.slice(1))) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  return humanize(value);
}

export function collectionLabel(collection) {
  if (EXTERNAL_COLLECTION_LABELS[collection]) return EXTERNAL_COLLECTION_LABELS[collection];
  const metadata = RECORD_SCHEMA_META[collection];
  if (metadata) return metadata.labels.collection || metadata.labels.one;
  const tail = collection.split(".").pop();
  return kindLabel(tail);
}

export function technicalFieldLabel(key) {
  return (
    TECHNICAL_FIELD_LABELS[key] ||
    String(key)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

// split camelCase / kebab / snake into a sentence-cased phrase, fixing acronyms.
export function humanize(id) {
  if (id == null) return "";
  const words = String(id)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .split(/\s+/);
  return (
    words
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (ACRONYM_LABELS[lower]) return ACRONYM_LABELS[lower];
        return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : lower;
      })
      .join(" ") || ""
  );
}
