import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

// walk up from the working directory to find the lexicons/ tree
function findLexRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "lexicons");
    if (existsSync(join(candidate, "app", "graycard"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate lexicons/ directory");
}

const LEX_ROOT = findLexRoot();

function allLexicons() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".json")) out.push(p);
    }
  })(LEX_ROOT);
  return out.map((p) => ({ path: p, doc: JSON.parse(readFileSync(p, "utf8")) }));
}

function load(id) {
  const rel = id.replace(/^app\.graycard\./, "").replace(/\./g, "/");
  return JSON.parse(readFileSync(join(LEX_ROOT, "app/graycard", `${rel}.json`), "utf8"));
}

describe("lexicon shape guards", () => {
  const lexicons = allLexicons();

  it("every lexicon parses as valid JSON with an id and defs", () => {
    for (const { path, doc } of lexicons) {
      expect(doc.id, path).toMatch(/^app\.graycard\./);
      expect(doc.defs, path).toBeTruthy();
    }
  });

  it("every ref resolves to a defined def", () => {
    const known = new Set();
    for (const { doc } of lexicons) {
      for (const name of Object.keys(doc.defs || {})) known.add(`${doc.id}#${name}`);
    }
    const broken = [];
    for (const { doc } of lexicons) {
      JSON.stringify(doc, (k, v) => {
        if (k === "ref" && typeof v === "string" && v.includes("#")) {
          const full = v.startsWith("#") ? doc.id + v : v;
          if (!known.has(full)) broken.push(`${doc.id}: ${v}`);
        }
        return v;
      });
    }
    expect(broken).toEqual([]);
  });

  it("shared enums live in defs and are referenced (not duplicated inline)", () => {
    const defs = load("defs").defs;
    for (const name of ["tankType", "negativeFormat", "inversionMethod", "projectMode", "filmProcess"]) {
      expect(defs[name], `defs#${name}`).toBeTruthy();
      expect(defs[name].knownValues.length).toBeGreaterThan(0);
    }
    // devRecipe.process + tankType reference the shared defs
    const dr = load("catalog.devRecipe").defs.main.record.properties;
    expect(dr.process).toEqual({ type: "ref", ref: "app.graycard.defs#filmProcess" });
    expect(dr.tankType).toEqual({ type: "ref", ref: "app.graycard.defs#tankType" });
    // enlarger/enlargingLens reference negativeFormat
    expect(load("catalog.enlargerType").defs.main.record.properties.maxFormat.ref)
      .toBe("app.graycard.defs#negativeFormat");
  });

  it("session.capture keeps arrays and has no deprecated singular fields", () => {
    const p = load("session.capture").defs.main.record.properties;
    expect(p.cameras.type).toBe("array");
    expect(p.rolls.type).toBe("array");
    for (const gone of ["camera", "lens", "filmRoll", "place", "location"]) {
      expect(p[gone], `session.capture should not have singular ${gone}`).toBeUndefined();
    }
    expect(p.provenance.ref).toBe("app.graycard.defs#provenance");
  });

  it("developSession keeps filmRolls (array) and drops singular filmRoll", () => {
    const p = load("process.developSession").defs.main.record.properties;
    expect(p.filmRolls.type).toBe("array");
    expect(p.filmRoll).toBeUndefined();
    expect(p.provenance.ref).toBe("app.graycard.defs#provenance");
  });

  it("digitizeSession links rolls/photos and carries provenance", () => {
    const p = load("process.digitizeSession").defs.main.record.properties;
    expect(p.filmRolls.type).toBe("array");
    expect(p.photos.type).toBe("array");
    expect(p.provenance.ref).toBe("app.graycard.defs#provenance");
  });

  it("exposure carries provenance", () => {
    const p = load("instance.exposure").defs.main.record.properties;
    expect(p.provenance.ref).toBe("app.graycard.defs#provenance");
  });

  it("every record def has a top-level description", () => {
    const missing = [];
    for (const { doc } of lexicons) {
      for (const [name, def] of Object.entries(doc.defs || {})) {
        if (def.type === "record" && !def.description) missing.push(`${doc.id}#${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("scene.ontology is a type VOCABULARY (node + edge types), with no type-to-type relation edges", () => {
    const o = load("scene.ontology").defs;
    // type-to-type relation edges are intentionally NOT modeled (quantifier-promotion firewall)
    expect(o.edge).toBeUndefined();
    expect(o.main.record.properties.edges).toBeUndefined();
    expect(o.main.record.properties.axioms).toBeUndefined();
    // the vocabulary: node types and edge (relation) types
    expect(o.main.record.properties.nodeTypes.items.ref).toBe("#typeDecl");
    expect(o.main.record.properties.edgeTypes.items.ref).toBe("#typeDecl");
    // edge (relation) types carry algebra + asserted domain/range + observed witnesses
    for (const k of ["inverse", "opposite", "symmetric", "transitive", "reflexive", "functional", "domain", "range", "domainIncludes", "rangeIncludes"]) {
      expect(o.typeDecl.properties[k], `typeDecl.${k}`).toBeTruthy();
    }
    // A-Box invariant unchanged: scene.edge relates two grounded node INSTANCES
    const edge = load("scene.edge").defs.main.record.properties;
    expect(edge.from.format).toBe("at-uri");
    expect(edge.to.format).toBe("at-uri");
  });

  it("known free-text strings are bounded with maxLength", () => {
    const defs = load("defs").defs;
    expect(defs.mount.maxLength).toBeGreaterThan(0);
    expect(defs.stopFraction.knownValues).toEqual(["1", "1/2", "1/3"]);
    expect(load("catalog.cameraType").defs.main.record.properties.minShutterSpeed.ref)
      .toBe("app.graycard.defs#scaledInteger");
    expect(load("catalog.lensType").defs.main.record.properties.apertureSteps.items.ref)
      .toBe("app.graycard.defs#scaledInteger");
    expect(defs.sourceFile.properties.mimeType.maxLength).toBeGreaterThan(0);
    expect(load("catalog.filmStock").defs.main.record.properties.datasheetUrl.maxLength).toBeGreaterThan(0);
    expect(load("catalog.devRecipe").defs.main.record.properties.source.maxLength).toBeGreaterThan(0);
  });
});
