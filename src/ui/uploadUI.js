// uploadUI.js: create a new gallery straight from Hypo, uploading
// photos to the user's PDS and (optionally) linking the whole set to their gear.

import { el, field, toast } from "./dom.js";
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
  } catch {
    return null;
  }
}

// Downscale to a grain-friendly JPEG before upload. Mirrors grain's own
// image-resize.ts (app/lib/utils/image-resize.ts): fit within a 2000x2000 box,
// binary-search JPEG quality toward 900 KB, over a white matte with high-quality
// smoothing. Loads via <img> (a data URL) rather than createImageBitmap so EXIF
// orientation is auto-applied — otherwise portrait photos upload sideways.
// If quality reduction is insufficient, progressively reduce the pixel dimensions.
export const GRAIN_IMAGE_MAX_EDGE = 2000;
export const GRAIN_IMAGE_TARGET_BYTES = 900_000;
export const GRAIN_IMAGE_HARD_LIMIT_BYTES = 1_000_000;

const MIN_JPEG_QUALITY = 0.45;
const MAX_JPEG_QUALITY = 0.98;
const MAX_RESIZE_PASSES = 20;

const readAsDataURL = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
const loadImage = (src) =>
  new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("decode failed"));
    img.src = src;
  });
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (/:(.*?);/.exec(head) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function renderJpeg(img, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height); // JPEG has no alpha; matte transparency to white
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const blob = dataUrlToBlob(canvas.toDataURL("image/jpeg", quality));
  return { blob, width, height };
}

function bestEncodingAtSize(img, width, height) {
  const smallest = renderJpeg(img, width, height, MIN_JPEG_QUALITY);
  if (smallest.blob.size > GRAIN_IMAGE_TARGET_BYTES) return { best: null, smallest };

  let best = smallest;
  let lo = Math.round(MIN_JPEG_QUALITY * 100);
  let hi = Math.round(MAX_JPEG_QUALITY * 100) + 1;
  while (hi - lo > 1) {
    const q = Math.floor((lo + hi) / 2);
    const candidate = renderJpeg(img, width, height, q / 100);
    if (candidate.blob.size <= GRAIN_IMAGE_TARGET_BYTES) {
      best = candidate;
      lo = q;
    } else {
      hi = q;
    }
  }
  return { best, smallest };
}

function initialDimensions(img) {
  if (!(img.width > 0) || !(img.height > 0)) throw new Error("image has no dimensions");
  const scale = Math.min(GRAIN_IMAGE_MAX_EDGE / img.width, GRAIN_IMAGE_MAX_EDGE / img.height, 1);
  return {
    width: Math.max(1, Math.round(img.width * scale)),
    height: Math.max(1, Math.round(img.height * scale)),
  };
}

function preparationError(reason) {
  return new Error(
    `Hypo couldn't prepare this image for Grain (${reason}). Try exporting it as a smaller JPEG, PNG, or WebP file.`,
  );
}

export async function prepareUpload(file) {
  let img;
  try {
    img = await loadImage(await readAsDataURL(file));
  } catch {
    throw preparationError("the browser couldn't decode it");
  }

  try {
    let { width, height } = initialDimensions(img);
    let smallest = null;
    for (let pass = 0; pass < MAX_RESIZE_PASSES; pass++) {
      const encoded = bestEncodingAtSize(img, width, height);
      smallest = encoded.smallest;
      if (encoded.best) {
        if (encoded.best.blob.size > GRAIN_IMAGE_HARD_LIMIT_BYTES) {
          throw preparationError("the processed file is still over Grain's 1 MB limit");
        }
        return encoded.best;
      }

      if (width === 1 && height === 1) break;
      const proportionalScale = Math.sqrt(GRAIN_IMAGE_TARGET_BYTES / smallest.blob.size) * 0.95;
      const scale = Math.min(0.85, Math.max(0.1, proportionalScale));
      const nextWidth = Math.max(1, Math.floor(width * scale));
      const nextHeight = Math.max(1, Math.floor(height * scale));
      width = nextWidth === width && width > 1 ? width - 1 : nextWidth;
      height = nextHeight === height && height > 1 ? height - 1 : nextHeight;
    }

    if (smallest && smallest.blob.size <= GRAIN_IMAGE_HARD_LIMIT_BYTES) return smallest;
    throw preparationError("the processed file is still over Grain's 1 MB limit");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Hypo couldn't prepare")) throw error;
    throw preparationError("browser image processing failed");
  }
}

// The sole photo-upload boundary used by both gallery creation and replacement.
// It never uploads the raw original; callers retain that original only for EXIF.
export async function prepareAndUploadPhoto(agent, file) {
  const prepared = await prepareUpload(file);
  if (prepared.blob.size > GRAIN_IMAGE_HARD_LIMIT_BYTES) {
    throw preparationError("the processed file is still over Grain's 1 MB limit");
  }
  const blob = await uploadImage(agent, prepared.blob);
  if (Number(blob?.size) > GRAIN_IMAGE_HARD_LIMIT_BYTES) {
    throw preparationError("the PDS reported an uploaded blob over Grain's 1 MB limit");
  }
  return { blob, aspectRatio: { width: prepared.width, height: prepared.height } };
}

// Read EXIF from the ORIGINAL file (canvas downscaling strips it) and persist it,
// but only when there is something worth recording.
async function copyExif(agent, did, photoUri, file) {
  try {
    const form = await fileToExifForm(file);
    if (form && Object.values(form).some((v) => v != null && v !== "")) {
      await saveExif(agent, did, photoUri, null, form);
    }
  } catch {
    /* EXIF is best-effort; never block the upload */
  }
}

export async function openUploadModal(agent, did, onDone) {
  if (!getStore()) {
    try {
      await refreshStore();
    } catch {
      /* gear optional */
    }
  }

  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": "New gallery" });
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const titleIn = el("input", { type: "text", placeholder: "Gallery title" });
  const descIn = el("textarea", { rows: "2", placeholder: "Description (optional)" });
  const fileIn = el("input", {
    type: "file",
    accept: "image/*",
    multiple: "",
    "aria-label": "Photos to upload",
    "aria-describedby": "upload-file-selection",
  });
  const fileInfo = el(
    "div",
    { id: "upload-file-selection", class: "muted small", role: "status", "aria-live": "polite" },
    "No photos selected.",
  );
  fileIn.addEventListener("change", () => {
    const n = fileIn.files?.length || 0;
    fileInfo.textContent = n ? `${n} photo${n > 1 ? "s" : ""} selected` : "No photos selected.";
  });

  const camSel = instanceSelect("camera", "");
  const lensSel = instanceSelect("lens", "");
  const rollSel = instanceSelect("filmRoll", "");

  const status = el("div", { class: "muted small upload-status", role: "status", "aria-live": "polite" });
  const fill = el("div", { class: "bar-fill", style: "width:0%" });
  const barWrap = el(
    "div",
    {
      class: "bar-track hidden",
      style: "margin:10px 0 2px",
      role: "progressbar",
      "aria-label": "Photo upload progress",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
    },
    [fill],
  );

  const saveBtn = el("button", {}, "Create gallery");
  saveBtn.addEventListener("click", async () => {
    const files = [...(fileIn.files || [])];
    if (!files.length) {
      toast("Pick at least one photo", "err");
      return;
    }
    saveBtn.disabled = true;
    barWrap.classList.remove("hidden");
    try {
      const gallery = await createGallery(agent, did, { title: titleIn.value, description: descIn.value });
      let i = 0;
      for (const f of files) {
        const { blob, aspectRatio } = await prepareAndUploadPhoto(agent, f);
        const photo = await createPhoto(agent, did, { blob, aspectRatio });
        await addGalleryItem(agent, did, { gallery, item: photo, position: i });
        await copyExif(agent, did, photo, f); // EXIF from the original file
        i++;
        status.textContent = `Uploaded ${i} of ${files.length}…`;
        const progress = Math.round((i / files.length) * 100);
        fill.style.width = `${progress}%`;
        barWrap.setAttribute("aria-valuenow", String(progress));
        barWrap.setAttribute("aria-valuetext", `Uploaded ${i} of ${files.length} photos`);
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
    el(
      "p",
      { class: "muted small" },
      "Photos upload to your own atproto repo (PDS). Linking gear here tags every photo at once.",
    ),
    field("Title", titleIn),
    field("Description", descIn),
    field("Photos", el("div", {}, [fileIn, fileInfo])),
    el("h3", { class: "modal-sub" }, "Link gear (optional)"),
    field("Camera", camSel),
    field("Lens", lensSel),
    field("Film", rollSel),
    barWrap,
    el("div", { class: "row modal-actions" }, [
      saveBtn,
      el("button", { class: "ghost", onclick: close }, "Cancel"),
      status,
    ]),
  );

  overlay.append(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  titleIn.focus();
}
