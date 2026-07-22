// lint.js: metadata "checks" for the Rules tab. Pure and side-effect free so it
// is unit-testable. Given a loaded store it returns a list of findings the user
// can act on — never mutating anything (preview only; the user decides what to fix).

// each finding: { id, severity: "warn"|"info", title, detail, count }
export function computeLintFindings(store, now = Date.now()) {
  const out = [];
  const inst = store?.instance || {};
  const captures = [...(store?.photoCaptureByPhoto?.values?.() || [])];

  // 1. rolls that record more exposures used than the roll holds. "Used" is the
  // greater of the stored counter and the number of exposures actually logged
  // against the roll, so this stays accurate even when the counter isn't set.
  const loggedPerRoll = new Map();
  for (const e of (inst.exposure || [])) { const rl = e.value.roll; if (rl) loggedPerRoll.set(rl, (loggedPerRoll.get(rl) || 0) + 1); }
  const overshot = (inst.filmRoll || []).filter((r) => {
    const t = r.value.exposuresTotal;
    if (t == null) return false;
    const u = Math.max(r.value.exposuresUsed || 0, loggedPerRoll.get(r.uri) || 0);
    return u > t;
  });
  if (overshot.length) out.push({ id: "roll-overshot", severity: "warn", title: "Rolls over their frame count", detail: "Exposures used exceeds the roll's total frames.", count: overshot.length });

  // 2. rolls shot but not yet developed (a to-do, not an error)
  const awaiting = (inst.filmRoll || []).filter((r) => ["exposed", "at-lab", "partial"].includes(r.value.status));
  if (awaiting.length) out.push({ id: "roll-awaiting-dev", severity: "info", title: "Rolls awaiting development", detail: "Shot or partially shot rolls not marked developed.", count: awaiting.length });

  // 3. logged exposures not yet linked to a photo (the scan frame-link gap)
  const unlinked = (inst.exposure || []).filter((e) => !e.value.photo);
  if (unlinked.length) out.push({ id: "exposure-unlinked", severity: "info", title: "Exposures not linked to a photo", detail: "Link them during scanning so public photos inherit their metadata.", count: unlinked.length });

  // 4. chemistry that is expired or spent
  const chem = inst.chemistry || [];
  const expired = chem.filter((c) => c.value.expiresAt && Date.parse(c.value.expiresAt) < now);
  if (expired.length) out.push({ id: "chem-expired", severity: "warn", title: "Chemistry past its date", detail: "Mixed chemistry older than its use-by. Verify before developing.", count: expired.length });
  const spent = chem.filter((c) => {
    const cap = c.value.volumeMl, left = c.value.volumeRemainingMl;
    return cap != null && left != null && left <= 0;
  });
  if (spent.length) out.push({ id: "chem-spent", severity: "warn", title: "Chemistry out of capacity", detail: "No working solution left; mix or replenish.", count: spent.length });

  // 5. captures missing core gear (camera / lens)
  const noCamera = captures.filter((c) => !c.value.camera).length;
  const noLens = captures.filter((c) => !c.value.lens).length;
  if (noCamera) out.push({ id: "cap-no-camera", severity: "info", title: "Photos with no camera set", detail: "Tag a camera so the photo carries body metadata.", count: noCamera });
  if (noLens) out.push({ id: "cap-no-lens", severity: "info", title: "Photos with no lens set", detail: "Tag a lens for focal-length / aperture context.", count: noLens });

  return out;
}
