import { el } from "@hypo/ui";
import type { ActivityServices } from "./maintenance-types.ts";

export function createCatalogSelect(kind: string, value: string, services: ActivityServices): HTMLSelectElement {
  const items = services.getStore().catalog[kind] || [];
  const select = el("select", { "data-catalog-ref": kind }, [
    el("option", { value: "" }, "(none)"),
    ...items.map((item) => el("option", { value: item.uri }, services.catalogLabel(kind, item.value))),
  ]);
  select.value = value || "";
  return select;
}

export function createInstanceSelect(
  kind: string,
  value: string,
  services: ActivityServices,
  onChange: (value: string | null) => void = () => {},
): HTMLSelectElement {
  const items = services.getStore().instance[kind] || [];
  const select = el(
    "select",
    { onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value || null) },
    [
      el("option", { value: "" }, "(none)"),
      ...items.map((item) => el("option", { value: item.uri }, services.instanceLabel(kind, item.value))),
    ],
  );
  select.value = value || "";
  return select;
}

export function createChemistrySelect(
  value: string,
  roles: readonly string[] | undefined,
  services: ActivityServices,
): HTMLSelectElement {
  const options: { uri: string; label: string }[] = [];
  for (const chemistry of services.getStore().instance.chemistry || []) {
    const chemistryRoles = services.chemistryRoles(chemistry.value);
    if (roles?.length && !roles.some((role) => chemistryRoles.includes(role))) continue;
    options.push({
      uri: chemistry.uri,
      label: `${chemistryRoles.length ? `[${chemistryRoles.join(" + ")}] ` : ""}${services.instanceLabel("chemistry", chemistry.value)}`,
    });
  }
  const select = el("select", {}, [
    el("option", { value: "" }, "(none)"),
    ...options.map((option) => el("option", { value: option.uri }, option.label)),
  ]);
  select.value = value || "";
  return select;
}

export function createShootSelect(
  value: string,
  services: ActivityServices,
  onChange: (value: string | null) => void = () => {},
): HTMLSelectElement {
  const select = el(
    "select",
    { onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value || null) },
    [
      el("option", { value: "" }, "(none)"),
      ...(services.getStore().shoots || []).map((item) =>
        el("option", { value: item.uri }, item.value.label || item.uri),
      ),
    ],
  );
  select.value = value || "";
  return select;
}
