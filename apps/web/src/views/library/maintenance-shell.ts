import { $, el, loadPhase } from "@hypo/ui";

export interface LibraryShellServices {
  readonly tabLabels: Readonly<Record<string, string>>;
  readonly gearTabs: Readonly<Record<string, readonly string[]>>;
  hasStore(): boolean;
  loadStore(): Promise<void>;
  matches(query: string, text: string | null): boolean;
  renderFilm(body: HTMLElement): void;
  renderDarkroomHeader(body: HTMLElement): void;
  renderScanningHeader(body: HTMLElement): void;
  renderGear(body: HTMLElement, kinds: readonly string[]): void;
  renderShoots(body: HTMLElement): void;
  renderWorkflows(body: HTMLElement): void;
  renderRules(body: HTMLElement): void;
  renderInsights(body: HTMLElement): void;
}

export function librarySkeleton(): HTMLElement[] {
  return [
    el(
      "div",
      { class: "tab-bar skeleton-tabs" },
      Array.from({ length: 5 }, () => el("div", { class: "skeleton skeleton-tab" })),
    ),
    ...Array.from({ length: 3 }, () =>
      el("div", { class: "card" }, [
        el("div", { class: "skeleton skeleton-title" }),
        el("div", { class: "skeleton skeleton-line" }),
        el("div", { class: "skeleton skeleton-line" }),
      ]),
    ),
  ];
}

export async function renderLibraryShell(
  bodyElement: HTMLElement | null | undefined,
  services: LibraryShellServices,
): Promise<void> {
  const body = bodyElement || ($("#library-body") as HTMLElement);
  if (!services.hasStore()) {
    const phase = loadPhase("Loading your setup from your PDS…");
    body.replaceChildren(...librarySkeleton(), phase.node);
    try {
      await services.loadStore();
    } finally {
      phase.clear();
    }
  }
  body.replaceChildren();
  let tab = body.dataset.tab || "cameras";
  if (!services.tabLabels[tab]) tab = "cameras";
  const tabs = el("div", { class: "tab-bar" });
  for (const [id, label] of Object.entries(services.tabLabels)) {
    tabs.append(
      el(
        "button",
        {
          class: `ghost tab-btn${tab === id ? " active" : ""}`,
          onclick: () => {
            body.dataset.tab = id;
            void renderLibraryShell(body, services);
          },
        },
        label,
      ),
    );
  }
  body.append(tabs);
  const search = el("input", {
    type: "search",
    class: "search-input",
    placeholder: "Filter…",
    "aria-label": "Filter setup",
  });
  search.addEventListener("input", () => {
    const query = search.value.trim();
    for (const row of body.querySelectorAll(".gear-row"))
      row.classList.toggle("hidden", Boolean(query) && !services.matches(query, row.textContent));
  });
  body.append(search);

  if (tab === "film") services.renderFilm(body);
  else if (tab === "darkroom") {
    services.renderDarkroomHeader(body);
    services.renderGear(body, services.gearTabs.darkroom);
  } else if (tab === "scanning") {
    services.renderScanningHeader(body);
    services.renderGear(body, services.gearTabs.scanning);
  } else if (services.gearTabs[tab]) services.renderGear(body, services.gearTabs[tab]);
  else if (tab === "shoots") services.renderShoots(body);
  else if (tab === "workflows") services.renderWorkflows(body);
  else if (tab === "rules") services.renderRules(body);
  else if (tab === "insights") services.renderInsights(body);

  const cards = [...body.querySelectorAll<HTMLElement>(":scope > .card")];
  cards.forEach((card, index) => {
    card.classList.add("reveal");
    card.style.setProperty("--i", String(index));
  });
}
