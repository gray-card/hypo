import { beforeEach, describe, expect, it, vi } from "vitest";
import { openModal } from "@hypo/ui";
import { createPaletteCommands } from "../apps/web/src/actions/palette.ts";
import { createSettingsActions } from "../apps/web/src/actions/settings.ts";
import { createShareActions } from "../apps/web/src/actions/share.ts";
import { createShortcutActions, SHORTCUT_ROWS } from "../apps/web/src/actions/shortcuts.ts";

const provider = {
  id: "test",
  label: "Test provider",
  keyLabel: "API key",
  keyPlaceholder: "key_test",
  keyHint: "Stored locally",
  keyUrl: "https://provider.test/keys",
  billingNote: "Provider charges may apply.",
  models: [{ id: "model-1", label: "Model 1" }],
  defaultModel: "model-1",
};

const segmentedControl = (values, current, onChange, label) => {
  const group = document.createElement("div");
  for (const value of values) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label(value);
    button.setAttribute("aria-pressed", String(value === current));
    button.addEventListener("click", () => onChange(value));
    group.append(button);
  }
  return group;
};

function settingsHarness(overrides = {}) {
  const services = {
    loadVision: vi.fn(async () => ({
      PROVIDERS: { test: provider },
      DEFAULT_PROVIDER: "test",
      validateConfig: vi.fn(async () => undefined),
    })),
    loadRegistry: vi.fn(async () => ({
      DEFAULT_CONSTELLATION: "https://constellation.test",
      constellationBase: () => "https://constellation.test",
      setConstellationBase: vi.fn(),
    })),
    openModal,
    toast: vi.fn(),
    segmentedControl,
    getVisionConfig: () => null,
    setVisionConfig: vi.fn(),
    isAdvanced: () => false,
    setAdvanced: vi.fn(),
    themePreference: () => "system",
    applyTheme: vi.fn(),
    currentDensity: () => "comfortable",
    setDensity: vi.fn(),
    isSetupActive: () => true,
    openLibrary: vi.fn(),
    ...overrides,
  };
  return { services, actions: createSettingsActions(services) };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("web action boundaries", () => {
  it("routes Settings preferences and discovery changes through injected services", async () => {
    const setConstellationBase = vi.fn();
    const { actions, services } = settingsHarness({
      loadRegistry: vi.fn(async () => ({
        DEFAULT_CONSTELLATION: "https://constellation.test",
        constellationBase: () => "https://self-hosted.test",
        setConstellationBase,
      })),
    });

    await actions.openSettings();
    const dialog = document.querySelector('[aria-label="Settings"]');
    const advanced = dialog.querySelector('input[type="checkbox"]');
    advanced.checked = true;
    advanced.dispatchEvent(new Event("change"));
    const index = dialog.querySelector('input[type="url"]');
    index.value = "https://new-index.test/";
    index.dispatchEvent(new Event("change"));

    expect(services.setAdvanced).toHaveBeenCalledWith(true);
    expect(services.openLibrary).toHaveBeenCalledOnce();
    expect(setConstellationBase).toHaveBeenCalledWith("https://new-index.test/");
    expect(services.toast).toHaveBeenCalledWith("Discovery index updated", "ok");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("validates and stores an image-analysis connection through injected services", async () => {
    const validateConfig = vi.fn(async () => undefined);
    const loadVision = vi.fn(async () => ({
      PROVIDERS: { test: provider },
      DEFAULT_PROVIDER: "test",
      validateConfig,
    }));
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { actions, services } = settingsHarness({ loadVision });

    await actions.openVisionConnect();
    const dialog = document.querySelector('[aria-label="Image analysis"]');
    dialog.querySelector('input[type="password"]').value = "secret";
    [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Save & connect").click();

    await vi.waitFor(() => {
      expect(services.setVisionConfig).toHaveBeenCalledWith({
        provider: "test",
        apiKey: "secret",
        model: "model-1",
      });
    });
    expect(validateConfig).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps shortcut help and sharing on the shared modal lifecycle", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    createShortcutActions({ openModal }).openShortcuts();
    expect(document.querySelector('[aria-label="Keyboard shortcuts"]').textContent).toContain(SHORTCUT_ROWS[0][1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(trigger);

    const fallbackCopy = vi.fn();
    const share = vi.fn(async () => undefined);
    const toast = vi.fn();
    const actions = createShareActions({
      openModal,
      icon: () => document.createElement("span"),
      toast,
      profileIdentifier: () => "alice.test",
      writeClipboard: vi.fn(async () => {
        throw new Error("blocked");
      }),
      fallbackCopy,
      canShare: () => true,
      share,
    });
    actions.shareSetup();
    const shareDialog = document.querySelector('[aria-label="Share your setup"]');
    const buttons = [...shareDialog.querySelectorAll("button")];
    expect(shareDialog.querySelectorAll(".modal-actions")).toHaveLength(1);
    expect(buttons.map((button) => button.textContent)).toEqual(["Copy link", "Share…", "Close"]);
    buttons.find((button) => button.textContent === "Copy link").click();
    await vi.waitFor(() => expect(fallbackCopy).toHaveBeenCalledOnce());
    buttons.find((button) => button.textContent === "Share…").click();

    expect(share).toHaveBeenCalledWith({
      title: "My graycard setup",
      url: "https://hypo.graycard.app/profile/alice.test",
    });
    expect(toast).toHaveBeenCalledWith("Link copied", "ok");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(trigger);
  });

  it("constructs static, gallery, and handle commands from injected app callbacks", () => {
    const openMeter = vi.fn();
    const openGallery = vi.fn();
    const navigateProfile = vi.fn();
    const commandsFor = createPaletteCommands({
      navigateSection: vi.fn(),
      openMeter,
      openBundle: vi.fn(),
      openVisionConnect: vi.fn(),
      shareSetup: vi.fn(),
      publishSetup: vi.fn(),
      profileHandle: () => "alice.test",
      navigateProfile,
      currentTheme: () => "dark",
      toggleTheme: vi.fn(),
      openSettings: vi.fn(),
      openShortcuts: vi.fn(),
      reloadGalleries: vi.fn(),
      signOut: vi.fn(),
      galleries: () => [{ uri: "at://did/social.grain.gallery/summer", value: { title: "Summer Lake" } }],
      openGallery,
      filter: (query, commands) => commands.filter((command) => command.label.toLowerCase().includes(query)),
      matches: (query, value) => value.toLowerCase().includes(query),
    });

    const staticCommands = commandsFor("");
    expect(staticCommands.map((command) => command.label)).toContain("Toggle theme → light");
    staticCommands.find((command) => command.label === "Light meter").run();
    expect(openMeter).toHaveBeenCalledOnce();

    commandsFor("summer")
      .find((command) => command.label === "↦ Summer Lake")
      .run();
    expect(openGallery).toHaveBeenCalledWith("at://did/social.grain.gallery/summer");
    commandsFor("@bob.test")
      .find((command) => command.label === "View @bob.test")
      .run();
    expect(navigateProfile).toHaveBeenCalledWith("bob.test");
  });
});
