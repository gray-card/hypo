import { el, field, type DomChild, type OpenModalOptions, type OpenModalResult } from "@hypo/ui";

interface VisionConfig {
  provider?: string;
  apiKey?: string;
  model?: string;
}

interface VisionModel {
  id: string;
  label: string;
}

interface VisionProvider {
  id: string;
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyHint?: string;
  keyUrl?: string;
  billingNote?: string;
  models: readonly VisionModel[];
  defaultModel: string;
}

interface VisionServices {
  PROVIDERS: Record<string, VisionProvider>;
  DEFAULT_PROVIDER: string;
  validateConfig(config: Required<VisionConfig>): Promise<unknown>;
}

interface RegistryServices {
  DEFAULT_CONSTELLATION: string;
  constellationBase(): string;
  setConstellationBase(url: string): void;
}

type OpenModal = (
  title: string,
  body: Iterable<DomChild>,
  onSave: (() => unknown | Promise<unknown>) | null,
  options?: OpenModalOptions,
) => OpenModalResult;

type SegmentedControl = (
  values: readonly string[],
  current: string,
  onChange: (value: string) => void,
  label: (value: string) => string,
) => HTMLDivElement;

export interface SettingsActionServices {
  loadVision(): Promise<VisionServices>;
  loadRegistry(): Promise<RegistryServices>;
  openModal: OpenModal;
  toast(message: string, kind?: string, durationMs?: number): unknown;
  segmentedControl: SegmentedControl;
  getVisionConfig(): VisionConfig | null;
  setVisionConfig(config: Required<VisionConfig> | null): void;
  isAdvanced(): boolean;
  setAdvanced(enabled: boolean): void;
  themePreference(): string;
  applyTheme(preference: string): void;
  currentDensity(): string;
  setDensity(preference: string): void;
  isSetupActive(): boolean;
  openLibrary(): unknown;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** Build Settings and image-analysis connection actions around injected app state. */
export function createSettingsActions(services: SettingsActionServices) {
  async function openSettings(): Promise<void> {
    let vision: VisionServices;
    let registry: RegistryServices;
    try {
      [vision, registry] = await Promise.all([services.loadVision(), services.loadRegistry()]);
    } catch (error) {
      services.toast(`Settings tools couldn't load: ${messageOf(error)}`, "err");
      return;
    }

    const theme = services.segmentedControl(
      ["system", "light", "dark"],
      services.themePreference(),
      services.applyTheme,
      capitalize,
    );
    const density = services.segmentedControl(
      ["comfortable", "compact"],
      services.currentDensity(),
      services.setDensity,
      capitalize,
    );
    const advanced = el("input", { type: "checkbox" });
    advanced.checked = services.isAdvanced();
    advanced.addEventListener("change", () => {
      services.setAdvanced(advanced.checked);
      if (services.isSetupActive()) services.openLibrary();
    });

    let handle: OpenModalResult | undefined;
    const config = services.getVisionConfig();
    const providerLabel = config?.provider ? vision.PROVIDERS[config.provider]?.label || config.provider : null;
    const visionRow = el("div", { class: "row between" }, [
      el("span", { class: "muted small" }, config?.apiKey ? `Connected · ${providerLabel}` : "Not connected"),
      el(
        "button",
        {
          class: "ghost small-btn",
          type: "button",
          onclick: () => {
            handle?.close();
            void openVisionConnect();
          },
        },
        config?.apiKey ? "Manage" : "Connect",
      ),
    ]);

    const indexInput = el("input", {
      type: "url",
      class: "share-url mono",
      value: registry.constellationBase() === registry.DEFAULT_CONSTELLATION ? "" : registry.constellationBase(),
      placeholder: registry.DEFAULT_CONSTELLATION,
      spellcheck: "false",
      autocomplete: "off",
      "aria-label": "Discovery index base URL",
    });
    indexInput.addEventListener("change", () => {
      registry.setConstellationBase(indexInput.value.trim());
      services.toast("Discovery index updated", "ok");
    });

    handle = services.openModal(
      "Settings",
      [
        el("label", { class: "field" }, [el("span", {}, "Theme"), theme]),
        el("label", { class: "field" }, [el("span", {}, "Density"), density]),
        el("div", { class: "field" }, [el("span", {}, "Image analysis"), visionRow]),
        el("label", { class: "field" }, [
          el("span", {}, "Discovery index"),
          indexInput,
          el("span", { class: "muted small" }, "Constellation instance for Discover. Blank uses the public one."),
        ]),
        el("label", { class: "inline-check settings-check" }, [
          advanced,
          el("span", {}, "Advanced records (show raw record inspectors)"),
        ]),
      ],
      null,
      { hideSave: true, cancelLabel: "Close" },
    );
  }

  async function openVisionConnect(): Promise<void> {
    let vision: VisionServices;
    try {
      vision = await services.loadVision();
    } catch (error) {
      services.toast(`Image analysis tools couldn't load: ${messageOf(error)}`, "err");
      return;
    }

    const config = services.getVisionConfig() || {};
    let provider = vision.PROVIDERS[config.provider || ""] || vision.PROVIDERS[vision.DEFAULT_PROVIDER];
    if (!provider) throw new Error("No image-analysis provider is configured.");
    const providers = Object.values(vision.PROVIDERS);
    const providerSelect = el(
      "select",
      {},
      providers.map((item) => el("option", { value: item.id }, item.label)),
    );
    providerSelect.value = provider.id;
    const keyInput = el("input", {
      type: "password",
      placeholder: provider.keyPlaceholder,
      value: config.apiKey || "",
      autocomplete: "off",
      spellcheck: "false",
    });
    const modelSelect = el(
      "select",
      {},
      provider.models.map((model) => el("option", { value: model.id }, model.label)),
    );
    modelSelect.value = config.model || provider.defaultModel;
    const keyLabel = el("span", {}, provider.keyLabel);
    const hint = el("span", { class: "muted small" }, provider.keyHint || "");
    const keyLink = el(
      "a",
      { class: "linkbtn small", target: "_blank", rel: "noopener", href: provider.keyUrl || "#" },
      "Get an API key ↗",
    );
    keyLink.classList.toggle("hidden", !provider.keyUrl);
    const billingNote = el("p", { class: "muted small" }, provider.billingNote || "");

    providerSelect.addEventListener("change", () => {
      provider = vision.PROVIDERS[providerSelect.value] || provider;
      keyInput.placeholder = provider.keyPlaceholder;
      keyLabel.textContent = provider.keyLabel;
      hint.textContent = provider.keyHint || "";
      keyLink.href = provider.keyUrl || "#";
      keyLink.classList.toggle("hidden", !provider.keyUrl);
      billingNote.textContent = provider.billingNote || "";
      modelSelect.replaceChildren(...provider.models.map((model) => el("option", { value: model.id }, model.label)));
      modelSelect.value = provider.defaultModel;
    });

    const status = el("span", { class: "status" });
    const testButton = el("button", { type: "button", class: "ghost small-btn" }, "Test connection");
    testButton.addEventListener("click", async () => {
      testButton.disabled = true;
      const name = (vision.PROVIDERS[providerSelect.value] || provider).label;
      status.className = "status";
      status.textContent = `Checking ${name}…`;
      try {
        await vision.validateConfig({
          provider: providerSelect.value,
          apiKey: keyInput.value.trim(),
          model: modelSelect.value,
        });
        status.className = "status ok";
        status.textContent = "Connection OK ✓";
      } catch (error) {
        const message = messageOf(error);
        status.className = "status err";
        status.textContent = message;
        services.toast(message, "err", 4200);
      } finally {
        testButton.disabled = false;
      }
    });

    const body: DomChild[] = [
      el(
        "p",
        { class: "muted small" },
        "Auto-generate alt text and scene graphs for your photos. Only providers that allow direct browser calls can be used here.",
      ),
      providers.length > 1 ? field("Provider", providerSelect) : null,
      el("label", { class: "field" }, [keyLabel, keyInput]),
      el("div", { class: "row between", style: "gap:8px; margin-top:-4px" }, [hint, keyLink]),
      field("Model", modelSelect),
      billingNote,
      el("div", { class: "row subtle-actions" }, [testButton, status]),
    ];

    let handle: OpenModalResult | undefined;
    if (config.apiKey) {
      body.push(
        el("div", { class: "row subtle-actions" }, [
          el(
            "button",
            {
              type: "button",
              class: "ghost small-btn danger",
              onclick: () => {
                services.setVisionConfig(null);
                services.toast("Disconnected", "ok");
                handle?.close();
              },
            },
            "Disconnect",
          ),
        ]),
      );
    }

    handle = services.openModal(
      "Image analysis",
      body,
      async () => {
        const next = {
          provider: providerSelect.value,
          apiKey: keyInput.value.trim(),
          model: modelSelect.value,
        };
        if (!next.apiKey) throw new Error("Enter an API key.");
        await vision.validateConfig(next);
        services.setVisionConfig(next);
      },
      { saveLabel: "Save & connect" },
    );
  }

  return { openSettings, openVisionConnect };
}
