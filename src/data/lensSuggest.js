// lensSuggest.js: build a prefilled GitHub issue for adding a lens to the
// curated database (data/curated-lenses.jsonl). Opening the issue is user
// initiated and non-destructive; the user reviews and submits it on GitHub.

export const LENS_ISSUE_REPO = "gray-card/hypo";

// assemble a jsonl-ready record from loose form fields (blank fields dropped).
export function lensRecordFromFields(f = {}) {
  const num = (v) => {
    const n = parseFloat(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const fmin = num(f.focalLengthMin);
  const fmax = num(f.focalLengthMax) ?? fmin;
  const rec = {
    make: (f.make || "").trim() || null,
    model: (f.model || "").trim() || null,
    mount: (f.mount || "").trim() || null,
    mounts: (f.mount || "").trim() ? [(f.mount || "").trim()] : [],
    focalLengthMin: fmin,
    focalLengthMax: fmax,
    maxAperture: num(f.maxAperture),
    lensTypeKind: (f.lensTypeKind || "").trim() || (fmin != null && fmax != null && fmin !== fmax ? "zoom" : "prime"),
    wikidata: (f.wikidata || "").trim() || null,
    image: null,
    source: "user-suggested",
  };
  return rec;
}

// build the https://github.com/<repo>/issues/new?... url with a filled template.
export function lensIssueUrl(fields = {}, repo = LENS_ISSUE_REPO) {
  const rec = lensRecordFromFields(fields);
  const name = [rec.make, rec.model].filter(Boolean).join(" ").trim();
  const title = `Add lens: ${name || "(unnamed)"}`;
  const body = [
    "Please add this lens to the curated database (`data/curated-lenses.jsonl`).",
    "",
    "**Proposed entry** (one JSON object per line):",
    "```jsonl",
    JSON.stringify(rec),
    "```",
    "",
    "**Details**",
    `- Make: ${rec.make || ""}`,
    `- Model: ${rec.model || ""}`,
    `- Mount: ${rec.mount || ""}`,
    `- Focal length: ${rec.focalLengthMin ?? "?"}${rec.focalLengthMax && rec.focalLengthMax !== rec.focalLengthMin ? `-${rec.focalLengthMax}` : ""} mm`,
    `- Max aperture: f/${rec.maxAperture ?? "?"}`,
    `- Type: ${rec.lensTypeKind}`,
    `- Wikidata QID (if known): ${rec.wikidata || ""}`,
    "",
    "_Add a Wikimedia Commons image URL if you have one, otherwise leave `image` null._",
  ].join("\n");
  const q = new URLSearchParams({ title, body, labels: "lens-request" });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}
