// uploadUI.js: create a new gallery straight from Hypo, uploading
// photos to the user's PDS and (optionally) linking the whole set to their gear.

import { el, field, toast } from "./dom.js";
import { icon } from "./icons.js";
import { uploadImage, createGallery, createPhoto, addGalleryItem, saveExif } from "../grain.js";
import { saveGalleryDefaults } from "../graycard.js";
import { fileToExifForm } from "../readExif.js";
import { instanceSelect, getStore, refreshStore } from "./library.js";

export async function aspectRatioOf(file) {
  try {
    const bm = await createImageBitmap(file);
    const ar = { width: bm.width, height: bm.height };
    bm.close?.();
    return ar;
  } catch { return null; }
}

// Downscale to a grain-friendly JPEG before upload. Mirrors grain's own
// image-resize.ts (app/lib/utils/image-resize.ts): fit within a 2000x2000 box,
// binary-search JPEG quality so the encoded image lands under ~900 KB, over a
// white matte with high-quality smoothing. Loads via <img> (a data URL) rather
// than createImageBitmap so EXIF orientation is auto-applied — otherwise portrait
// photos upload sideways. Sending a raw multi-megapixel original instead is what
// left grain unable to render the photo (blank). Returns { blob, width, height }
// or null when the browser can't decode the file (caller falls back to original).
const UPLOAD_MAX_EDGE = 2000;
const UPLOAD_MAX_BYTES = 900_000;

const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error("decode failed")); img.src = src; });
const base64Bytes = (dataUrl) => { const b64 = dataUrl.split(",")[1] || dataUrl; return Math.ceil((b64.length * 3) / 4); };

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (/:(.*?);/.exec(head) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function renderJpeg(img, quality) {
  const scale = Math.min(UPLOAD_MAX_EDGE / img.width, UPLOAD_MAX_EDGE / img.height, 1);
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);   // JPEG has no alpha; matte transparency to white
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width, height };
}

export async function prepareUpload(file) {
  try {
    const img = await loadImage(await readAsDataURL(file));
    let best = null, lo = 0, hi = 100;
    while (hi - lo > 1) {
      const q = Math.round((lo + hi) / 2);
      const r = renderJpeg(img, q / 100);
      if (base64Bytes(r.dataUrl) <= UPLOAD_MAX_BYTES) { best = r; lo = q; } else { hi = q; }
    }
    if (!best) best = renderJpeg(img, 0.5);   // even low quality exceeded the cap (huge image): send our best effort
    return { blob: dataUrlToBlob(best.dataUrl), width: best.width, height: best.height };
  } catch { /* undecodable — fall back to the original bytes */ }
  return null;
}

// Read EXIF from the ORIGINAL file (canvas downscaling strips it) and persist it,
// but only when there is something worth recording.
async function copyExif(agent, did, photoUri, file) {
  try {
    const form = await fileToExifForm(file);
    if (form && Object.values(form).some((v) => v != null && v !== "")) {
      await saveExif(agent, did, photoUri, null, form);
    }
  } catch { /* EXIF is best-effort; never block the upload */ }
}

export async function openUploadModal(agent, did, onDone) {
  if (!getStore()) { try { await refreshStore(); } catch { /* gear optional */ } }

  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "New gallery" });
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }

  const titleIn = el("input", { type: "text", placeholder: "Gallery title" });
  const descIn = el("textarea", { rows: "2", placeholder: "Description (optional)" });
  const fileIn = el("input", { type: "file", accept: "image/*", multiple: "" });
  const fileInfo = el("div", { class: "muted small" });
  fileIn.addEventListener("change", () => {
    const n = fileIn.files?.length || 0;
    fileInfo.textContent = n ? `${n} photo${n > 1 ? "s" : ""} selected` : "";
  });

  const camSel = instanceSelect("camera", "");
  const lensSel = instanceSelect("lens", "");
  const rollSel = instanceSelect("filmRoll", "");

  const status = el("div", { class: "muted small upload-status" });
  const fill = el("div", { class: "bar-fill", style: "width:0%" });
  const barWrap = el("div", { class: "bar-track hidden", style: "margin:10px 0 2px" }, [fill]);

  const saveBtn = el("button", {}, "Create gallery");
  saveBtn.addEventListener("click", async () => {
    const files = [...(fileIn.files || [])];
    if (!files.length) { toast("Pick at least one photo", "err"); return; }
    saveBtn.disabled = true;
    barWrap.classList.remove("hidden");
    try {
      const gallery = await createGallery(agent, did, { title: titleIn.value, description: descIn.value });
      let i = 0;
      for (const f of files) {
        const prepared = await prepareUpload(f);                 // downscale to a grain-renderable JPEG
        const toUpload = prepared?.blob || f;                    // fall back to the original if undecodable
        const ar = prepared ? { width: prepared.width, height: prepared.height } : await aspectRatioOf(f);
        const blob = await uploadImage(agent, toUpload);
        const photo = await createPhoto(agent, did, { blob, aspectRatio: ar });
        await addGalleryItem(agent, did, { gallery, item: photo, position: i });
        await copyExif(agent, did, photo, f);                    // EXIF from the original file
        i++;
        status.textContent = `Uploaded ${i} of ${files.length}…`;
        fill.style.width = `${Math.round((i / files.length) * 100)}%`;
      }
      const defaults = {};
      if (camSel.value) defaults.camera = camSel.value;
      if (lensSel.value) defaults.lens = lensSel.value;
      if (rollSel.value) defaults.filmRoll = rollSel.value;
      if (Object.keys(defaults).length) await saveGalleryDefaults(agent, did, gallery, defaults);
      toast(`Created “${titleIn.value.trim() || "Untitled gallery"}”`, "ok");
      close();
      onDone?.(gallery);
    } catch (err) {
      status.textContent = `Error: ${err?.message || err}`;
      saveBtn.disabled = false;
    }
  });

  modal.append(
    el("h2", {}, "New gallery"),
    el("p", { class: "muted small" }, "Photos upload to your own atproto repo (PDS). Linking gear here tags every photo at once."),
    field("Title", titleIn),
    field("Description", descIn),
    field("Photos", el("div", {}, [fileIn, fileInfo])),
    el("h3", { class: "modal-sub" }, "Link gear (optional)"),
    field("Camera", camSel),
    field("Lens", lensSel),
    field("Film", rollSel),
    barWrap,
    el("div", { class: "row modal-actions" }, [saveBtn, el("button", { class: "ghost", onclick: close }, "Cancel"), status]),
  );

  overlay.append(modal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  titleIn.focus();
}
