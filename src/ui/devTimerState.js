// Durable timer state is deliberately separate from the timer UI so the app
// shell can offer "Resume" without loading the recipe catalog and timer code.

const MIRROR = (did) => `hypo:devtimer:${did || "anon"}`;

export function activeDevRun(did) {
  try {
    return JSON.parse(localStorage.getItem(MIRROR(did)) || "null");
  } catch {
    return null;
  }
}

export function saveDevRun(did, state) {
  try {
    localStorage.setItem(MIRROR(did), JSON.stringify(state));
  } catch {
    /* storage is best-effort; the wall-clock timer keeps running */
  }
}

export function clearDevRun(did) {
  try {
    localStorage.removeItem(MIRROR(did));
  } catch {
    /* ignore unavailable storage */
  }
}
