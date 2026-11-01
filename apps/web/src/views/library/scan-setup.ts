import { el, field, openModal, toast } from "@hypo/ui";
import type { ActivityServices, LibraryRecord, LibraryValue } from "./maintenance-types.ts";

const ROLES = [
  "capture-camera",
  "capture-lens",
  "scanner",
  "camera-support",
  "film-carrier",
  "film-mask",
  "light-source",
  "diffuser",
  "adapter",
  "remote-release",
  "calibration-target",
  "software",
];

function parseSettings(text: string): LibraryValue[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const split = line.indexOf("=");
      if (split < 1 || !line.slice(split + 1).trim()) throw new Error(`Use “setting = value” for “${line}”.`);
      return { key: line.slice(0, split).trim(), value: line.slice(split + 1).trim() };
    });
}

function formatSettings(value: unknown): string {
  return Array.isArray(value) ? value.map((entry) => `${entry.key} = ${entry.value}`).join("\n") : "";
}

function gearChoices(services: ActivityServices): HTMLElement[] {
  const choices: HTMLElement[] = [el("option", { value: "" }, "Unlisted or borrowed item")];
  for (const [kind, records] of Object.entries(services.getStore().instance)) {
    if (kind === "scanSetup" || kind === "filmRoll" || kind === "exposure") continue;
    for (const record of records || [])
      choices.push(el("option", { value: record.uri }, `${kind}: ${services.instanceLabel(kind, record.value)}`));
  }
  return choices;
}

export function scanSetupSnapshot(value: LibraryValue): LibraryValue {
  return {
    name: String(value.name || "Unnamed setup"),
    components: structuredClone(value.components || []),
    connections: structuredClone(value.connections || []),
    settings: structuredClone(value.settings || []),
  };
}

export function createScanAssemblyEditor(initial: LibraryValue, services: ActivityServices) {
  const componentRows = el("div", { class: "stack" });
  const connectionRows = el("div", { class: "stack" });
  const settings = el(
    "textarea",
    { rows: "2", placeholder: "light level = 50%\nfilm format = 120" },
    formatSettings(initial.settings),
  );
  const components: Array<{
    id: string;
    row: HTMLElement;
    role: HTMLInputElement;
    ref: HTMLSelectElement;
    label: HTMLInputElement;
    settings: HTMLTextAreaElement;
    notes: HTMLInputElement;
  }> = [];
  const connections: Array<{
    row: HTMLElement;
    from: HTMLSelectElement;
    to: HTMLSelectElement;
    relation: HTMLInputElement;
  }> = [];

  const refreshConnections = () => {
    const options = components.map((component) => ({
      id: component.id,
      label: component.role.value || component.label.value || component.id,
    }));
    for (const connection of connections) {
      for (const select of [connection.from, connection.to]) {
        const selected = select.value;
        select.replaceChildren(...options.map((option) => el("option", { value: option.id }, option.label)));
        select.value = selected;
      }
    }
  };
  const addComponent = (value: LibraryValue = {}) => {
    const id = String(value.id || crypto.randomUUID());
    const role = el("input", {
      type: "text",
      value: value.role || "",
      list: "scan-component-roles",
      placeholder: "e.g. film-carrier",
    });
    const ref = el("select", {}, gearChoices(services));
    ref.value = String(value.ref || "");
    if (value.ref && !ref.value) ref.append(el("option", { value: value.ref }, "Previously linked equipment"));
    ref.value = String(value.ref || "");
    const label = el("input", {
      type: "text",
      value: value.label || "",
      placeholder: "Model or description, if unlisted",
    });
    const componentSettings = el("textarea", {
      rows: "2",
      placeholder: "thread size = 52 mm",
      value: formatSettings(value.settings),
    });
    const notes = el("input", { type: "text", value: value.notes || "", placeholder: "Optional notes" });
    const row = el("div", { class: "card compact" }, [
      el("div", { class: "row between" }, [
        el("strong", {}, "Component"),
        el(
          "button",
          {
            type: "button",
            class: "ghost small-btn",
            onclick: () => {
              const index = components.findIndex((component) => component.id === id);
              components.splice(index, 1);
              row.remove();
              refreshConnections();
            },
          },
          "Remove",
        ),
      ]),
      field("Role", role),
      field("Owned equipment", ref),
      field("Name or borrowed item", label),
      field("Settings (one key = value per line)", componentSettings),
      field("Notes", notes),
    ]);
    role.addEventListener("input", refreshConnections);
    label.addEventListener("input", refreshConnections);
    components.push({ id, row, role, ref, label, settings: componentSettings, notes });
    componentRows.append(row);
    refreshConnections();
  };
  const addConnection = (value: LibraryValue = {}) => {
    const from = el("select", {}, []);
    const to = el("select", {}, []);
    const relation = el("input", {
      type: "text",
      value: value.relation || "",
      placeholder: "e.g. mounted-on, illuminates",
    });
    const row = el("div", { class: "row wrap" }, [
      field("From", from),
      field("Relation", relation),
      field("To", to),
      el(
        "button",
        {
          type: "button",
          class: "ghost small-btn",
          onclick: () => {
            const index = connections.findIndex((connection) => connection.row === row);
            connections.splice(index, 1);
            row.remove();
          },
        },
        "Remove",
      ),
    ]);
    connections.push({ row, from, to, relation });
    connectionRows.append(row);
    refreshConnections();
    from.value = String(value.from || "");
    to.value = String(value.to || "");
  };
  for (const component of initial.components || []) addComponent(component);
  for (const connection of initial.connections || []) addConnection(connection);
  const node = el("div", { class: "stack" }, [
    el(
      "datalist",
      { id: "scan-component-roles" },
      ROLES.map((role) => el("option", { value: role })),
    ),
    el(
      "p",
      { class: "muted small" },
      "Add any number of components. Link an item already in your library, or name an unlisted item. Roles and relationships accept your own terms.",
    ),
    componentRows,
    el("button", { type: "button", class: "ghost small-btn", onclick: () => addComponent() }, "Add component"),
    el("h4", {}, "Connections"),
    connectionRows,
    el("button", { type: "button", class: "ghost small-btn", onclick: () => addConnection() }, "Add connection"),
    field("Whole-setup settings (one key = value per line)", settings),
  ]);
  return {
    node,
    read() {
      const entries = components.map((component) => {
        const role = component.role.value.trim();
        const ref = component.ref.value;
        const label = component.label.value.trim();
        if (!role || (!ref && !label))
          throw new Error("Each component needs a role and either linked equipment or a name.");
        return {
          id: component.id,
          role,
          ...(ref ? { ref } : {}),
          ...(label ? { label } : {}),
          ...(component.settings.value.trim() ? { settings: parseSettings(component.settings.value) } : {}),
          ...(component.notes.value.trim() ? { notes: component.notes.value.trim() } : {}),
        };
      });
      const ids = new Set(entries.map((entry) => entry.id));
      const links = connections.map((connection) => {
        if (!ids.has(connection.from.value) || !ids.has(connection.to.value) || !connection.relation.value.trim())
          throw new Error("Each connection needs two existing components and a relationship.");
        return { from: connection.from.value, to: connection.to.value, relation: connection.relation.value.trim() };
      });
      return { components: entries, connections: links, settings: parseSettings(settings.value) };
    },
  };
}

export function openScanSetupEditor(
  services: ActivityServices,
  onDone: () => void,
  existing: LibraryRecord | null = null,
): void {
  const value = existing?.value || {};
  const name = el("input", { type: "text", value: value.name || "", placeholder: "e.g. 120 copy-stand rig" });
  const notes = el("textarea", { rows: "2", value: value.notes || "" });
  const assembly = createScanAssemblyEditor(value, services);
  openModal(
    existing ? "Edit scanning setup" : "New scanning setup",
    [field("Setup name *", name), assembly.node, field("Notes", notes)],
    async () => {
      if (!name.value.trim()) throw new Error("Give the setup a name.");
      const now = new Date().toISOString();
      await services.saveRecord(
        "app.graycard.instance.scanSetup",
        {
          name: name.value.trim(),
          ...assembly.read(),
          ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
          createdAt: value.createdAt || now,
          ...(existing ? { updatedAt: now } : {}),
        },
        existing,
      );
      await services.reloadStore();
      toast(existing ? "Updated scanning setup" : "Saved scanning setup", "ok");
      onDone();
    },
    { saveLabel: existing ? "Save setup" : "Create setup" },
  );
}
