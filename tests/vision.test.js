import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeAnalysis, writeSceneGraph, validateConfig, resolveModel, PROVIDERS, getProvider, DEFAULT_PROVIDER, clearSceneGraph, preparePhotoImage } from "../src/vision.js";
import { NS } from "../src/graycard.js";
import { mockAgent } from "./setup.js";

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe("normalizeAnalysis", () => {
  it("keeps typed objects, drops those with no type, and coins missing keys", () => {
    const out = normalizeAnalysis({
      altText: "A cat on a mat.",
      objects: [
        { key: "o1", type: "cat", label: "the cat", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
        { type: "mat" },                       // no key -> coined
        { label: "nameless", box: { x: 0, y: 0, w: 1, h: 1 } }, // no type -> dropped
      ],
      relations: [],
    });
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0]).toMatchObject({ key: "o1", label: "the cat", type: { id: "cat", label: "cat" } });
    expect(out.nodes[1].key).toBe("o2");        // coined from index
  });

  it("clamps bounding boxes into [0,1] and drops non-numeric boxes", () => {
    const out = normalizeAnalysis({
      altText: "x",
      objects: [
        { key: "a", type: "sky", box: { x: -0.5, y: 2, w: 0.5, h: 0.5 } },
        { key: "b", type: "ground", box: { x: "0.1", y: 0.1, w: 0.1, h: 0.1 } }, // non-number -> no box
      ],
      relations: [],
    });
    expect(out.nodes[0].box).toEqual({ x: 0, y: 1, w: 0.5, h: 0.5 });
    expect(out.nodes[1].box).toBeNull();
  });

  it("keeps only relations whose endpoints are real, distinct nodes", () => {
    const out = normalizeAnalysis({
      altText: "x",
      objects: [{ key: "a", type: "person" }, { key: "b", type: "bike" }],
      relations: [
        { from: "a", to: "b", type: "riding" },  // valid
        { from: "a", to: "ghost", type: "near" }, // unknown endpoint -> dropped
        { from: "a", to: "a", type: "self" },     // self-loop -> dropped
        { from: "a", to: "b" },                   // no type -> dropped
      ],
    });
    expect(out.edges).toEqual([{ from: "a", to: "b", type: { id: "riding", label: "riding" } }]);
  });

  it("falls back to description when altText is missing", () => {
    const out = normalizeAnalysis({ description: "A long description.", objects: [], relations: [] });
    expect(out.altText).toBe("A long description.");
  });

  it("tolerates missing/garbage input", () => {
    const out = normalizeAnalysis({});
    expect(out).toEqual({ altText: "", description: "", nodes: [], edges: [] });
  });
});

describe("writeSceneGraph", () => {
  const PHOTO = "at://did:plc:test/social.grain.photo/p1";

  it("creates graph -> region -> node -> edge with correct cross-references", async () => {
    const agent = mockAgent();
    const analysis = normalizeAnalysis({
      altText: "A dog left of a tree.",
      objects: [
        { key: "o1", type: "dog", label: "the dog", box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } },
        { key: "o2", type: "tree" }, // no box -> no region
      ],
      relations: [{ from: "o1", to: "o2", type: "left of" }],
    });

    const graphUri = await writeSceneGraph(agent, "did:plc:test", PHOTO, analysis);

    const uriOf = (i) => `at://did:plc:test/${agent.created[i].collection}/rk${i + 1}`;
    const graphs = agent.created.filter((c) => c.collection === NS.scene.graph);
    const regions = agent.created.filter((c) => c.collection === NS.scene.region);
    const nodes = agent.created.filter((c) => c.collection === NS.scene.node);
    const edges = agent.created.filter((c) => c.collection === NS.scene.edge);

    expect(graphs).toHaveLength(1);
    expect(regions).toHaveLength(1);   // only the boxed node gets a region
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);

    // graph is subject-bound to the photo and marked as analysis provenance
    expect(graphs[0].record.subject).toBe(PHOTO);
    expect(graphs[0].record.provenance.source).toBe("analysis");
    expect(graphUri).toBe(uriOf(agent.created.indexOf(graphs[0])));

    // region is a bbox scaled into integer millionths
    expect(regions[0].record).toMatchObject({
      photo: PHOTO, kind: "bbox",
      bbox: { x: 100000, y: 200000, w: 300000, h: 400000 },
    });

    // every node points back at the graph; the boxed node points at its region
    const nodeUris = nodes.map((c) => uriOf(agent.created.indexOf(c)));
    const regionUri = uriOf(agent.created.indexOf(regions[0]));
    for (const n of nodes) expect(n.record.scene).toBe(graphUri);
    expect(nodes.filter((n) => n.record.region).length).toBe(1);
    expect(nodes.find((n) => n.record.region).record.region).toBe(regionUri);

    // edge wires the two node URIs and is bound to the graph
    expect(edges[0].record.scene).toBe(graphUri);
    expect(nodeUris).toContain(edges[0].record.from);
    expect(nodeUris).toContain(edges[0].record.to);
    expect(edges[0].record.from).not.toBe(edges[0].record.to);
    expect(edges[0].record.type).toEqual({ id: "left of", label: "left of" });
  });

  it("skips edges whose nodes were dropped", async () => {
    const agent = mockAgent();
    // an edge referencing a key with no node should not be written
    const analysis = { nodes: [{ key: "o1", type: { id: "cat", label: "cat" }, label: "", box: null }], edges: [{ from: "o1", to: "missing", type: { id: "x", label: "x" } }] };
    await writeSceneGraph(agent, "did:plc:test", PHOTO, analysis);
    expect(agent.created.filter((c) => c.collection === NS.scene.edge)).toHaveLength(0);
  });
});

describe("Claude provider network contract", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("validateConfig requires a key and pings /models with the browser-access header", async () => {
    await expect(validateConfig({ provider: "claude", apiKey: "" })).rejects.toThrow(/API key/);

    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(validateConfig({ provider: "claude", apiKey: "sk-ant-abc", model: "claude-opus-4-8" })).resolves.toBe(true);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("api.anthropic.com/v1/models");
    expect(opts.headers["x-api-key"]).toBe("sk-ant-abc");
    expect(opts.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("surfaces a 401 as a clear rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { error: { message: "bad key" } })));
    await expect(validateConfig({ provider: "claude", apiKey: "sk-ant-x" })).rejects.toThrow(/401/);
  });

  it("analyze posts an image + JSON-schema request and normalizes the structured reply", async () => {
    const reply = {
      content: [{ type: "text", text: JSON.stringify({
        altText: "A person on a bike.",
        objects: [{ key: "o1", type: "person" }, { key: "o2", type: "bicycle", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 } }],
        relations: [{ from: "o1", to: "o2", type: "riding" }],
      }) }],
    };
    const fetchMock = vi.fn(async () => jsonResponse(200, reply));
    vi.stubGlobal("fetch", fetchMock);

    const out = await PROVIDERS.claude.analyze(
      { apiKey: "sk-ant-abc", model: "claude-haiku-4-5" },
      { base64: "AAAA", mediaType: "image/jpeg" },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/messages");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.output_config.format.type).toBe("json_schema");
    const content = body.messages[0].content;
    expect(content.find((b) => b.type === "image").source).toMatchObject({ type: "base64", media_type: "image/jpeg", data: "AAAA" });

    expect(out.altText).toBe("A person on a bike.");
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toEqual([{ from: "o1", to: "o2", type: { id: "riding", label: "riding" } }]);
  });

  it("analyze raises on an API error and on a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: { message: "too big" } })));
    await expect(PROVIDERS.claude.analyze({ apiKey: "k", model: "m" }, { base64: "x", mediaType: "image/png" }))
      .rejects.toThrow(/too big/);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { stop_reason: "refusal", content: [] })));
    await expect(PROVIDERS.claude.analyze({ apiKey: "k", model: "m" }, { base64: "x", mediaType: "image/png" }))
      .rejects.toThrow(/declined/);
  });
});

describe("Gemini provider network contract", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("validateConfig routes to Gemini and pings /models with the x-goog-api-key header", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { models: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(validateConfig({ provider: "gemini", apiKey: "AIzaXYZ", model: "gemini-flash-latest" })).resolves.toBe(true);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com/v1beta/models");
    expect(opts.headers["x-goog-api-key"]).toBe("AIzaXYZ");
  });

  it("surfaces a rejected key (400/403) with the API message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(400, { error: { message: "API key not valid" } })));
    await expect(validateConfig({ provider: "gemini", apiKey: "bad" })).rejects.toThrow(/not valid/);
  });

  it("analyze posts an inlineData image to generateContent and normalizes the JSON reply", async () => {
    const reply = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
      altText: "A boat on water.",
      objects: [{ key: "o1", type: "boat", box: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 } }, { key: "o2", type: "water" }],
      relations: [{ from: "o1", to: "o2", type: "on" }],
    }) }] } }] };
    const fetchMock = vi.fn(async () => jsonResponse(200, reply));
    vi.stubGlobal("fetch", fetchMock);

    const out = await PROVIDERS.gemini.analyze(
      { apiKey: "AIzaXYZ", model: "gemini-3.5-flash" },
      { base64: "BBBB", mediaType: "image/png" },
    );

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1beta/models/gemini-3.5-flash:generateContent");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBeTruthy();
    const parts = body.contents[0].parts;
    expect(parts.find((p) => p.inlineData).inlineData).toEqual({ mimeType: "image/png", data: "BBBB" });

    expect(out.altText).toBe("A boat on water.");
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0].box).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 });
    expect(out.edges).toEqual([{ from: "o1", to: "o2", type: { id: "on", label: "on" } }]);
  });

  it("raises on an API error, a prompt block, and an unusable finishReason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: { message: "quota exceeded" } })));
    await expect(PROVIDERS.gemini.analyze({ apiKey: "k", model: "m" }, { base64: "x", mediaType: "image/jpeg" }))
      .rejects.toThrow(/quota exceeded/);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { promptFeedback: { blockReason: "SAFETY" }, candidates: [] })));
    await expect(PROVIDERS.gemini.analyze({ apiKey: "k", model: "m" }, { base64: "x", mediaType: "image/jpeg" }))
      .rejects.toThrow(/blocked/);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] })));
    await expect(PROVIDERS.gemini.analyze({ apiKey: "k", model: "m" }, { base64: "x", mediaType: "image/jpeg" }))
      .rejects.toThrow(/without a usable answer/);
  });
});

describe("provider registry is modal-ready", () => {
  it("every provider has the fields the connect UI and orchestration rely on", () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.keyLabel).toBe("string");
      expect(typeof p.keyPlaceholder).toBe("string");
      expect(typeof p.keyUrl).toBe("string");
      expect(typeof p.billingNote).toBe("string");
      expect(Array.isArray(p.models) && p.models.length).toBeTruthy();
      for (const m of p.models) { expect(typeof m.id).toBe("string"); expect(typeof m.label).toBe("string"); }
      expect(p.models.some((m) => m.id === p.defaultModel)).toBe(true);   // default is a real option
      expect(typeof p.validate).toBe("function");
      expect(typeof p.analyze).toBe("function");
    }
  });

  it("no user-facing provider string contains an em-dash", () => {
    for (const p of Object.values(PROVIDERS)) {
      const strings = [p.label, p.keyLabel, p.keyPlaceholder, p.keyHint, p.billingNote, ...p.models.map((m) => m.label)];
      for (const s of strings) expect(s || "").not.toContain("—");
    }
  });
});

describe("resolveModel auto-heals retired model ids", () => {
  it("keeps a listed model and falls back to the default for an unknown/retired one", () => {
    expect(resolveModel(PROVIDERS.gemini, { model: "gemini-3.5-flash" })).toBe("gemini-3.5-flash");
    expect(resolveModel(PROVIDERS.gemini, { model: "gemini-2.5-flash" })).toBe(PROVIDERS.gemini.defaultModel);
    expect(resolveModel(PROVIDERS.gemini, {})).toBe(PROVIDERS.gemini.defaultModel);
    expect(resolveModel(PROVIDERS.claude, { model: "claude-opus-4-8" })).toBe("claude-opus-4-8");
  });

  it("analyze sends the default when the stored model was retired", async () => {
    const reply = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"altText":"x","objects":[],"relations":[]}' }] } }] };
    const fetchMock = vi.fn(async () => jsonResponse(200, reply));
    vi.stubGlobal("fetch", fetchMock);
    await PROVIDERS.gemini.analyze({ apiKey: "k", model: "gemini-2.5-flash" }, { base64: "x", mediaType: "image/jpeg" });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(`/v1beta/models/${PROVIDERS.gemini.defaultModel}:generateContent`);
    expect(url).not.toContain("gemini-2.5-flash");
    vi.unstubAllGlobals();
  });
});

describe("getProvider / DEFAULT_PROVIDER", () => {
  it("returns the configured provider, or the default when absent or unknown", () => {
    expect(DEFAULT_PROVIDER).toBe("claude");
    expect(getProvider({ provider: "gemini" })).toBe(PROVIDERS.gemini);
    expect(getProvider({ provider: "claude" })).toBe(PROVIDERS.claude);
    expect(getProvider({ provider: "nope" })).toBe(PROVIDERS[DEFAULT_PROVIDER]); // unknown -> default
    expect(getProvider(undefined)).toBe(PROVIDERS[DEFAULT_PROVIDER]);            // missing -> default
  });
});

describe("clearSceneGraph", () => {
  const PHOTO = "at://did:plc:test/social.grain.photo/p1";
  const OTHER = "at://did:plc:test/social.grain.photo/p2";
  const uri = (coll, rk) => `at://did:plc:test/${coll}/${rk}`;

  // a fake agent whose listRecords returns canned records per collection
  function sceneAgent(byCollection) {
    const deleted = [];
    return {
      deleted,
      com: { atproto: { repo: {
        listRecords: async ({ collection }) => ({
          data: { records: (byCollection[collection] || []).map((r) => ({ uri: r.uri, cid: "c", value: r.value })) },
        }),
        deleteRecord: async ({ collection, rkey }) => { deleted.push(`${collection}/${rkey}`); return {}; },
      } } },
    };
  }

  it("deletes every graph bound to the photo plus its nodes/edges/regions, and nothing else", async () => {
    const g1 = uri(NS.scene.graph, "g1"), g2 = uri(NS.scene.graph, "g2"), gOther = uri(NS.scene.graph, "g3");
    const agent = sceneAgent({
      [NS.scene.graph]: [
        { uri: g1, value: { subject: PHOTO } },
        { uri: g2, value: { subject: PHOTO } },      // stray second graph for the same photo
        { uri: gOther, value: { subject: OTHER } },  // different photo -> keep
      ],
      [NS.scene.node]: [
        { uri: uri(NS.scene.node, "n1"), value: { scene: g1 } },      // -> delete
        { uri: uri(NS.scene.node, "n2"), value: { scene: gOther } },  // -> keep
      ],
      [NS.scene.edge]: [{ uri: uri(NS.scene.edge, "e1"), value: { scene: g2 } }], // -> delete
      [NS.scene.region]: [
        { uri: uri(NS.scene.region, "r1"), value: { photo: PHOTO } }, // -> delete
        { uri: uri(NS.scene.region, "r2"), value: { photo: OTHER } }, // -> keep
      ],
    });

    await clearSceneGraph(agent, "did:plc:test", PHOTO);

    expect(agent.deleted.sort()).toEqual([
      `${NS.scene.edge}/e1`,
      `${NS.scene.graph}/g1`,
      `${NS.scene.graph}/g2`,
      `${NS.scene.node}/n1`,
      `${NS.scene.region}/r1`,
    ].sort());
  });

  it("no-ops when the photo has no scene graph", async () => {
    const agent = sceneAgent({ [NS.scene.graph]: [{ uri: uri(NS.scene.graph, "gX"), value: { subject: OTHER } }] });
    await clearSceneGraph(agent, "did:plc:test", PHOTO);
    expect(agent.deleted).toEqual([]);
  });
});

describe("preparePhotoImage (fallback path: browser cannot decode/resize)", () => {
  // jsdom has no createImageBitmap, so preparePhotoImage always takes the
  // fallback branch that guards format and payload size before sending as-is.
  const blobRef = (mimeType) => ({ $type: "blob", ref: { $link: "bafkreitest" }, mimeType });
  const imgAgent = (bytes, type) => ({
    com: { atproto: { sync: { getBlob: async () => ({ data: new Blob([bytes], { type }) }) } } },
  });

  it("returns base64 + mediaType for a small, supported image", async () => {
    const agent = imgAgent(new Uint8Array([1, 2, 3, 4]), "image/png");
    const out = await preparePhotoImage(agent, "did:plc:test", blobRef("image/png"));
    expect(out.mediaType).toBe("image/png");
    expect(typeof out.base64).toBe("string");
    expect(out.base64.length).toBeGreaterThan(0);
  });

  it("throws an actionable error for an unsupported format", async () => {
    const agent = imgAgent(new Uint8Array([1, 2, 3]), "image/tiff");
    await expect(preparePhotoImage(agent, "did:plc:test", blobRef("image/tiff"))).rejects.toThrow(/Unsupported image format/);
  });

  it("throws when a supported image is too large to send un-resized", async () => {
    const big = new Uint8Array(3_600_000); // over the ~3.5MB fallback ceiling
    const agent = imgAgent(big, "image/jpeg");
    await expect(preparePhotoImage(agent, "did:plc:test", blobRef("image/jpeg"))).rejects.toThrow(/too large/);
  });
});

describe("provider.describe (alt text only, no object detection)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("Claude: posts a plain completion (no JSON schema) and returns cleaned alt text", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { content: [{ type: "text", text: '  "A dog on a porch."\n' }] }));
    vi.stubGlobal("fetch", fetchMock);
    const alt = await PROVIDERS.claude.describe({ apiKey: "sk-ant-x", model: "claude-haiku-4-5" }, { base64: "AAAA", mediaType: "image/jpeg" });
    expect(alt).toBe("A dog on a porch.");                 // whitespace + wrapping quotes stripped
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/messages");
    const body = JSON.parse(opts.body);
    expect(body.output_config).toBeUndefined();            // NOT a scene-graph request
    expect(body.system).toMatch(/alt text/i);
  });

  it("Gemini: posts a text request (no responseMimeType json) and returns alt text", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A dog on a porch." }] } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const alt = await PROVIDERS.gemini.describe({ apiKey: "k", model: "gemini-flash-latest" }, { base64: "AAAA", mediaType: "image/jpeg" });
    expect(alt).toBe("A dog on a porch.");
    const [, opts] = fetchMock.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.generationConfig?.responseMimeType).toBeUndefined();
  });

  it("both providers expose describe (models support alt-text generation)", () => {
    expect(typeof PROVIDERS.claude.describe).toBe("function");
    expect(typeof PROVIDERS.gemini.describe).toBe("function");
  });
});
