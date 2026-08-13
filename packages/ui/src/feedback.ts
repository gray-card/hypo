import { el } from "./element.ts";
import { toast } from "./toast.ts";

export interface LoadPhase {
  node: HTMLParagraphElement;
  set(message: string): void;
  clear(): void;
}

// Status line that appears after `delayMs` if it is still mounted.
export function loadPhase(message: string, delayMs = 1600): LoadPhase {
  const node = el("p", { class: "muted small load-phase", role: "status" });
  let currentMessage = message;
  let shown = false;
  const timer = setTimeout(() => {
    shown = true;
    if (node.isConnected) node.textContent = currentMessage;
  }, delayMs);
  return {
    node,
    set(nextMessage) {
      currentMessage = nextMessage;
      if (shown && node.isConnected) node.textContent = currentMessage;
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

export function busyWait(label: string): HTMLDivElement {
  return el("div", { class: "busy-wait", role: "status", "aria-busy": "true", "aria-label": label }, [
    el("p", { class: "muted small", style: "margin:0 0 8px" }, label),
    el("div", { class: "bar-track busy-bar", "aria-hidden": "true" }, [el("div", { class: "bar-fill busy-bar-fill" })]),
  ]);
}

export interface ButtonTaskLabels {
  working?: string;
  done?: string;
}

export async function withButton(
  button: HTMLButtonElement,
  status: HTMLElement | null,
  task: () => unknown | Promise<unknown>,
  labels: ButtonTaskLabels = {},
): Promise<boolean> {
  button.disabled = true;
  if (status) {
    status.className = "status";
    status.textContent = labels.working || "Saving…";
  }
  try {
    await task();
    if (status) {
      status.classList.add("ok");
      status.textContent = labels.done || "Saved ✓";
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (status) {
      status.classList.add("err");
      status.textContent = `Error: ${message}`;
    }
    toast(message, "err", 4200);
    return false;
  } finally {
    button.disabled = false;
  }
}
