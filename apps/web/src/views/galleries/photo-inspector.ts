import { el } from "@hypo/ui";

export interface InspectorPhoto {
  card: HTMLElement;
  fields: HTMLElement;
  control: HTMLElement;
}

/** Keep each photo's live form mounted so navigation never discards a draft. */
export function createPhotoInspector(photos: HTMLElement, entries: InspectorPhoto[]) {
  let active: InspectorPhoto | undefined;
  let returnPosition = { left: 0, top: 0 };
  const compact = () => window.matchMedia("(max-width: 899px)").matches;
  const title = el("h2", { id: "photo-inspector-title", tabindex: "-1" });
  const previous = el("button", { class: "ghost small-btn", onclick: () => move(-1) }, "Previous photo");
  const next = el("button", { class: "ghost small-btn", onclick: () => move(1) }, "Next photo");
  const closeButton = el("button", { class: "ghost small-btn", onclick: () => close() }, "Back to photos");
  const node = el(
    "aside",
    {
      id: "photo-inspector",
      class: "photo-inspector card",
      "aria-labelledby": title.id,
      hidden: true,
    },
    [
      el("div", { class: "inspector-heading" }, [title, closeButton]),
      el("div", { class: "row wrap inspector-navigation", "aria-label": "Photo navigation" }, [previous, next]),
    ],
  );
  const ordered = () =>
    entries
      .filter((entry) => !entry.card.hidden)
      .sort((a, b) => [...photos.children].indexOf(a.card) - [...photos.children].indexOf(b.card));
  const sections = (entry: InspectorPhoto) => [
    ...entry.fields.querySelectorAll<HTMLDetailsElement>("details[data-photo-section]"),
  ];
  function open(entry: InspectorPhoto, focus = true) {
    if (!active) returnPosition = { left: window.scrollX, top: window.scrollY };
    if (active && active !== entry) {
      const expanded = new Set(
        sections(active)
          .filter((detail) => detail.open)
          .map((detail) => detail.dataset.photoSection),
      );
      sections(entry).forEach((detail) => {
        detail.open = expanded.has(detail.dataset.photoSection);
      });
    }
    active = entry;
    node.hidden = false;
    photos.parentElement?.classList.add("has-inspector");
    entries.forEach((item) => {
      item.fields.hidden = item !== entry;
      item.card.classList.toggle("photo-focused", item === entry);
      item.control.setAttribute("aria-expanded", String(item === entry));
    });
    const index = ordered().indexOf(entry);
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index === ordered().length - 1;
    title.textContent = `Photo ${entry.card.dataset.frame || index + 1}`;
    if (focus) title.focus({ preventScroll: !compact() });
  }
  function close(restorePosition = true) {
    const prior = active;
    node.hidden = true;
    photos.parentElement?.classList.remove("has-inspector");
    entries.forEach((item) => {
      item.fields.hidden = true;
      item.card.classList.remove("photo-focused");
      item.control.setAttribute("aria-expanded", "false");
    });
    active = undefined;
    if (prior && restorePosition) {
      prior.control.focus({ preventScroll: true });
      const position = { ...returnPosition, behavior: "instant" as const };
      window.scrollTo(position);
      // Layout and focus restoration can apply scroll anchoring after this event.
      requestAnimationFrame(() => {
        if (!active && photos.isConnected) window.scrollTo(position);
      });
    }
  }
  function move(direction: number) {
    const items = ordered();
    const index = active ? items.indexOf(active) : -1;
    const entry = items[Math.max(0, Math.min(items.length - 1, index < 0 ? 0 : index + direction))];
    if (entry) open(entry);
  }
  for (const entry of entries) {
    entry.fields.hidden = true;
    node.append(entry.fields);
    entry.control.setAttribute("role", "button");
    entry.control.tabIndex = 0;
    entry.control.setAttribute("aria-controls", node.id);
    entry.control.setAttribute("aria-expanded", "false");
    entry.control.setAttribute("aria-label", `Edit ${entry.control.dataset.gridPhotoLabel || "photo"}`);
    entry.control.addEventListener("click", () => open(entry));
    entry.control.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(entry);
    });
    entry.fields.addEventListener("reveal-photo-field", (event) => {
      open(entry, false);
      if (!(event.target instanceof HTMLElement)) return;
      let parent = event.target.parentElement;
      while (parent && parent !== entry.fields) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      event.target.focus();
    });
  }
  photos.addEventListener("photo-order-changed", () => {
    if (active) open(active, false);
  });
  photos.addEventListener("navigate-photo", (event) => move((event as CustomEvent<number>).detail));
  return { node, close, move };
}
