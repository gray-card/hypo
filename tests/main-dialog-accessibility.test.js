import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  actions: null,
  route: { name: "home", params: {} },
}));

vi.mock("../src/router.js", () => ({
  createRouter: () => ({
    current: () => harness.route,
    navigate: vi.fn(),
    refresh: vi.fn(),
    subscribe: vi.fn(),
  }),
}));

vi.mock("../apps/web/src/pds/session.ts", () => ({
  createSessionController: () => ({
    bootstrap: () => new Promise(() => {}),
    clearOAuthCallbackParams: vi.fn(),
    installLoginControls: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("../apps/web/src/views/galleries/index.ts", () => ({
  createGalleryListView: () => ({
    galleries: () => [],
    install: vi.fn(),
    load: vi.fn(),
  }),
}));

vi.mock("../apps/web/src/shell.ts", () => ({
  createShell: ({ actions }) => {
    harness.actions = actions;
    return {
      applyTheme: vi.fn(),
      currentDensity: () => "comfortable",
      currentTheme: () => "light",
      handle: () => "alice.test",
      install: vi.fn(),
      setDensity: vi.fn(),
      showAuthenticated: vi.fn(),
      showLoggedOut: vi.fn(),
      themePreference: () => "system",
      toggleTheme: vi.fn(),
    };
  },
  segmentedControl: (values, current, onChange, label) => {
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
  },
}));

vi.mock("../src/vision.js", () => ({
  DEFAULT_PROVIDER: "test",
  PROVIDERS: { test: { label: "Test provider" } },
  validateConfig: vi.fn(),
}));

vi.mock("../src/registry.js", () => ({
  DEFAULT_CONSTELLATION: "https://constellation.test",
  constellationBase: () => "https://constellation.test",
  setConstellationBase: vi.fn(),
}));

await import("../src/main.js");

function triggerButton(label) {
  const trigger = document.createElement("button");
  trigger.textContent = label;
  document.body.append(trigger);
  trigger.focus();
  return trigger;
}

function expectNamedModal(name) {
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.getAttribute("aria-label")).toBe(name);
  return dialog;
}

function expectTabWrapAndEscapeRestore(dialog, trigger) {
  const focusable = [...dialog.querySelectorAll("button,input,select,textarea")].filter(
    (element) => !element.disabled && element.tabIndex >= 0,
  );
  expect(document.activeElement).toBe(focusable[0]);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(focusable.at(-1));

  focusable.at(-1).focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(focusable[0]);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("main dialog accessibility", () => {
  it("traps Settings focus and restores its trigger on Escape", async () => {
    const trigger = triggerButton("Open settings");
    await harness.actions.openSettings();

    expectTabWrapAndEscapeRestore(expectNamedModal("Settings"), trigger);
  });

  it("gives Keyboard Shortcuts the shared modal keyboard contract", () => {
    const trigger = triggerButton("Open shortcuts");
    harness.actions.openShortcuts();

    expectTabWrapAndEscapeRestore(expectNamedModal("Keyboard shortcuts"), trigger);
  });

  it("keeps Share Setup focus contained and restores its trigger", () => {
    const trigger = triggerButton("Share setup");
    harness.actions.shareSetup();

    expectTabWrapAndEscapeRestore(expectNamedModal("Share your setup"), trigger);
  });
});
