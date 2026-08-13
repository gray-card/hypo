// Compatibility facade for application imports. Reusable design-system DOM
// primitives live in @hypo/ui; application-local preferences and navigation
// remain here.

import { $, el } from "@hypo/ui";
import { fuzzyFilter } from "./fuzzy.js";

export * from "@hypo/ui";

// "advanced" mode surfaces power tools (raw-record inspector, collection ids).
// Off by default so everyday UI stays human-friendly.
export function isAdvanced() {
  try {
    return localStorage.getItem("hypo:advanced") === "1";
  } catch {
    return false;
  }
}

export function setAdvanced(on) {
  try {
    localStorage.setItem("hypo:advanced", on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Image-analysis provider connection, stored device-local (never uploaded).
// Shape: { provider: string, apiKey: string, model: string }.
export function getVisionConfig() {
  try {
    return JSON.parse(localStorage.getItem("hypo:vision") || "null");
  } catch {
    return null;
  }
}

export function setVisionConfig(config) {
  try {
    if (config) localStorage.setItem("hypo:vision", JSON.stringify(config));
    else localStorage.removeItem("hypo:vision");
  } catch {
    /* ignore */
  }
}

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Run a DOM mutation inside a View Transition when supported.
export function withTransition(mutate) {
  if (document.startViewTransition && !prefersReducedMotion()) {
    try {
      const transition = document.startViewTransition(mutate);
      transition?.finished?.catch(() => {});
      transition?.updateCallbackDone?.catch(() => {});
    } catch {
      mutate();
    }
  } else {
    mutate();
  }
}

export function showView(id) {
  withTransition(() => {
    for (const view of ["login-view", "list-view", "library-view", "editor-view", "profile-view", "following-view"]) {
      $("#" + view)?.classList.toggle("hidden", view !== id);
    }
    window.scrollTo({ top: 0 });
  });
}

export function stagger(nodes) {
  nodes.forEach((node, index) => {
    node.classList.add("reveal");
    node.style.setProperty("--i", String(index));
  });
}

// Theme-consistent autocomplete remains application-local because its ranking
// contract is shared with the app's other fuzzy-search surfaces.
export function autocomplete(wrap, input, options, onPick) {
  wrap.classList.add("ac-field");
  const menu = el("ul", { class: "ac-menu hidden", role: "listbox" });
  wrap.append(menu);
  let items = [],
    index = -1,
    picking = false;
  const list = () => (typeof options === "function" ? options() : options) || [];
  const hide = () => {
    menu.classList.add("hidden");
    menu.replaceChildren();
    index = -1;
    items = [];
  };
  const pick = (value) => {
    picking = true;
    input.value = value;
    hide();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    onPick?.(value);
    picking = false;
    input.focus();
  };
  const render = () => {
    menu.replaceChildren(
      ...items.map((item, itemIndex) =>
        el(
          "li",
          {
            class: "ac-opt" + (itemIndex === index ? " active" : ""),
            role: "option",
            onmousedown: (event) => event.preventDefault(),
            onclick: () => pick(item),
          },
          item,
        ),
      ),
    );
    menu.classList.toggle("hidden", !items.length);
  };
  const refresh = () => {
    if (picking) return;
    const query = input.value.trim();
    if (!query) {
      hide();
      return;
    }
    // Exact matches stay visible and rank first. The picking guard prevents an
    // input event emitted by a selection from immediately reopening the menu.
    items = fuzzyFilter(query, list(), (item) => item, 12);
    index = -1;
    render();
  };
  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", refresh);
  input.addEventListener("blur", () => setTimeout(hide, 120));
  input.addEventListener("keydown", (event) => {
    if (menu.classList.contains("hidden") || !items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index = (index + 1) % items.length;
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = (index - 1 + items.length) % items.length;
      render();
    } else if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      pick(items[index]);
    } else if (event.key === "Escape") {
      hide();
    }
  });
  return input;
}
