import { applyTemplateDefaults, stepsFromTemplate, type WorkflowStep } from "@hypo/domain";
import { el, field } from "@hypo/ui";
import type { LibraryRecord } from "./maintenance-types.ts";

export interface WorkflowOccurrenceEditor {
  readonly node: HTMLDivElement;
  read(): Record<string, number>;
}

/** Occurrence controls shared by roll- and shoot-based workflow launchers. */
export function createWorkflowOccurrenceEditor(
  templateSelect: HTMLSelectElement,
  templates: readonly LibraryRecord[],
  labels: Readonly<Record<string, string>> = {},
): WorkflowOccurrenceEditor {
  const node = el("div", { class: "workflow-occurrence-fields" });
  let controls: Array<{ step: WorkflowStep; input: HTMLInputElement; min: number; max?: number }> = [];
  const render = () => {
    node.replaceChildren();
    const template = templates.find((candidate) => candidate.uri === templateSelect.value);
    if (!template) {
      controls = [];
      return;
    }
    const steps = applyTemplateDefaults(stepsFromTemplate(template), template);
    controls = steps
      .filter(
        (step) => step.optional || step.cardinality?.min !== step.cardinality?.max || (step.cardinality?.max ?? 1) > 1,
      )
      .map((step) => {
        const min = step.optional ? 0 : (step.cardinality?.min ?? 1);
        const max = step.cardinality?.max;
        const input = el("input", {
          type: "number",
          min: String(min),
          ...(max === undefined ? {} : { max: String(max) }),
          step: "1",
          value: String(min),
        });
        node.append(
          field(
            `${step.label || labels[step.kind] || step.kind} (${min}${max === undefined ? "+" : `–${max}`})`,
            input,
          ),
        );
        return { step, input, min, max };
      });
    if (controls.length) {
      node.prepend(
        el(
          "p",
          { class: "muted small" },
          "Choose how many optional or repeatable steps to plan. You can omit an optional step now and use another run later.",
        ),
      );
    }
  };
  templateSelect.addEventListener("change", render);
  render();
  return {
    node,
    read() {
      return Object.fromEntries(
        controls.map(({ step, input, min, max }) => {
          const count = Number(input.value);
          if (!Number.isInteger(count) || count < min || (max !== undefined && count > max)) {
            throw new Error(
              `${step.label || labels[step.kind] || step.kind} must be ${max === undefined ? `${min} or more` : `between ${min} and ${max}`}`,
            );
          }
          return [step.id, count];
        }),
      );
    },
  };
}
