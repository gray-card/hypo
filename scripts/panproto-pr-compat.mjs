export function breakingChangesBelongOnlyToAddedNsids(report) {
  const addedNsids = new Set(
    (report.non_breaking || [])
      .filter((change) => change.type === "added_nsid" && typeof change.nsid === "string")
      .map((change) => change.nsid),
  );
  return (
    addedNsids.size > 0 &&
    Array.isArray(report.breaking) &&
    report.breaking.length > 0 &&
    report.breaking.every(
      (change) =>
        typeof change.vertex_id === "string" &&
        [...addedNsids].some(
          (nsid) =>
            change.vertex_id.endsWith(`::${nsid}`) ||
            change.vertex_id.includes(`::${nsid}:`) ||
            change.vertex_id.includes(`::${nsid}#`),
        ),
    )
  );
}
