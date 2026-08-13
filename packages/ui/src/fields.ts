import { el, type DomChild } from "./element.ts";

export function field(labelText: DomChild, control: Node): HTMLLabelElement {
  return el("label", { class: "field" }, [el("span", {}, labelText), control]);
}

// ISO-8601 <-> native date/datetime-local input value (local timezone).
export function isoToLocalInput(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  if (!withTime) {
    // Date-only fields are timezone-agnostic calendar dates stored as UTC
    // midnight. UTC parts prevent the day slipping in negative offsets.
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localInputToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface DateFieldOptions {
  type?: "datetime-local" | "date";
}

export interface FieldControl<Control extends HTMLElement> {
  wrap: HTMLLabelElement;
  input: Control;
}

export function dateField(
  labelText: DomChild,
  value = "",
  { type = "datetime-local" }: DateFieldOptions = {},
): FieldControl<HTMLInputElement> {
  const input = el("input", { type, class: "date-input" });
  input.value = isoToLocalInput(value, type === "datetime-local");
  return { wrap: field(labelText, input), input };
}

export function inputField(
  labelText: DomChild,
  key: string,
  value: string | number = "",
  placeholder = "",
): FieldControl<HTMLInputElement> {
  const input = el("input", { type: "text", value: value || "", placeholder, "data-key": key });
  return { wrap: field(labelText, input), input };
}
