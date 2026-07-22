import { describe, it, expect, beforeEach } from "vitest";
import {
  constellationBase, setConstellationBase, DEFAULT_CONSTELLATION,
  HYPO_REGISTRY, ANCHOR_PATH, SETUP_NSID,
} from "../src/registry.js";

describe("registry constants + Constellation config", () => {
  beforeEach(() => localStorage.clear());

  it("freezes the anchor, path, and nsid", () => {
    expect(SETUP_NSID).toBe("app.graycard.setup");
    expect(ANCHOR_PATH).toBe(".registry");
    expect(HYPO_REGISTRY).toMatch(/^https:\/\/hypo\.graycard\.app\/ns\/registry\/\d+$/);
  });

  it("defaults to the public instance", () => {
    expect(constellationBase()).toBe(DEFAULT_CONSTELLATION);
  });

  it("uses an override and strips trailing slashes", () => {
    setConstellationBase("https://my.example.com/");
    expect(constellationBase()).toBe("https://my.example.com");
  });

  it("clears the override on a blank value", () => {
    setConstellationBase("https://my.example.com");
    setConstellationBase("");
    expect(constellationBase()).toBe(DEFAULT_CONSTELLATION);
  });
});
