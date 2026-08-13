export interface ActionCommand {
  label: string;
  iconName: string;
  hint?: string;
  run(): unknown;
}

export interface PaletteGallery {
  uri: string;
  value: { title?: string | null };
}

export interface PaletteActionServices {
  navigateSection(section: "setup" | "galleries" | "following" | "discover"): unknown;
  openMeter(): unknown;
  openBundle(): unknown;
  openVisionConnect(): unknown;
  shareSetup(): unknown;
  publishSetup(): unknown;
  profileHandle(): string | null | undefined;
  navigateProfile(handle: string): unknown;
  currentTheme(): string;
  toggleTheme(): unknown;
  openSettings(): unknown;
  openShortcuts(): unknown;
  reloadGalleries(): unknown;
  signOut(): unknown;
  galleries(): readonly PaletteGallery[];
  openGallery(uri: string): unknown;
  filter(query: string, commands: ActionCommand[]): ActionCommand[];
  matches(query: string, value: string): boolean;
}

/** Construct command-palette entries from injected navigation and app actions. */
export function createPaletteCommands(services: PaletteActionServices) {
  return (query: string): ActionCommand[] => {
    const commands: ActionCommand[] = [];
    const add = (label: string, iconName: string, run: () => unknown, hint?: string): void => {
      commands.push({ label, iconName, run, hint });
    };

    add("Setup: your gear", "camera", () => services.navigateSection("setup"));
    add("Light meter", "camera", services.openMeter);
    add("Galleries", "image", () => services.navigateSection("galleries"));
    add("Following activity", "users", () => services.navigateSection("following"));
    add("Discover setups", "compass", () => services.navigateSection("discover"));
    add("Export / import bundle", "download", services.openBundle);
    add("Image analysis (connect / settings)", "sparkles", services.openVisionConnect);
    add("Share my setup", "share", services.shareSetup);
    add("Publish my setup to Discover", "compass", services.publishSetup);
    add("View my public setup", "compass", () => {
      const handle = services.profileHandle();
      if (handle) services.navigateProfile(handle);
    });
    const dark = services.currentTheme() === "dark";
    add(`Toggle theme → ${dark ? "light" : "dark"}`, dark ? "sun" : "moon", services.toggleTheme);
    add("Settings", "gear", services.openSettings);
    add("Keyboard shortcuts", "keyboard", services.openShortcuts);
    add("Reload galleries", "refresh", services.reloadGalleries);
    add("Sign out", "x", services.signOut);

    const output = query ? services.filter(query, commands) : commands;
    if (query) {
      for (const gallery of services.galleries()) {
        if (services.matches(query, gallery.value.title || "")) {
          output.push({
            label: `↦ ${gallery.value.title || "(untitled)"}`,
            iconName: "image",
            run: () => services.openGallery(gallery.uri),
          });
        }
        if (output.length > 30) break;
      }
    }
    if (query && (query.startsWith("@") || query.includes("."))) {
      const handle = query.replace(/^@/, "");
      output.push({
        label: `View @${handle}`,
        iconName: "users",
        run: () => services.navigateProfile(handle),
      });
    }
    return output;
  };
}
