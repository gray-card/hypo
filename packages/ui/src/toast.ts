import { $, el } from "./element.ts";

export interface ToastAction {
  label: string;
  fn: () => void;
}

export interface ToastDismiss {
  (): void;
  update(message: string): void;
}

// Transient bottom toast. The returned dismiss function can also update the
// message for long-running operations.
export function toast(
  message: string,
  kind = "ok",
  durationMs = 2800,
  action: ToastAction | null = null,
): ToastDismiss {
  let host = $("#toast-host") as HTMLElement | null;
  if (!host) {
    host = el("div", { id: "toast-host", class: "toast-host" });
    document.body.append(host);
  }
  const label = el("span", {}, message);
  const notice = el(
    "div",
    {
      class: `toast ${kind}`,
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    },
    [label],
  );
  const dismiss = (() => {
    notice.classList.remove("show");
    setTimeout(() => notice.remove(), 240);
  }) as ToastDismiss;
  dismiss.update = (nextMessage: string) => {
    label.textContent = nextMessage;
  };
  if (action) {
    notice.append(
      el(
        "button",
        {
          class: "toast-action",
          onclick: (event: Event) => {
            event.stopPropagation();
            clearTimeout(timer);
            action.fn();
            dismiss();
          },
        },
        action.label,
      ),
    );
    durationMs = Math.max(durationMs, 6000);
  }
  host.append(notice);
  requestAnimationFrame(() => notice.classList.add("show"));
  const timer = setTimeout(dismiss, durationMs);
  notice.addEventListener("click", () => {
    clearTimeout(timer);
    dismiss();
  });
  return dismiss;
}
