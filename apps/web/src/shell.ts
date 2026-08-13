import { $, el } from "@hypo/ui";

const PUBLIC_API = "https://public.api.bsky.app/xrpc";

type IconRenderer = (name: string, size?: number) => Node;
type TransitionRunner = (mutation: () => void) => void;

interface SectionDefinition {
  icon: string;
}

interface ShellActions {
  navigateSection(section: string): unknown;
  navigateProfile(handle: string): unknown;
  shareSetup(): unknown;
  openConflictTray(): unknown;
  refreshAccountData(): unknown;
  openBundle(): unknown;
  openSettings(): unknown;
  signOut(): unknown;
  openShortcuts(): unknown;
  openPalette(): unknown;
  saveAllDirty(): unknown;
  navigatePhotos(direction: number): unknown;
  hasSession(): boolean;
}

export interface ShellOptions {
  icon: IconRenderer;
  showView(view: string): void;
  withTransition: TransitionRunner;
  actions: ShellActions;
  publicApi?: string;
  fetch?: typeof globalThis.fetch;
}

export function segmentedControl(
  options: readonly string[],
  current: string,
  onPick: (value: string) => void,
  label: (value: string) => string = (value) => value,
): HTMLDivElement {
  const box = el("div", { class: "segmented" });
  for (const value of options) {
    const button = el(
      "button",
      {
        type: "button",
        class: "small-btn" + (value === current ? " active" : ""),
        onclick: () => {
          box.querySelectorAll("button").forEach((node) => node.classList.remove("active"));
          button.classList.add("active");
          onPick(value);
        },
      },
      label(value),
    );
    box.append(button);
  }
  return box;
}

/** Own persistent application chrome while routing remains in the composition root. */
export function createShell(options: ShellOptions) {
  const fetchImpl = options.fetch || globalThis.fetch;
  let did: string | null = null;
  let handle: string | null = null;

  const currentTheme = () =>
    document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

  const themePreference = () => {
    try {
      return localStorage.getItem("hypo:theme") || "system";
    } catch {
      return "system";
    }
  };

  const paintThemeIcon = () => {
    $("#theme-toggle")?.replaceChildren(options.icon(currentTheme() === "dark" ? "sun" : "moon"));
  };

  const applyTheme = (preference: string) => {
    const root = document.documentElement;
    options.withTransition(() => {
      if (preference === "system") {
        root.removeAttribute("data-theme");
        try {
          localStorage.removeItem("hypo:theme");
        } catch {
          // Device-local preferences may be unavailable in hardened browsers.
        }
      } else {
        root.setAttribute("data-theme", preference);
        try {
          localStorage.setItem("hypo:theme", preference);
        } catch {
          // Device-local preferences may be unavailable in hardened browsers.
        }
      }
    });
    paintThemeIcon();
  };

  const toggleTheme = () => applyTheme(currentTheme() === "dark" ? "light" : "dark");
  const currentDensity = () => document.documentElement.getAttribute("data-density") || "comfortable";
  const setDensity = (preference: string) => {
    if (preference === "compact") document.documentElement.setAttribute("data-density", "compact");
    else document.documentElement.removeAttribute("data-density");
    try {
      localStorage.setItem("hypo:density", preference);
    } catch {
      // Device-local preferences may be unavailable in hardened browsers.
    }
  };

  const showLoggedOut = () => {
    options.showView("login-view");
    const host = $("#session");
    if (!host) return;
    host.classList.remove("hidden");
    host.replaceChildren(
      el(
        "button",
        {
          class: "small-btn login-btn",
          type: "button",
          onclick: () => options.showView("login-view"),
        },
        "Log in",
      ),
    );
  };

  const closeAccountMenu = () => {
    $("#account-menu")?.classList.add("hidden");
    $("#account-btn")?.setAttribute("aria-expanded", "false");
  };

  const menuItem = (iconName: string, label: string, run: () => unknown, danger = false) =>
    el(
      "button",
      {
        class: "menu-item" + (danger ? " danger" : ""),
        role: "menuitem",
        onclick: () => {
          closeAccountMenu();
          run();
        },
      },
      [options.icon(iconName), el("span", {}, label)],
    );

  const buildAccountMenu = () => {
    const menu = $("#account-menu");
    if (!menu) return;
    menu.replaceChildren(
      el("div", { class: "menu-account" }, handle ? `@${handle}` : did || ""),
      menuItem("compass", "View my public setup", () => handle && options.actions.navigateProfile(handle)),
      menuItem("share", "Share my setup", options.actions.shareSetup),
      el("div", { class: "menu-sep" }),
      menuItem("alert", "Needs attention", options.actions.openConflictTray),
      menuItem("refresh", "Refresh from PDS", options.actions.refreshAccountData),
      menuItem("download", "Export / import bundle", options.actions.openBundle),
      menuItem("gear", "Settings", options.actions.openSettings),
      el("div", { class: "menu-sep" }),
      menuItem("users", "Switch account", () => options.showView("login-view")),
      menuItem("x", "Sign out", options.actions.signOut, true),
    );
  };

  const toggleAccountMenu = () => {
    const menu = $("#account-menu");
    if (!menu) return;
    if (menu.classList.contains("hidden")) {
      buildAccountMenu();
      menu.classList.remove("hidden");
      $("#account-btn")?.setAttribute("aria-expanded", "true");
    } else {
      closeAccountMenu();
    }
  };

  const showAuthenticated = async (nextDid: string) => {
    did = nextDid;
    handle = null;
    const host = $("#session");
    if (!host) return;
    const button = el(
      "button",
      {
        id: "account-btn",
        class: "avatar-btn",
        type: "button",
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        title: "Account and settings",
        "aria-label": "Account and settings",
        onclick: toggleAccountMenu,
      },
      [options.icon("user")],
    );
    host.replaceChildren(button);
    $("#primary-nav")?.classList.remove("hidden");
    $("#bottom-nav")?.classList.remove("hidden");
    host.classList.remove("hidden");
    try {
      const response = await fetchImpl(
        `${options.publicApi || PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(nextDid)}`,
      );
      if (!response.ok) return;
      const profile = (await response.json()) as { handle?: string; avatar?: string };
      handle = profile.handle || null;
      if (profile.avatar) button.replaceChildren(el("img", { src: profile.avatar, alt: "" }));
    } catch {
      // Keep the fallback icon when the public profile endpoint is unavailable.
    }
  };

  const installNavigation = (sections: Record<string, SectionDefinition>) => {
    document.querySelectorAll<HTMLElement>("#bottom-nav .nav-item[data-section]").forEach((button) => {
      const iconName = sections[button.dataset.section || ""]?.icon;
      if (iconName) button.querySelector(".nav-ico")?.append(options.icon(iconName, 22));
    });
    $("#bottom-account .nav-ico")?.append(options.icon("dots", 22));
    document.querySelectorAll<HTMLElement>("[data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        closeAccountMenu();
        const section = button.dataset.section;
        if (section) options.actions.navigateSection(section);
      });
    });
    $("#bottom-account")?.addEventListener("click", toggleAccountMenu);
  };

  const installKeyboardShortcuts = () => {
    window.addEventListener("keydown", (event) => {
      const editorOpen = !document.getElementById("editor-view")?.classList.contains("hidden");
      if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "S")) {
        if (editorOpen) {
          event.preventDefault();
          options.actions.saveAllDirty();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        if (options.actions.hasSession()) {
          event.preventDefault();
          options.actions.openPalette();
        }
        return;
      }
      const active = document.activeElement;
      if (
        active?.tagName === "INPUT" ||
        active?.tagName === "TEXTAREA" ||
        (active instanceof HTMLElement && active.isContentEditable)
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        const target =
          document.querySelector<HTMLElement>("#gallery-search:not(.hidden)") ||
          document.querySelector<HTMLElement>("#profile-search input") ||
          ($("#handle") as HTMLElement | null);
        target?.focus();
      } else if (event.key === "?") {
        options.actions.openShortcuts();
      } else if ((event.key === "j" || event.key === "k") && editorOpen) {
        options.actions.navigatePhotos(event.key === "j" ? 1 : -1);
      }
    });
  };

  const install = (sections: Record<string, SectionDefinition>) => {
    installNavigation(sections);
    document.addEventListener("click", (event) => {
      const menu = $("#account-menu");
      const target = event.target;
      if (!menu || menu.classList.contains("hidden") || !(target instanceof Element)) return;
      if (!menu.contains(target) && !target.closest("#account-btn") && !target.closest("#bottom-account")) {
        closeAccountMenu();
      }
    });
    try {
      if (localStorage.getItem("hypo:density") === "compact") {
        document.documentElement.setAttribute("data-density", "compact");
      }
    } catch {
      // Device-local preferences may be unavailable in hardened browsers.
    }
    paintThemeIcon();
    $("#theme-toggle")?.addEventListener("click", toggleTheme);
    $("#shortcuts-btn")?.append(options.icon("keyboard"));
    $("#shortcuts-btn")?.addEventListener("click", options.actions.openShortcuts);
    installKeyboardShortcuts();
  };

  return {
    applyTheme,
    closeAccountMenu,
    currentDensity,
    currentTheme,
    handle: () => handle,
    install,
    setDensity,
    showAuthenticated,
    showLoggedOut,
    themePreference,
    toggleTheme,
  };
}
