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

export interface DateTimeRangeOptions {
  startLabel?: string;
  endLabel?: string;
  startValue?: string;
  endValue?: string;
  className?: string;
  requireEnd?: boolean;
  missingEndMessage?: string;
  chronologyMessage?: string;
}

export interface DateTimeRangeValue {
  start?: string;
  end?: string;
}

export interface DateTimeRangeControl {
  node: HTMLDivElement;
  start: FieldControl<HTMLInputElement>;
  end: FieldControl<HTMLInputElement>;
  error: HTMLElement;
  read(): DateTimeRangeValue;
  clearError(): void;
  setDisabled(disabled: boolean): void;
}

let dateTimeRangeSerial = 0;

export function dateField(
  labelText: DomChild,
  value = "",
  { type = "datetime-local" }: DateFieldOptions = {},
): FieldControl<HTMLInputElement> {
  const input = el("input", { type, class: "date-input" });
  input.value = isoToLocalInput(value, type === "datetime-local");
  return { wrap: field(labelText, input), input };
}

/**
 * Two local datetime controls for a positive-duration interval.
 *
 * Either endpoint may be omitted unless `requireEnd` is set. When both are
 * present, `read()` requires the end to be later than the start and reports the
 * problem beside the end field without altering either input.
 */
export function dateTimeRange(options: DateTimeRangeOptions = {}): DateTimeRangeControl {
  const start = dateField(options.startLabel || "Started", options.startValue || "");
  const end = dateField(options.endLabel || "Finished", options.endValue || "");
  const errorId = `date-time-range-error-${++dateTimeRangeSerial}`;
  const error = el("small", { id: errorId, class: "field-error hidden", role: "alert" });
  end.wrap.append(error);
  end.input.setAttribute("aria-describedby", errorId);

  const clearError = () => {
    error.textContent = "";
    error.classList.add("hidden");
    end.input.removeAttribute("aria-invalid");
  };
  const showError = (message: string): never => {
    error.textContent = message;
    error.classList.remove("hidden");
    end.input.setAttribute("aria-invalid", "true");
    end.input.focus();
    throw new Error(message);
  };
  start.input.addEventListener("input", clearError);
  end.input.addEventListener("input", clearError);

  return {
    node: el("div", { class: options.className || "process-time-grid" }, [start.wrap, end.wrap]),
    start,
    end,
    error,
    clearError,
    setDisabled(disabled) {
      start.input.disabled = disabled;
      end.input.disabled = disabled;
      if (disabled) clearError();
    },
    read() {
      clearError();
      const startValue = start.input.value ? localInputToIso(start.input.value) : null;
      const endValue = end.input.value ? localInputToIso(end.input.value) : null;
      if (start.input.value && !startValue) return showError("Enter a valid start time.");
      if (end.input.value && !endValue) return showError("Enter a valid finish time.");
      if (options.requireEnd && !endValue) {
        return showError(options.missingEndMessage || "Enter when this session finished.");
      }
      if (startValue && endValue && Date.parse(endValue) <= Date.parse(startValue)) {
        return showError(options.chronologyMessage || "Finish time must be later than start time.");
      }
      return { start: startValue || undefined, end: endValue || undefined };
    },
  };
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
