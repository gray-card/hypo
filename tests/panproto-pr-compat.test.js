import { expect, it } from "vitest";
import { breakingChangesBelongOnlyToAddedNsids } from "../scripts/panproto-pr-compat.mjs";

const added = { type: "added_nsid", nsid: "app.graycard.print.exposurePlan" };

it("accepts required record-body and nested-definition fields inside a new NSID", () => {
  expect(
    breakingChangesBelongOnlyToAddedNsids({
      non_breaking: [added],
      breaking: [
        { vertex_id: "app/graycard/print/exposurePlan.json::app.graycard.print.exposurePlan:body" },
        { vertex_id: "app/graycard/print/exposurePlan.json::app.graycard.print.exposurePlan#selection" },
      ],
    }),
  ).toBe(true);
});

it("rejects a breaking change to an existing NSID, even alongside a new record", () => {
  expect(
    breakingChangesBelongOnlyToAddedNsids({
      non_breaking: [added],
      breaking: [
        { vertex_id: "app/graycard/print/exposurePlan.json::app.graycard.print.exposurePlan#selection" },
        { vertex_id: "app/graycard/rule/batch.json::app.graycard.rule.batch:body" },
      ],
    }),
  ).toBe(false);
});

it("does not mistake a similarly prefixed existing NSID for the new one", () => {
  expect(
    breakingChangesBelongOnlyToAddedNsids({
      non_breaking: [added],
      breaking: [{ vertex_id: "path::app.graycard.print.exposurePlanLegacy:body" }],
    }),
  ).toBe(false);
});
