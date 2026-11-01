import { el, field, openModal, toast } from "@hypo/ui";
import { developmentPlanSnapshot, validateDevelopmentPlan, type DevelopmentPlanValue } from "@hypo/domain";
import { createDevelopmentStepEditor } from "./development-step-editor.ts";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";

const NSID = "app.graycard.process.developmentPlan";

export function openDevelopmentPlanEditor(
  services: ActivityServices,
  onDone: () => void,
  existing: LibraryRecord | null = null,
) {
  const value = existing?.value || {};
  const name = el("input", { value: value.name || "", maxlength: "128", placeholder: "e.g. HP5+ in ID-11, 1+1" });
  const process = el(
    "select",
    {},
    ["bw", "monobath", "c41", "e6", "ecn2", "reversal-bw", "other"].map((kind) =>
      el("option", { value: kind }, services.enumLabel(kind)),
    ),
  );
  process.value = String(value.process || "bw");
  const tank = el(
    "select",
    {},
    ["tank", "tray", "rotary", "dip-and-dunk", "roller-transport", "other"].map((kind) =>
      el("option", { value: kind }, services.enumLabel(kind)),
    ),
  );
  tank.value = String(value.tankType || "tank");
  const notes = el(
    "textarea",
    { rows: "3", maxlength: "2000", placeholder: "Reusable setup notes" },
    value.notes || "",
  );
  const stages = createDevelopmentStepEditor(services, Array.isArray(value.steps) ? value.steps : []);
  return openModal(
    existing ? "Edit film-processing sequence" : "New film-processing sequence",
    [
      el(
        "p",
        { class: "muted small" },
        "Plan the ordered baths, times, temperatures, agitation, and chemistry. Actual measurements stay in each development session.",
      ),
      field("Sequence name", name),
      field("Film process", process),
      field("Tank or processor", tank),
      el("h3", { class: "modal-sub" }, "Ordered stages"),
      stages.node,
      field("Notes", notes),
    ],
    async () => {
      const plan: LibraryValue = {
        ...developmentPlanSnapshot({
          name: name.value.trim(),
          process: process.value,
          tankType: tank.value,
          steps: stages.read(),
          notes: notes.value.trim() || undefined,
        }),
        createdAt: value.createdAt || new Date().toISOString(),
        ...(existing ? { updatedAt: new Date().toISOString() } : {}),
      };
      validateDevelopmentPlan(plan as DevelopmentPlanValue);
      await services.saveRecord(NSID, plan, existing);
      await services.reloadStore();
      toast(existing ? "Processing sequence updated" : "Processing sequence saved", "ok");
      onDone();
    },
    { wide: true, saveLabel: existing ? "Save changes" : "Save sequence" },
  );
}
