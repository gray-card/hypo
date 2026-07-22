import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OAUTH_SCOPE, WRITTEN_COLLECTIONS } from "../src/oauthScope.js";

// vitest runs with cwd at the repo root
const clientMetadata = JSON.parse(readFileSync("public/client-metadata.json", "utf8"));

describe("OAuth scope is granular and minimal", () => {
  it("requests no broad transitional grant", () => {
    expect(OAUTH_SCOPE).not.toContain("transition:generic");
    expect(OAUTH_SCOPE).not.toContain("transition:");
  });

  it("starts with the base atproto scope and grants blob uploads", () => {
    const toks = OAUTH_SCOPE.split(" ");
    expect(toks[0]).toBe("atproto");
    expect(toks).toContain("blob:*/*");
  });

  it("has exactly one repo scope per written collection, and nothing else", () => {
    const repoScopes = OAUTH_SCOPE.split(" ").filter((s) => s.startsWith("repo:"));
    expect(repoScopes.sort()).toEqual(WRITTEN_COLLECTIONS.map((c) => `repo:${c}`).sort());
  });

  it("only ever requests write on our own namespace + the grain collections we integrate with", () => {
    for (const c of WRITTEN_COLLECTIONS) {
      expect(c === "social.grain.gallery" || c === "social.grain.photo" ||
        c === "social.grain.gallery.item" || c === "social.grain.photo.exif" ||
        c.startsWith("app.graycard.")).toBe(true);
    }
  });

  it("never requests rpc / identity / account scopes", () => {
    for (const bad of ["rpc:", "identity:", "account:"]) expect(OAUTH_SCOPE).not.toContain(bad);
  });

  it("the static client-metadata.json declares exactly this scope", () => {
    // (run `node scripts/gen-client-metadata.mjs` if this drifts)
    expect(clientMetadata.scope).toBe(OAUTH_SCOPE);
  });
});
