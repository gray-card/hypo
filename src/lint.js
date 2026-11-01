// lint.js: metadata "checks" for the Rules tab. Pure and side-effect free so it
// is unit-testable. Given a loaded store it returns a list of findings the user
// can act on — never mutating anything (preview only; the user decides what to fix).

// each finding: { id, severity: "warn"|"info", title, detail, count }
import { validateDevelopmentPlan, validateExposurePlan } from "@hypo/domain";

export function computeLintFindings(store, now = Date.now()) {
  const out = [];
  const inst = store?.instance || {};
  const captures = [...(store?.photoCaptureByPhoto?.values?.() || [])];

  // 1. rolls that record more exposures used than the roll holds. "Used" is the
  // greater of the stored counter and the number of exposures actually logged
  // against the roll, so this stays accurate even when the counter isn't set.
  const loggedPerRoll = new Map();
  for (const e of inst.exposure || []) {
    const rl = e.value.roll;
    if (rl) loggedPerRoll.set(rl, (loggedPerRoll.get(rl) || 0) + 1);
  }
  const overshot = (inst.filmRoll || []).filter((r) => {
    const t = r.value.exposuresTotal;
    if (t == null) return false;
    const u = Math.max(r.value.exposuresUsed || 0, loggedPerRoll.get(r.uri) || 0);
    return u > t;
  });
  if (overshot.length)
    out.push({
      id: "roll-overshot",
      severity: "warn",
      title: "Rolls over their frame count",
      detail: "Exposures used exceeds the roll's total frames.",
      count: overshot.length,
    });

  // 2. rolls shot but not yet developed (a to-do, not an error)
  const awaiting = (inst.filmRoll || []).filter((r) => ["exposed", "at-lab", "partial"].includes(r.value.status));
  if (awaiting.length)
    out.push({
      id: "roll-awaiting-dev",
      severity: "info",
      title: "Rolls awaiting development",
      detail: "Shot or partially shot rolls not marked developed.",
      count: awaiting.length,
    });

  // 3. logged exposures not yet linked to a photo (the scan frame-link gap)
  const unlinked = (inst.exposure || []).filter((e) => !e.value.photo);
  if (unlinked.length)
    out.push({
      id: "exposure-unlinked",
      severity: "info",
      title: "Exposures not linked to a photo",
      detail: "Link them during scanning so public photos inherit their metadata.",
      count: unlinked.length,
    });

  // 4. chemistry that is expired or spent
  const chem = inst.chemistry || [];
  const expired = chem.filter((c) => c.value.expiresAt && Date.parse(c.value.expiresAt) < now);
  if (expired.length)
    out.push({
      id: "chem-expired",
      severity: "warn",
      title: "Chemistry past its date",
      detail: "Mixed chemistry older than its use-by. Verify before developing.",
      count: expired.length,
    });
  const spent = chem.filter((c) => {
    const cap = c.value.volumeMl,
      left = c.value.volumeRemainingMl;
    return cap != null && left != null && left <= 0;
  });
  if (spent.length)
    out.push({
      id: "chem-spent",
      severity: "warn",
      title: "Chemistry out of capacity",
      detail: "No working solution left; mix or replenish.",
      count: spent.length,
    });

  // 5. captures missing core gear (camera / lens)
  const noCamera = captures.filter((c) => !c.value.camera).length;
  const noLens = captures.filter((c) => !c.value.lens).length;
  if (noCamera)
    out.push({
      id: "cap-no-camera",
      severity: "info",
      title: "Photos with no camera set",
      detail: "Tag a camera so the photo carries body metadata.",
      count: noCamera,
    });
  if (noLens)
    out.push({
      id: "cap-no-lens",
      severity: "info",
      title: "Photos with no lens set",
      detail: "Tag a lens for focal-length / aperture context.",
      count: noLens,
    });

  const known = (uri) => !uri || store?.byUri?.has?.(uri);
  const printPlans = store?.recordsByCollection?.["app.graycard.print.exposurePlan"] || [];
  const developmentPlans = store?.recordsByCollection?.["app.graycard.process.developmentPlan"] || [];
  const invalidPlans = [...printPlans, ...developmentPlans].filter((record) => {
    try {
      if (record.uri.includes(".print.exposurePlan/")) validateExposurePlan(record.value);
      else validateDevelopmentPlan(record.value);
      return false;
    } catch {
      return true;
    }
  });
  if (invalidPlans.length)
    out.push({
      id: "process-plan-invalid",
      severity: "warn",
      title: "Processing plans needing repair",
      detail: "Edit the plan to repair its timing, stages, or image selections before reusing it.",
      count: invalidPlans.length,
      subjects: invalidPlans.map((record) => record.uri),
    });
  const brokenPlanRefs = [...printPlans, ...developmentPlans].filter((record) => {
    const value = record.value;
    const refs = record.uri.includes(".print.exposurePlan/")
      ? (Array.isArray(value.exposures) ? value.exposures : []).flatMap((step) => [
          step?.targetNode,
          ...(Array.isArray(step?.selections) ? step.selections : []).map((selection) => selection?.sourceRegion),
        ])
      : (Array.isArray(value.steps) ? value.steps : []).flatMap((step) => [
          step?.recipe,
          ...(Array.isArray(step?.chemistries) ? step.chemistries : []),
        ]);
    return refs.some((ref) => typeof ref === "string" && ref.startsWith("at://") && !known(ref));
  });
  if (brokenPlanRefs.length)
    out.push({
      id: "process-plan-broken-link",
      severity: "warn",
      title: "Processing plans with missing linked records",
      detail: "Edit the plan to replace missing chemistry, recipes, or scene subjects and regions.",
      count: brokenPlanRefs.length,
      subjects: brokenPlanRefs.map((record) => record.uri),
    });
  const stalePlanSnapshots = [
    ...(store?.developSessions || []).filter(
      (session) => session.value.developmentPlan && !session.value.developmentPlanSnapshot,
    ),
    ...(store?.printSessions || []).filter(
      (session) => session.value.exposurePlan && !session.value.exposurePlanSnapshot,
    ),
  ];
  if (stalePlanSnapshots.length)
    out.push({
      id: "process-plan-no-snapshot",
      severity: "warn",
      title: "Sessions without a plan snapshot",
      detail:
        "Open each session and record the instructions actually used so later plan edits cannot change its history.",
      count: stalePlanSnapshots.length,
      subjects: stalePlanSnapshots.map((record) => record.uri),
    });
  const brokenSetupRefs = (inst.scanSetup || []).filter((setup) => {
    const components = setup.value.components || [];
    const ids = new Set(components.map((component) => component.id));
    return (
      components.some((component) => component.ref && !known(component.ref)) ||
      (setup.value.connections || []).some((link) => !ids.has(link.from) || !ids.has(link.to))
    );
  });
  if (brokenSetupRefs.length)
    out.push({
      id: "scan-setup-broken-link",
      severity: "warn",
      title: "Scanning setups with broken links",
      detail: "Edit the setup to replace missing equipment or reconnect removed components.",
      count: brokenSetupRefs.length,
      subjects: brokenSetupRefs.map((record) => record.uri),
    });

  const missingSnapshots = (store?.digitizeSessions || []).filter(
    (session) => session.value.scanSetup && !session.value.setupSnapshot,
  );
  if (missingSnapshots.length)
    out.push({
      id: "scan-session-no-snapshot",
      severity: "warn",
      title: "Scanning sessions without a setup snapshot",
      detail:
        "Open each session and save the components actually used; a later setup edit should not change its history.",
      count: missingSnapshots.length,
      subjects: missingSnapshots.map((record) => record.uri),
    });

  const brokenSessionRefs = [
    ...(store?.developSessions || []).map((record) => ({
      record,
      fields: ["filmRolls", "recipe", "lab", "developmentPlan"],
    })),
    ...(store?.digitizeSessions || []).map((record) => ({
      record,
      fields: ["filmRolls", "scanSetup", "scanner", "camera", "lens", "scanProfile"],
    })),
    ...(store?.printSessions || []).map((record) => ({
      record,
      fields: ["exposurePlan", "enlarger", "enlargingLens", "printer", "lightSource", "paper"],
    })),
  ].filter(({ record, fields }) =>
    fields.some((field) => {
      const refs = Array.isArray(record.value[field]) ? record.value[field] : [record.value[field]];
      return refs.some((ref) => typeof ref === "string" && ref.startsWith("at://") && !known(ref));
    }),
  );
  if (brokenSessionRefs.length)
    out.push({
      id: "process-broken-link",
      severity: "warn",
      title: "Process sessions with missing linked records",
      detail:
        "Review the linked rolls, equipment, recipes, and profiles in these development, scanning, or printing logs.",
      count: brokenSessionRefs.length,
      subjects: brokenSessionRefs.map(({ record }) => record.uri),
    });

  const unloggedStages = (store?.workflowStages || []).filter((stage) => {
    const type = String(stage.value.$type || "");
    const processStage = ["developStage", "digitizeStage", "printStage"].some((suffix) => type.endsWith(`#${suffix}`));
    return processStage && stage.value.status === "completed" && !stage.value.session;
  });
  if (unloggedStages.length)
    out.push({
      id: "workflow-completed-without-log",
      severity: "warn",
      title: "Completed workflow steps without process logs",
      detail:
        "Attach a development, digitization, or printing session to each completed step, or mark it skipped if no work occurred.",
      count: unloggedStages.length,
      subjects: unloggedStages.map((record) => record.uri),
    });

  return out;
}
