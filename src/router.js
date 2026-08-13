// Central route parsing and URL construction. View ownership remains in the
// feature modules; this module is the single contract for browser URL state.

const ROUTES = [
  { name: "home", parts: [] },
  { name: "galleries", parts: ["galleries"] },
  { name: "library", parts: ["library", ":tab"] },
  { name: "gallery", parts: ["gallery", ":rkey"] },
  { name: "roll", parts: ["roll", ":rkey"] },
  { name: "gear", parts: ["gear", ":kind", ":rkey"] },
  { name: "timer", parts: ["timer"] },
  { name: "meter", parts: ["meter"] },
  { name: "following", parts: ["following"] },
  { name: "discover", parts: ["discover"] },
  { name: "profileSection", parts: ["profile", ":handle", ":section"] },
  { name: "profile", parts: ["profile", ":handle"] },
];

function baseParts(base) {
  return String(base || "/")
    .split("/")
    .filter(Boolean);
}

function pathParts(pathname, base) {
  const parts = String(pathname || "/")
    .split("/")
    .filter(Boolean);
  const prefix = baseParts(base);
  if (!prefix.every((part, index) => parts[index] === part)) return null;
  return parts.slice(prefix.length).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
}

export function matchRoute(pathname, { base = "/" } = {}) {
  const actual = pathParts(pathname, base);
  if (!actual) return { name: "notFound", params: {}, pathname };
  for (const route of ROUTES) {
    if (route.parts.length !== actual.length) continue;
    const params = {};
    let matches = true;
    route.parts.forEach((part, index) => {
      if (part.startsWith(":")) params[part.slice(1)] = actual[index];
      else if (part !== actual[index]) matches = false;
    });
    if (matches) return { name: route.name, params, pathname };
  }
  return { name: "notFound", params: {}, pathname };
}

export function routePath(name, params = {}, { base = "/" } = {}) {
  const route = ROUTES.find((candidate) => candidate.name === name);
  if (!route) throw new TypeError(`Unknown route: ${name}`);
  const parts = route.parts.map((part) => {
    if (!part.startsWith(":")) return part;
    const key = part.slice(1);
    const value = params[key];
    if (value == null || value === "") throw new TypeError(`Missing route parameter: ${key}`);
    return encodeURIComponent(String(value));
  });
  const prefix = `/${baseParts(base).join("/")}`.replace(/\/$/, "");
  return `${prefix}/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

export function createRouter({ window: browser = globalThis.window, base = "/" } = {}) {
  if (!browser?.history || !browser?.location) throw new TypeError("A browser window is required");
  const listeners = new Set();
  const current = () => matchRoute(browser.location.pathname, { base });
  const notify = () => {
    const route = current();
    listeners.forEach((listener) => listener(route));
    return route;
  };
  const onPopState = () => notify();
  browser.addEventListener("popstate", onPopState);
  return {
    current,
    refresh: notify,
    navigate(name, params, state = {}) {
      browser.history.pushState(state, "", routePath(name, params, { base }));
      return notify();
    },
    replace(name, params, state = {}) {
      browser.history.replaceState(state, "", routePath(name, params, { base }));
      return notify();
    },
    subscribe(listener, { immediate = false } = {}) {
      listeners.add(listener);
      if (immediate) listener(current());
      return () => listeners.delete(listener);
    },
    destroy() {
      browser.removeEventListener("popstate", onPopState);
      listeners.clear();
    },
  };
}

export const routeNames = Object.freeze(ROUTES.map((route) => route.name));
