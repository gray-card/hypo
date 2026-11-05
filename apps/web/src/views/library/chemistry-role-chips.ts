import { el } from "@hypo/ui";
import type { GearStore, GearValue } from "./gear-types.ts";

/** Roles are metadata beside a product name, rather than part of that name. */
export function chemistryRoleChips(value: GearValue, store: GearStore): HTMLSpanElement | null {
  const product = store.catalog.chemistryType?.find((item) => item.uri === value.type)?.value;
  const roles = [...new Set<string>(Array.isArray(product?.roles) ? product.roles : [])];
  if (!roles.length) return null;
  return el(
    "span",
    { class: "chemistry-role-chips", role: "group", "aria-label": "Chemistry roles" },
    roles.map((role) =>
      el(
        "span",
        { class: "chip chemistry-role-chip" },
        role === "stop" ? "Stop bath" : role.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase()),
      ),
    ),
  );
}
