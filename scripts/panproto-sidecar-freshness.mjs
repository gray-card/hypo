/** Require the published sidecar to contain the current lexicon suite, not just a staged proposal. */
export function assertPanprotoSidecarFresh(status, index) {
  // Panproto also reports unrelated repository files as "unpackaged". Only
  // changes to the manifest-backed lexicon package make the schema stale.
  if (/^  lexicons:\s*$/m.test(status)) {
    throw new Error("The checked-in Panproto snapshot is stale; stage and commit the current lexicons before release");
  }
  if (index.staged !== null || index.staged_protocol !== null || index.staged_data?.length !== 0) {
    throw new Error("The Panproto schema or corpus is staged but not committed; commit it before release");
  }
}
