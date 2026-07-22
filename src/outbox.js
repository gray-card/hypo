// outbox.js: an offline-first write queue backed by localStorage.
//
// The shot logger must keep working with no connectivity: every record it wants
// to create is enqueued here first (so it survives a refresh or a dead network),
// the UI reads pending entries optimistically, and a flush() drains the queue to
// the PDS whenever we are back online. Each op is a plain createRecord payload.

const KEY = (did) => `hypo:outbox:${did || "anon"}`;

function newId() {
  try { return crypto.randomUUID(); }
  catch { return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export function loadOutbox(did) {
  try { return JSON.parse(localStorage.getItem(KEY(did)) || "[]"); }
  catch { return []; }
}

function save(did, ops) {
  try { localStorage.setItem(KEY(did), JSON.stringify(ops)); }
  catch { /* storage full / unavailable: best effort */ }
}

// queue a record to be created. Returns the op (with a temp id + optimistic uri).
export function enqueue(did, collection, record) {
  const ops = loadOutbox(did);
  const id = newId();
  const op = {
    id,
    collection,
    record: { ...record, $type: collection },
    // an optimistic at-uri so the UI can key/sort pending items before they sync
    tempUri: `outbox://${collection}/${id}`,
    queuedAt: new Date().toISOString(),
  };
  ops.push(op);
  save(did, ops);
  return op;
}

// pending ops, optionally filtered to one collection.
export function pending(did, collection) {
  const ops = loadOutbox(did);
  return collection ? ops.filter((o) => o.collection === collection) : ops;
}

export function pendingCount(did) {
  return loadOutbox(did).length;
}

export function remove(did, id) {
  save(did, loadOutbox(did).filter((o) => o.id !== id));
}

export function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// drain the queue to the PDS. Creates records oldest-first; on the first network
// failure it stops and leaves the rest queued for next time. Returns {sent, left}.
export async function flush(agent, did) {
  if (!isOnline()) return { sent: 0, left: pendingCount(did), offline: true };
  let sent = 0;
  for (const op of loadOutbox(did)) {
    try {
      await agent.com.atproto.repo.createRecord({ repo: did, collection: op.collection, record: op.record, validate: false });
      remove(did, op.id);
      sent += 1;
    } catch (err) {
      // network/PDS error: keep this and the rest for a later flush.
      return { sent, left: pendingCount(did), error: String(err) };
    }
  }
  return { sent, left: 0 };
}

// register auto-flush: whenever the browser regains connectivity, drain + notify.
export function installAutoFlush(agent, did, onFlushed) {
  if (typeof window === "undefined") return () => {};
  const run = async () => {
    if (!isOnline() || !pendingCount(did)) return;
    const res = await flush(agent, did);
    if (res.sent) onFlushed?.(res);
  };
  window.addEventListener("online", run);
  const timer = setInterval(run, 30000);
  run();
  return () => { window.removeEventListener("online", run); clearInterval(timer); };
}
