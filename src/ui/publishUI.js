// publishUI.js: the modal for a user's cross-network Discover listing — the
// small app.graycard.setup record that lists them in Discover. Lives here rather
// than in main.js because two surfaces open it: the command palette, and the
// "Publish to Discover" / "Edit profile" button on your own public profile.

import { el, field, toast, openModal } from "./dom.js";
import { getMySetup, publishSetup, unpublishSetup } from "../publish.js";

// Open the listing editor. `existing` may be passed by a caller that already
// loaded it (the profile button does, to label itself); otherwise it is fetched.
// `onChange(setupOrNull)` fires after a successful publish, update, or removal.
export async function openPublishSetup(agent, did, { handle = null, existing = undefined, onChange } = {}) {
  let current = existing;
  if (current === undefined) {
    try { current = await getMySetup(agent, did); }
    catch { current = null; }   // offline: treat as not yet published
  }

  const nameInput = el("input", {
    type: "text", maxlength: "100",
    value: current?.value?.name || (handle ? `@${handle}'s setup` : "My setup"),
    placeholder: "My setup",
  });
  const summaryInput = el("textarea", { rows: "3", maxlength: "1000", placeholder: "What's in this setup? (optional)" }, current?.value?.summary || "");

  const body = [
    el("p", { class: "muted small" }, current
      ? "Your setup is listed in cross-network Discover. Anyone can find it and view your public gear."
      : "List your public gear setup in cross-network Discover so other photographers can find it. It links only to your public profile; no private data is shared."),
    field("Name", nameInput),
    el("label", { class: "field" }, [el("span", {}, "Summary"), summaryInput]),
  ];

  let modal;
  if (current) {
    const unpub = el("button", { type: "button", class: "ghost small-btn danger" }, "Remove from Discover");
    unpub.addEventListener("click", async () => {
      if (!confirm("Remove your setup from Discover? Your gear and profile stay untouched.")) return;
      try {
        await unpublishSetup(agent, did, current.rkey);
        toast("Removed from Discover", "ok");
        onChange?.(null);
        modal?.close();
      } catch (err) { toast(err.message || String(err), "err", 4200); }
    });
    body.push(el("div", { class: "row subtle-actions" }, [unpub]));
  }

  modal = openModal(current ? "Edit profile" : "Publish to Discover", body, async () => {
    const saved = await publishSetup(agent, did, { name: nameInput.value, summary: summaryInput.value }, current);
    onChange?.(saved);
  }, { saveLabel: current ? "Save changes" : "Publish to Discover" });

  return modal;
}
