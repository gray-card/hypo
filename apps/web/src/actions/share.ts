import { el, field, type DomChild, type OpenModalOptions, type OpenModalResult } from "@hypo/ui";

type OpenModal = (
  title: string,
  body: Iterable<DomChild>,
  onSave: (() => unknown | Promise<unknown>) | null,
  options?: OpenModalOptions,
) => OpenModalResult;

interface ShareData {
  title: string;
  url: string;
}

export interface ShareActionServices {
  openModal: OpenModal;
  icon(name: string, size?: number): Node;
  toast(message: string, kind?: string): unknown;
  profileIdentifier(): string | null | undefined;
  writeClipboard(text: string): Promise<void>;
  fallbackCopy(): void;
  canShare(): boolean;
  share(data: ShareData): Promise<unknown>;
}

/** Build setup sharing around injected identity and browser capabilities. */
export function createShareActions(services: ShareActionServices) {
  const shareSetup = (): void => {
    const url = `https://hypo.graycard.app/profile/${services.profileIdentifier()}`;
    const urlInput = el("input", {
      type: "text",
      readonly: "",
      value: url,
      class: "share-url mono",
      "aria-label": "Setup link",
    });
    urlInput.addEventListener("focus", () => urlInput.select());

    const copyButton = el("button", {}, [services.icon("copy"), el("span", {}, "Copy link")]);
    copyButton.addEventListener("click", async () => {
      try {
        await services.writeClipboard(url);
      } catch {
        urlInput.focus();
        urlInput.select();
        try {
          services.fallbackCopy();
        } catch {
          // Clipboard fallback may be blocked by browser policy.
        }
      }
      services.toast("Link copied", "ok");
    });

    const actions: HTMLButtonElement[] = [copyButton];
    if (services.canShare()) {
      const shareButton = el("button", { class: "ghost" }, [services.icon("share"), el("span", {}, "Share…")]);
      shareButton.addEventListener("click", () => {
        void services.share({ title: "My graycard setup", url }).catch(() => {});
      });
      actions.push(shareButton);
    }

    services.openModal(
      "Share your setup",
      [
        el("p", { class: "muted small" }, "Anyone with this link can view your public gear setup. No sign-in needed."),
        field("Link", urlInput),
      ],
      null,
      { hideSave: true, cancelLabel: "Close", leadingActions: actions },
    );
    urlInput.focus();
    urlInput.select();
  };

  return { shareSetup };
}
