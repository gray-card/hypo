import * as defaultSync from "../outbox.js";
import { el, openModal, toast } from "./dom.js";

function displayValue(value) {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** Turn schema-runtime custody failures into the same user-facing conflict language as swap failures. */
export function complementConflictDetails(error) {
  if (!error || !["ComplementFingerprintMismatch", "ComplementConflict"].includes(error.name)) return null;
  const fingerprint = error.name === "ComplementFingerprintMismatch";
  return {
    title: fingerprint ? "Schema complement mismatch" : "Schema complement conflict",
    message: fingerprint
      ? "This edit was paired with a complement from a different record shape. Hypo stopped before writing so no fields were lost."
      : "Hypo cannot safely reconstruct fields hidden by this client version. Reopen the latest remote record before editing it again.",
    recordUri: error.context?.recordUri || "Unknown record",
    cid: error.context?.cid || "Unknown CID",
    chainId: error.context?.chainId || null,
  };
}

/** Surface a Panproto complement failure in the existing needs-attention tray. */
export function openComplementConflictTray(error) {
  const details = complementConflictDetails(error);
  if (!details) throw new TypeError("Expected a schema complement conflict");
  const card = el("section", { class: "conflict-card", "aria-labelledby": "schema-complement-conflict" }, [
    el("h3", { id: "schema-complement-conflict" }, details.title),
    el("p", {}, details.message),
    el("p", { class: "muted small" }, details.recordUri),
    el("p", { class: "muted small" }, `Remote CID: ${details.cid}`),
    details.chainId ? el("p", { class: "muted small" }, `Migration chain: ${details.chainId}`) : null,
  ]);
  return openModal(
    "Needs attention",
    [el("div", { class: "conflict-tray", "aria-live": "polite" }, card)],
    async () => true,
    {
      wide: true,
      hideSave: true,
      cancelLabel: "Close",
    },
  );
}

function remoteRecord(operation) {
  const remote = operation.conflict?.remote;
  if (!remote || typeof remote !== "object") return {};
  return remote.value && typeof remote.value === "object" ? remote.value : remote;
}

function remoteCid(operation) {
  const cid = operation.conflict?.remote?.cid;
  return typeof cid === "string" && cid ? cid : null;
}

export function conflictDiff(operation) {
  const local = operation.kind === "put" ? operation.record || {} : {};
  const remote = remoteRecord(operation);
  return [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort().map((field) => ({
    field,
    local: local[field],
    remote: remote[field],
    changed: JSON.stringify(local[field]) !== JSON.stringify(remote[field]),
  }));
}

function diffTable(operation) {
  const body = el("tbody");
  for (const row of conflictDiff(operation)) {
    body.append(
      el("tr", { class: row.changed ? "conflict-changed" : "" }, [
        el("th", { scope: "row" }, row.field),
        el("td", {}, el("pre", {}, displayValue(row.local))),
        el("td", {}, el("pre", {}, displayValue(row.remote))),
      ]),
    );
  }
  return el("div", { class: "conflict-diff-scroll" }, [
    el("table", { class: "conflict-diff" }, [
      el("thead", {}, el("tr", {}, [el("th", {}, "Field"), el("th", {}, "Local"), el("th", {}, "Remote")])),
      body,
    ]),
  ]);
}

function conflictCard(operation, { agent, did, sync, refresh }) {
  const cid = remoteCid(operation);
  const status = el("span", { class: "status", role: "status", "aria-live": "polite" });
  const rebase = el(
    "button",
    {
      type: "button",
      disabled: !cid,
      title: cid ? "Retry this local change against the current remote record" : "Reload to obtain the remote CID",
      onclick: async () => {
        rebase.disabled = true;
        discard.disabled = true;
        status.textContent = "Rebasing…";
        try {
          await sync.rebaseConflict(did, operation.id, { swapRecord: cid });
          const result = await sync.flush(agent, did);
          if (result.conflicts) toast("The record changed again; review the new remote version.", "info");
          else toast("Local change rebased and synced", "ok");
          await refresh();
        } catch (error) {
          status.textContent = error?.message || String(error);
          rebase.disabled = !cid;
          discard.disabled = false;
        }
      },
    },
    "Rebase local change",
  );
  const discard = el(
    "button",
    {
      type: "button",
      class: "ghost danger",
      onclick: async () => {
        rebase.disabled = true;
        discard.disabled = true;
        status.textContent = "Discarding…";
        await sync.remove(did, operation.id);
        toast("Local change discarded", "ok");
        await refresh();
      },
    },
    "Discard local change",
  );

  return el("section", { class: "conflict-card", "aria-labelledby": `conflict-${operation.id}` }, [
    el("div", { class: "row between" }, [
      el("h3", { id: `conflict-${operation.id}` }, operation.kind === "put" ? "Edit conflict" : "Delete conflict"),
      el("code", { class: "muted small" }, operation.collection),
    ]),
    el("p", { class: "muted small" }, operation.uri || operation.rkey),
    el("p", {}, operation.conflict?.message || "The remote record changed before this operation could sync."),
    diffTable(operation),
    !cid
      ? el(
          "p",
          { class: "field-hint" },
          "The current remote CID was unavailable. Close and reopen this tray online to retry.",
        )
      : null,
    el("div", { class: "row conflict-actions" }, [rebase, discard, status]),
  ]);
}

export async function openConflictTray({ agent, did, sync = defaultSync }) {
  const host = el("div", { class: "conflict-tray", "aria-live": "polite" });
  let modal;

  const refresh = async () => {
    const operations = await sync.conflicts(did);
    if (!operations.length) {
      host.replaceChildren(
        el("div", { class: "empty-state" }, [
          el("div", { class: "empty-title" }, "Nothing needs attention"),
          el("div", { class: "empty-hint muted small" }, "All queued changes are ready to sync or already synced."),
        ]),
      );
      return;
    }
    host.replaceChildren(
      el(
        "p",
        { class: "muted" },
        `${operations.length} local change${operations.length === 1 ? "" : "s"} need review.`,
      ),
      ...operations.map((operation) => conflictCard(operation, { agent, did, sync, refresh })),
    );
  };

  await refresh();
  modal = openModal("Needs attention", [host], async () => true, {
    wide: true,
    hideSave: true,
    cancelLabel: "Close",
  });
  return modal;
}
