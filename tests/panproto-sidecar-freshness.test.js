import { describe, expect, it } from "vitest";
import { assertPanprotoSidecarFresh } from "../scripts/panproto-sidecar-freshness.mjs";

const committed = { staged: null, staged_protocol: null, staged_data: [] };

describe("checked-in Panproto snapshot freshness", () => {
  it("accepts a committed snapshot with no lexicon changes", () => {
    expect(() => assertPanprotoSidecarFresh("No changes since last add.", committed)).not.toThrow();
    expect(() =>
      assertPanprotoSidecarFresh("Changes since last add:\n  (unpackaged):\n    M  docs/readme.md", committed),
    ).not.toThrow();
  });

  it("rejects new or modified lexicons even when the conformance corpus is tracked", () => {
    const stale = `Changes since last add:\n  lexicons:\n    A  lexicons/app/graycard/instance/scanSetup.json\nData: fixtures/records directory\n  8 data set(s) tracked at HEAD`;
    expect(() => assertPanprotoSidecarFresh(stale, committed)).toThrow(/snapshot is stale/);
  });

  it("rejects an uncommitted stage", () => {
    expect(() => assertPanprotoSidecarFresh("No changes since last add.", { ...committed, staged: {} })).toThrow(
      /staged but not committed/,
    );
    expect(() => assertPanprotoSidecarFresh("No changes since last add.", { ...committed, staged_data: [{}] })).toThrow(
      /staged but not committed/,
    );
  });
});
