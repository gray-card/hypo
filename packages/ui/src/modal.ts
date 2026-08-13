import { el, type DomChild } from "./element.ts";
import { withButton } from "./feedback.ts";
import { toast } from "./toast.ts";

const FOCUSABLE_SELECTOR = 'a[href],button,input,select,textarea,[contenteditable="true"],[tabindex]';

export function focusableElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((node) => {
    if ((node as HTMLButtonElement).disabled || node.tabIndex < 0 || node.matches('input[type="hidden"]')) return false;
    if (node.closest('[hidden],[aria-hidden="true"],.hidden')) return false;
    const style = window.getComputedStyle?.(node);
    return style?.display !== "none" && style?.visibility !== "hidden";
  });
}

export interface ModalFocusTrap {
  activate(): void;
  deactivate(): void;
}

// Handles Escape and wraps Tab focus for the topmost modal only.
export function createModalFocusTrap(overlay: HTMLElement, modal: HTMLElement, close: () => void): ModalFocusTrap {
  let lastFocusedInside: HTMLElement | null = null;
  const isTopmost = () => {
    const overlays = document.querySelectorAll(".modal-overlay");
    return overlays[overlays.length - 1] === overlay;
  };
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && modal.contains(event.target)) lastFocusedInside = event.target;
  };
  // Password managers and other browser-owned popovers temporarily move focus
  // out of the document. Restore the modal's last focus target when the page
  // regains focus so keyboard and wheel scrolling keep targeting its scrollport.
  const onWindowFocus = () => {
    queueMicrotask(() => {
      if (!isTopmost() || modal.contains(document.activeElement)) return;
      const target = lastFocusedInside?.isConnected ? lastFocusedInside : modal;
      target.focus({ preventScroll: true });
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (!isTopmost()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusableElements(modal);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return {
    activate() {
      document.addEventListener("keydown", onKey);
      modal.addEventListener("focusin", onFocusIn);
      window.addEventListener("focus", onWindowFocus);
    },
    deactivate() {
      document.removeEventListener("keydown", onKey);
      modal.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focus", onWindowFocus);
    },
  };
}

export interface OpenModalOptions {
  wide?: boolean;
  hideSave?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  leadingActions?: Iterable<DomChild>;
  onClose?: () => void;
  restoreFocus?: HTMLElement | (() => HTMLElement | null | void);
}

export interface OpenModalResult {
  close(): void;
  modal: HTMLDivElement;
}

export function openModal(
  title: string,
  bodyNodes: Iterable<DomChild>,
  onSave: (() => unknown | Promise<unknown>) | null,
  options: OpenModalOptions = {},
): OpenModalResult {
  const previousFocus = document.activeElement as HTMLElement | null;
  let closed = false;
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", {
    class: "card modal" + (options.wide ? " scene-modal" : ""),
    role: "dialog",
    tabindex: "-1",
    "aria-modal": "true",
    "aria-label": title,
  });
  const status = el("span", { class: "status" });
  let focusTrap: ModalFocusTrap;

  const close = () => {
    if (closed) return;
    closed = true;
    focusTrap.deactivate();
    overlay.remove();
    const restoreTarget =
      typeof options.restoreFocus === "function" ? options.restoreFocus() : options.restoreFocus || previousFocus;
    restoreTarget?.focus?.();
    options.onClose?.();
  };
  focusTrap = createModalFocusTrap(overlay, modal, close);

  modal.append(el("h2", {}, title));
  for (const node of bodyNodes) {
    if (node != null) modal.append(node instanceof Node ? node : document.createTextNode(String(node)));
  }
  const saveButton = options.hideSave
    ? null
    : el(
        "button",
        {
          onclick: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            const succeeded = await withButton(button, status, onSave as () => unknown | Promise<unknown>);
            if (succeeded) {
              toast("Saved", "ok");
              close();
            }
          },
        },
        options.saveLabel || "Save",
      );
  modal.append(
    el("div", { class: "row modal-actions" }, [
      ...(options.leadingActions || []),
      saveButton,
      el("button", { class: "ghost", onclick: close }, options.cancelLabel || "Cancel"),
      status,
    ]),
  );

  overlay.append(modal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  focusTrap.activate();
  document.body.append(overlay);

  (modal.querySelector<HTMLElement>("input,textarea,select,button") || saveButton)?.focus();
  return { close, modal };
}

export interface ConfirmCheck {
  key: string;
  label: string;
  checked?: boolean;
}

export interface ConfirmModalOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  checks?: readonly ConfirmCheck[];
}

export interface ConfirmModalResult {
  confirmed: boolean;
  checks: Record<string, boolean>;
}

export function confirmModal(message: string, options?: ConfirmModalOptions): Promise<boolean | ConfirmModalResult> {
  const { confirmLabel = "Delete", cancelLabel = "Cancel", danger = true, checks } = options || {};
  return new Promise((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;
    let closed = false;
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", {
      class: "card modal",
      role: "alertdialog",
      tabindex: "-1",
      "aria-modal": "true",
      "aria-label": message,
    });
    const checkInputs: Record<string, HTMLInputElement> = {};
    let focusTrap: ModalFocusTrap;

    const readChecks = () => {
      const values: Record<string, boolean> = {};
      for (const check of checks || []) values[check.key] = Boolean(checkInputs[check.key]?.checked);
      return values;
    };
    const done = (confirmed: boolean) => {
      if (closed) return;
      closed = true;
      focusTrap.deactivate();
      overlay.remove();
      previousFocus?.focus?.();
      if (checks?.length) resolve({ confirmed, checks: readChecks() });
      else resolve(confirmed);
    };
    focusTrap = createModalFocusTrap(overlay, modal, () => done(false));

    modal.append(el("p", {}, message));
    if (checks?.length) {
      const list = el("div", { class: "confirm-checks" });
      for (const check of checks) {
        const input = el("input", { type: "checkbox", checked: Boolean(check.checked) });
        checkInputs[check.key] = input;
        list.append(el("label", { class: "confirm-check" }, [input, el("span", {}, check.label)]));
      }
      modal.append(list);
    }
    modal.append(
      el("div", { class: "row modal-actions" }, [
        el("button", { class: danger ? "danger-solid" : "", onclick: () => done(true) }, confirmLabel),
        el("button", { class: "ghost", onclick: () => done(false) }, cancelLabel),
      ]),
    );
    overlay.append(modal);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) done(false);
    });
    focusTrap.activate();
    document.body.append(overlay);
    modal.querySelector<HTMLButtonElement>("button")?.focus();
  });
}
