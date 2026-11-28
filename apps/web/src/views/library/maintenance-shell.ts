import { $, el, loadPhase } from "@hypo/ui";
import type { LibraryNavigationGroup } from "./maintenance-types.ts";

export interface LibraryShellServices {
  readonly navigationGroups: readonly LibraryNavigationGroup[];
  readonly gearTabs: Readonly<Record<string, readonly string[]>>;
  readonly defaultTab: string;
  hasStore(): boolean;
  loadStore(): Promise<void>;
  matches(query: string, text: string | null): boolean;
  renderOverview(body: HTMLElement): void;
  renderFilmReserve(body: HTMLElement): void;
  renderGear(body: HTMLElement, kinds: readonly string[]): void;
  renderWorkflowTemplates(body: HTMLElement): void;
  renderBatchRules(body: HTMLElement): void;
  renderDataQuality(body: HTMLElement): void;
}

export function librarySkeleton(): HTMLElement[] {
  return [
    el("div", { class: "library-shell library-shell-loading" }, [
      el(
        "div",
        { class: "library-navigation skeleton-tabs" },
        Array.from({ length: 7 }, () => el("div", { class: "skeleton skeleton-tab" })),
      ),
      el(
        "div",
        { class: "library-content" },
        Array.from({ length: 3 }, () =>
          el("div", { class: "card" }, [
            el("div", { class: "skeleton skeleton-title" }),
            el("div", { class: "skeleton skeleton-line" }),
            el("div", { class: "skeleton skeleton-line" }),
          ]),
        ),
      ),
    ]),
  ];
}

const LEGACY_TABS: Readonly<Record<string, string>> = {
  shoots: "overview",
  insights: "overview",
};

function navigationItems(groups: readonly LibraryNavigationGroup[]) {
  return groups.flatMap((group) => group.items);
}

function libraryNavigation(
  groups: readonly LibraryNavigationGroup[],
  activeTab: string,
  select: (tab: string) => void,
  className: string,
): HTMLElement {
  return el(
    "nav",
    { class: className, "aria-label": "Library sections" },
    groups.map((group) =>
      el("section", { class: "library-navigation-group" }, [
        el("h3", {}, group.label),
        ...group.items.map((item) =>
          el(
            "button",
            {
              type: "button",
              class: `library-navigation-item${activeTab === item.id ? " active" : ""}`,
              "aria-current": activeTab === item.id ? "page" : undefined,
              onclick: () => select(item.id),
            },
            item.label,
          ),
        ),
      ]),
    ),
  );
}

export async function renderLibraryShell(
  bodyElement: HTMLElement | null | undefined,
  services: LibraryShellServices,
): Promise<void> {
  const body = bodyElement || ($("#library-body") as HTMLElement);
  const existingNavigation = body.querySelector<HTMLDetailsElement>(":scope > .library-navigation-mobile");
  if (!services.hasStore()) {
    const phase = loadPhase("Loading your library from your PDS…");
    body.replaceChildren(...librarySkeleton(), phase.node);
    try {
      await services.loadStore();
    } finally {
      phase.clear();
    }
  }
  const items = navigationItems(services.navigationGroups);
  const knownTabs = new Set(items.map((item) => item.id));
  let tab = LEGACY_TABS[body.dataset.tab || ""] || body.dataset.tab || services.defaultTab;
  if (!knownTabs.has(tab)) tab = services.defaultTab;
  body.dataset.tab = tab;

  // Keep the native summary attached so a refresh cannot interrupt a press in progress.
  const mobileLabel = existingNavigation?.querySelector("summary > strong") ?? el("strong");
  const mobileNavigation =
    existingNavigation ??
    el("details", { class: "library-navigation-mobile" }, [
      el("summary", {}, [el("span", { class: "muted small" }, "Library section"), mobileLabel]),
    ]);
  const currentLabel = items.find((item) => item.id === tab)?.label || "Library";
  if (mobileLabel.textContent !== currentLabel) mobileLabel.textContent = currentLabel;

  const select = (next: string) => {
    mobileNavigation.open = false;
    body.dataset.tab = next;
    void renderLibraryShell(body, services);
  };
  const desktopNavigation = libraryNavigation(services.navigationGroups, tab, select, "library-navigation");
  const mobileMenu = libraryNavigation(
    services.navigationGroups,
    tab,
    select,
    "library-navigation library-navigation-menu",
  );
  const existingMenu = mobileNavigation.querySelector(":scope > .library-navigation-menu");
  if (existingMenu) existingMenu.replaceWith(mobileMenu);
  else mobileNavigation.append(mobileMenu);
  const content = el("div", { class: "library-content" });
  const search = el("input", {
    type: "search",
    class: "search-input",
    placeholder: "Filter…",
    "aria-label": "Filter library",
  });
  search.addEventListener("input", () => {
    const query = search.value.trim();
    for (const row of content.querySelectorAll(".gear-row"))
      row.classList.toggle("hidden", Boolean(query) && !services.matches(query, row.textContent));
  });
  if (services.gearTabs[tab]) content.append(search);

  if (tab === "overview") services.renderOverview(content);
  else if (tab === "film") services.renderFilmReserve(content);
  else if (services.gearTabs[tab]) services.renderGear(content, services.gearTabs[tab]);
  else if (tab === "workflows") services.renderWorkflowTemplates(content);
  else if (tab === "rules") services.renderBatchRules(content);
  else if (tab === "quality") services.renderDataQuality(content);

  for (const child of [...body.childNodes]) {
    if (child !== mobileNavigation) child.remove();
  }
  if (mobileNavigation.parentElement !== body) body.append(mobileNavigation);
  body.append(el("div", { class: "library-shell" }, [desktopNavigation, content]));

  const cards = [...content.querySelectorAll<HTMLElement>(":scope > .card")];
  cards.forEach((card, index) => {
    card.classList.add("reveal");
    card.style.setProperty("--i", String(index));
  });
}
