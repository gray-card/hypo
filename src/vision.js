// vision.js: pluggable image-analysis providers.
//
// A provider turns a photo's pixels into (i) screen-reader alt text and (ii) a
// scene graph — a set of typed objects, their approximate regions, and the
// relations between them. The results are persisted with the app's existing
// records: alt text onto the social.grain.photo record, and the scene graph as
// app.graycard.scene.{graph,region,node,edge} — the same shapes the manual
// scene editor writes, so analysis output is fully editable afterwards.
//
// The app is static with no backend, so a provider is called directly from the
// browser: its key lives in localStorage (see getVisionConfig in ui/dom.js) and
// the request goes straight to the provider host. Only providers that permit
// browser calls can be adapters here — Claude does, via the
// `anthropic-dangerous-direct-browser-access` header. Adding another provider
// later is one entry in PROVIDERS; nothing else in the app knows the difference.

import { NS, saveRecord, deleteRecord } from "./graycard.js";
import { listRecords, blobBytes, savePhotoAlt } from "./grain.js";
import { autoGroundAnalysis } from "./grounding.js";

const now = () => new Date().toISOString();
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const SCALE = 1_000_000;                 // scene coords are normalized [0,1] × 1e6
const sc = (n) => Math.round(clamp01(n) * SCALE);

// ---------------------------------------------------------------------------
// Provider registry. Each adapter implements two async methods:
//   validate(config)        -> resolves if the key works, throws otherwise
//   analyze(config, image)  -> { altText, description, nodes[], edges[] }
// where image is { base64, mediaType } and a node is
//   { key, type:{id,label}, label, box:{x,y,w,h}|null } (box in [0,1] fractions)
// and an edge is { from:key, to:key, type:{id,label} }.
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_HEADERS = (key) => ({
  "content-type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  // opt into CORS for direct browser use (see file header).
  "anthropic-dangerous-direct-browser-access": "true",
});

// JSON schema the model must fill. Kept flat and constraint-free so it satisfies
// structured-outputs limits (no min/max/length, no recursion).
const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    altText: {
      type: "string",
      description: "Concise, screen-reader-friendly alt text: one plain sentence (~125 characters) describing the image for someone who cannot see it. No 'image of' preamble.",
    },
    description: {
      type: "string",
      description: "A slightly longer 1–3 sentence description of the scene.",
    },
    objects: {
      type: "array",
      description: "The salient objects/people/things in the image.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", description: "A short unique id like o1, o2 used to reference this object in relations." },
          type: { type: "string", description: "A general class noun, lowercase, e.g. person, dog, tree, car, sky." },
          label: { type: "string", description: "An optional specific instance label, e.g. 'the cyclist' or 'red door'." },
          box: {
            type: "object",
            additionalProperties: false,
            description: "Approximate bounding box as fractions of image width/height in [0,1], origin at the top-left. Omit if unsure.",
            properties: {
              x: { type: "number" }, y: { type: "number" },
              w: { type: "number" }, h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
          },
        },
        required: ["key", "type"],
      },
    },
    relations: {
      type: "array",
      description: "Spatial or semantic relations between objects, referencing their keys.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string", description: "key of the source object" },
          to: { type: "string", description: "key of the target object" },
          type: { type: "string", description: "the relation, lowercase, e.g. above, below, left of, holding, part of, next to." },
        },
        required: ["from", "to", "type"],
      },
    },
  },
  required: ["altText", "objects", "relations"],
};

const ANALYSIS_INSTRUCTION =
  "You are a meticulous image-analysis assistant for a photography app. Look at the image and return a scene description. " +
  "Write alt text that is accurate, specific, and concise for a screen-reader user. " +
  "List the salient objects with a general lowercase type and an approximate bounding box (fractions of the image, top-left origin) when you can place it; omit the box if uncertain. " +
  "Then list the meaningful spatial or semantic relations between those objects. Only describe what is actually visible.";

// Alt-text-only instruction: used by describe(), which skips object detection.
const ALT_TEXT_INSTRUCTION =
  "You write screen-reader alt text for photographs. Look at the image and return ONE plain sentence " +
  "(about 125 characters) describing it accurately and specifically for someone who cannot see it. " +
  "No 'image of' or 'photo of' preamble, no markdown, no surrounding quotes. Describe only what is visible.";

// Query parsing (optional, opt-in): translate a natural-language photo-search
// query into the shared query IR that src/sceneSearch.js evaluates. The model
// emits plain LABELS only; QID grounding + hierarchy stay in our code.
const PARSE_INSTRUCTION =
  "You translate a photo-search query into a small JSON query structure of this exact shape: " +
  '{"match": "all" | "any", "clauses": [ ... ]}. ' +
  'Each clause is either {"kind":"object","concept":string,"negate"?:boolean,"minCount"?:integer} ' +
  'or {"kind":"relation","subject"?:string,"relation":string,"object"?:string,"negate"?:boolean}. ' +
  'Rules: use plain lowercase class nouns for concept/subject/object and keep multi-word nouns whole ("fire hydrant" is ONE concept); ' +
  "NEVER output Wikidata Q-numbers. Use a natural relation phrase for relation (left of, to the left of, on top of, near, riding, holding). " +
  'Two space-separated nouns with no relation between them are TWO separate object clauses ("dog tree" => two object clauses). ' +
  'match is "all" unless the user writes "or". Set negate:true for no/without/not. Use minCount only for an explicit number ("two dogs" => minCount 2), never for "a" or "the". Drop articles. Only encode what the query says.';

// Flat, constraint-free JSON schema (same discipline as SCENE_SCHEMA). Per-kind
// requirements are enforced in code (validateIR), not the schema.
const QUERY_IR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["match", "clauses"],
  properties: {
    match: { type: "string", enum: ["all", "any"], description: "all = AND across clauses (default); any = OR." },
    clauses: {
      type: "array",
      description: "One clause per object or relation the query asks for.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["object", "relation"] },
          concept: { type: "string", description: "object clause: a lowercase class noun, e.g. dog, fire hydrant, animal." },
          subject: { type: "string", description: "relation clause: subject label (omit for a wildcard)." },
          relation: { type: "string", description: "relation clause: a natural relation phrase, e.g. left of, riding." },
          object: { type: "string", description: "relation clause: object label (omit for a wildcard)." },
          negate: { type: "boolean", description: "true for no/without/not X." },
          minCount: { type: "integer", description: "only for an explicit quantity like 'two dogs'; a lower bound." },
        },
      },
    },
  },
};

const relationHint = (relations) => (relations?.length ? " Prefer these known relations when they fit: " + relations.slice(0, 40).join(", ") + "." : "");

// Query reranking (optional, opt-in): score how well each candidate photo's TEXT
// descriptor matches the query, as a third fusion signal. Judges text only (no
// image), one cheap call over the top candidates.
const RERANK_INSTRUCTION =
  "You judge how well each numbered photo matches a search query, using ONLY the photo's short text description. " +
  'Return JSON of the exact shape {"scores":[{"i":<photo number>,"rel":<0-3>}]} with one entry per photo: ' +
  "3 = clearly matches, 2 = probably, 1 = loosely related, 0 = not related. Base it only on the given text.";
const RERANK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["i", "rel"], properties: { i: { type: "integer" }, rel: { type: "integer" } } },
    },
  },
};
const rerankPrompt = (query, texts) => `Query: "${query}"\n\nPhotos:\n${texts.map((t, i) => `${i + 1}. ${String(t || "").slice(0, 240)}`).join("\n")}\n\nReturn a 0-3 relevance score for each numbered photo as JSON.`;

const claudeProvider = {
  id: "claude",
  label: "Claude (Anthropic)",
  keyLabel: "Anthropic API key",
  keyPlaceholder: "sk-ant-…",
  keyHint: "Stored only in this browser, never uploaded.",
  keyUrl: "https://console.anthropic.com/settings/keys",
  billingNote: "Uses pay-as-you-go API credits, billed separately from a Claude Pro/Max subscription. Haiku is the lowest-cost model; images are downscaled before sending.",
  models: [
    { id: "claude-opus-4-8", label: "Opus 4.8 · most capable" },
    { id: "claude-sonnet-5", label: "Sonnet 5 · balanced" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5 · fast, low-cost" },
  ],
  defaultModel: "claude-opus-4-8",
  parseModel: "claude-haiku-4-5",   // query parsing is small/frequent — use the cheap tier

  async validate(config) {
    // a cheap authenticated GET; 200 => key is usable from this browser.
    let res;
    try {
      res = await fetch(`${ANTHROPIC_URL}/models?limit=1`, { headers: ANTHROPIC_HEADERS(config.apiKey) });
    } catch (err) {
      throw new Error(`Could not reach Anthropic: ${err?.message || err}`);
    }
    if (res.ok) return true;
    const msg = await errorMessage(res);
    if (res.status === 401) throw new Error("That API key was rejected (401). Check the key and try again.");
    throw new Error(msg || `Anthropic API error ${res.status}`);
  },

  async analyze(config, image) {
    const body = {
      model: resolveModel(this, config),
      max_tokens: 4096,
      system: ANALYSIS_INSTRUCTION,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: "Analyze this photo and return the scene description as JSON matching the required schema." },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: SCENE_SCHEMA } },
    };
    let res;
    try {
      res = await fetch(`${ANTHROPIC_URL}/messages`, {
        method: "POST", headers: ANTHROPIC_HEADERS(config.apiKey), body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Could not reach Anthropic: ${err?.message || err}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic API error ${res.status}`);
    if (data?.stop_reason === "refusal") throw new Error("The model declined to analyze this image.");
    const text = (data?.content || []).find((b) => b.type === "text")?.text;
    if (!text) throw new Error("No analysis was returned.");
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new Error("Could not parse the analysis response as JSON."); }
    return normalizeAnalysis(parsed);
  },

  // Alt text only: a plain-text completion, no schema, no object detection.
  async describe(config, image) {
    const body = {
      model: resolveModel(this, config),
      max_tokens: 300,
      system: ALT_TEXT_INSTRUCTION,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: "Write alt text for this photo." },
        ],
      }],
    };
    let res;
    try {
      res = await fetch(`${ANTHROPIC_URL}/messages`, {
        method: "POST", headers: ANTHROPIC_HEADERS(config.apiKey), body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Could not reach Anthropic: ${err?.message || err}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic API error ${res.status}`);
    if (data?.stop_reason === "refusal") throw new Error("The model declined to describe this image.");
    const text = (data?.content || []).find((b) => b.type === "text")?.text;
    if (!text) throw new Error("No alt text was returned.");
    return cleanAltText(text);
  },

  // Parse a search query into the shared query IR (schema-constrained JSON).
  async parseQuery(config, query, relations = []) {
    const body = {
      model: this.parseModel || resolveModel(this, config),
      max_tokens: 512,
      system: PARSE_INSTRUCTION + relationHint(relations),
      messages: [{ role: "user", content: [{ type: "text", text: `Parse this photo-search query as JSON matching the required schema: "${query}"` }] }],
      output_config: { format: { type: "json_schema", schema: QUERY_IR_SCHEMA } },
    };
    let res;
    try {
      res = await fetch(`${ANTHROPIC_URL}/messages`, { method: "POST", headers: ANTHROPIC_HEADERS(config.apiKey), body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(`Could not reach Anthropic: ${err?.message || err}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic API error ${res.status}`);
    if (data?.stop_reason === "refusal") throw new Error("The model declined to parse this query.");
    const text = (data?.content || []).find((b) => b.type === "text")?.text;
    if (!text) throw new Error("No parse was returned.");
    return JSON.parse(text);
  },

  // Rerank candidate photos by text relevance (optional third fusion signal).
  async rerankQuery(config, query, texts) {
    const body = {
      model: this.parseModel || resolveModel(this, config),
      max_tokens: 1024,
      system: RERANK_INSTRUCTION,
      messages: [{ role: "user", content: [{ type: "text", text: rerankPrompt(query, texts) }] }],
      output_config: { format: { type: "json_schema", schema: RERANK_SCHEMA } },
    };
    let res;
    try { res = await fetch(`${ANTHROPIC_URL}/messages`, { method: "POST", headers: ANTHROPIC_HEADERS(config.apiKey), body: JSON.stringify(body) }); }
    catch (err) { throw new Error(`Could not reach Anthropic: ${err?.message || err}`); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic API error ${res.status}`);
    const text = (data?.content || []).find((b) => b.type === "text")?.text;
    if (!text) throw new Error("No rerank was returned.");
    return JSON.parse(text);
  },
};

// ---------------------------------------------------------------------------
// Gemini (Google) adapter. Google AI Studio has a free tier (rate-limited); on
// that free tier Google may use submitted content to improve its models (the
// paid tier does not), which the connect UI surfaces. Uses the stable
// generateContent REST endpoint with responseMimeType:application/json to force
// JSON output, then reuses the same normalizeAnalysis + scene-graph writer.
// ---------------------------------------------------------------------------

// NOTE ON API CHOICE: this adapter uses the stable `generateContent` REST API,
// which Google still lists as fully supported. Google's newer "Interactions API"
// is the long-term direction, but as of mid-2026 it has already had one
// breaking-change cycle while generateContent has not, so it is the safer base
// today. If/when Interactions settles, swapping to it is contained to this
// adapter's validate()/analyze() (endpoint `.../v1beta2/interactions`, an
// `input[]` parts array, a `response_format`, and output under `steps[]` where
// type == "model_output"); the rest of the app is unaffected.
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta";
const geminiHeaders = (key) => ({ "content-type": "application/json", "x-goog-api-key": key });

const GEMINI_JSON_INSTRUCTION =
  "Analyze this photo and return ONLY a JSON object with this exact shape: " +
  '{"altText": string, "description": string, ' +
  '"objects": [{"key": string, "type": string, "label": string, "box": {"x": number, "y": number, "w": number, "h": number}}], ' +
  '"relations": [{"from": string, "to": string, "type": string}]}. ' +
  "altText is concise screen-reader text (about 125 characters, no 'image of' preamble). type is a general lowercase class noun. " +
  "key is a short unique id (o1, o2, and so on) referenced by relations. box is optional, given as fractions of the image in [0,1] with a top-left origin; omit it when unsure. " +
  "A relation's type is a spatial or semantic relation such as above, below, left of, holding, or part of. Only describe what is actually visible.";

const geminiProvider = {
  id: "gemini",
  label: "Gemini (Google)",
  keyLabel: "Google AI Studio API key",
  keyPlaceholder: "AIza…",
  keyHint: "Stored only in this browser, never uploaded.",
  keyUrl: "https://aistudio.google.com/apikey",
  billingNote: "Has a free tier (rate-limited). On the free tier, Google may use your images to improve its models; the paid tier does not. Images are downscaled before sending.",
  // gemini-flash-latest is a self-updating alias (points to the current stable
  // Flash), so the default does not rot as Google retires older versions for new
  // users. The pinned 3.x IDs are offered for reproducibility.
  models: [
    { id: "gemini-flash-latest", label: "Flash (latest, auto-updating)" },
    { id: "gemini-3.5-flash", label: "3.5 Flash · most capable" },
    { id: "gemini-3.1-flash-lite", label: "3.1 Flash-Lite · lowest cost" },
  ],
  defaultModel: "gemini-flash-latest",
  parseModel: "gemini-flash-latest",   // query parsing is small/frequent — use the fast tier

  async validate(config) {
    let res;
    try {
      res = await fetch(`${GEMINI_URL}/models?pageSize=1`, { headers: geminiHeaders(config.apiKey) });
    } catch (err) {
      throw new Error(`Could not reach Google: ${err?.message || err}`);
    }
    if (res.ok) return true;
    const msg = await errorMessage(res);
    if (res.status === 400 || res.status === 403) throw new Error(msg || "That API key was rejected. Check the key and try again.");
    throw new Error(msg || `Gemini API error ${res.status}`);
  },

  async analyze(config, image) {
    const model = resolveModel(this, config);
    const body = {
      systemInstruction: { parts: [{ text: ANALYSIS_INSTRUCTION }] },
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: image.mediaType, data: image.base64 } },
          { text: GEMINI_JSON_INSTRUCTION },
        ],
      }],
      generationConfig: { responseMimeType: "application/json" },
    };
    let res;
    try {
      res = await fetch(`${GEMINI_URL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: geminiHeaders(config.apiKey), body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Could not reach Google: ${err?.message || err}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
    if (data?.promptFeedback?.blockReason) throw new Error(`The request was blocked by Google (${data.promptFeedback.blockReason}).`);
    const cand = data?.candidates?.[0];
    const finish = cand?.finishReason;
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      throw new Error(`The model stopped without a usable answer (${finish}).`);
    }
    const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join("");
    if (!text) throw new Error("No analysis was returned.");
    let parsed;
    try { parsed = JSON.parse(text); }
    catch { throw new Error("Could not parse the analysis response as JSON."); }
    return normalizeAnalysis(parsed);
  },

  // Alt text only: a plain-text completion, no JSON, no object detection.
  async describe(config, image) {
    const model = resolveModel(this, config);
    const body = {
      systemInstruction: { parts: [{ text: ALT_TEXT_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: image.mediaType, data: image.base64 } }, { text: "Write alt text for this photo." }] }],
    };
    let res;
    try {
      res = await fetch(`${GEMINI_URL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: geminiHeaders(config.apiKey), body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Could not reach Google: ${err?.message || err}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
    if (data?.promptFeedback?.blockReason) throw new Error(`The request was blocked by Google (${data.promptFeedback.blockReason}).`);
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("");
    if (!text) throw new Error("No alt text was returned.");
    return cleanAltText(text);
  },

  // Parse a search query into the shared query IR. Mirrors analyze(): JSON via
  // responseMimeType with the shape described in the prompt (no responseSchema).
  async parseQuery(config, query, relations = []) {
    const model = this.parseModel || resolveModel(this, config);
    const body = {
      systemInstruction: { parts: [{ text: PARSE_INSTRUCTION + relationHint(relations) }] },
      contents: [{ role: "user", parts: [{ text: `Parse this photo-search query as JSON matching the described shape: "${query}"` }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    };
    let res;
    try {
      res = await fetch(`${GEMINI_URL}/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: geminiHeaders(config.apiKey), body: JSON.stringify(body) });
    } catch (err) {
      throw new Error(`Could not reach Google: ${err?.message || err}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
    if (data?.promptFeedback?.blockReason) throw new Error(`The request was blocked by Google (${data.promptFeedback.blockReason}).`);
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("");
    if (!text) throw new Error("No parse was returned.");
    return JSON.parse(text);
  },

  // Rerank candidate photos by text relevance (optional third fusion signal).
  async rerankQuery(config, query, texts) {
    const model = this.parseModel || resolveModel(this, config);
    const body = {
      systemInstruction: { parts: [{ text: RERANK_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: rerankPrompt(query, texts) }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    };
    let res;
    try { res = await fetch(`${GEMINI_URL}/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: geminiHeaders(config.apiKey), body: JSON.stringify(body) }); }
    catch (err) { throw new Error(`Could not reach Google: ${err?.message || err}`); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `Gemini API error ${res.status}`);
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join("");
    if (!text) throw new Error("No rerank was returned.");
    return JSON.parse(text);
  },
};

export const PROVIDERS = { claude: claudeProvider, gemini: geminiProvider };
export const DEFAULT_PROVIDER = "claude";

export function getProvider(config) {
  return PROVIDERS[config?.provider] || PROVIDERS[DEFAULT_PROVIDER];
}

// Resolve the model to send: the configured model if it is still a listed option
// for the provider, otherwise the provider's current default. This auto-heals a
// stored model id the provider has since retired (e.g. gemini-2.5-flash becoming
// unavailable to new users) without the user having to reconnect.
export function resolveModel(provider, config) {
  return provider.models.some((m) => m.id === config?.model) ? config.model : provider.defaultModel;
}

async function errorMessage(res) {
  try { const j = await res.json(); return j?.error?.message || null; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Normalization: coerce a provider's raw JSON into the app's analysis shape,
// dropping malformed objects/relations and clamping boxes into [0,1]. Exported
// for unit testing.
// ---------------------------------------------------------------------------
export function normalizeAnalysis(raw) {
  const objects = Array.isArray(raw?.objects) ? raw.objects : [];
  const nodes = objects
    .filter((o) => o && o.type)
    .map((o, i) => ({
      key: String(o.key || `o${i + 1}`),
      type: { id: String(o.type), label: String(o.type) },
      label: o.label ? String(o.label) : "",
      box: isBox(o.box)
        ? { x: clamp01(o.box.x), y: clamp01(o.box.y), w: clamp01(o.box.w), h: clamp01(o.box.h) }
        : null,
    }));
  const keys = new Set(nodes.map((n) => n.key));
  const relations = Array.isArray(raw?.relations) ? raw.relations : [];
  const edges = relations
    .filter((e) => e && e.type && keys.has(String(e.from)) && keys.has(String(e.to)) && String(e.from) !== String(e.to))
    .map((e) => ({ from: String(e.from), to: String(e.to), type: { id: String(e.type), label: String(e.type) } }));
  const altText = String(raw?.altText || raw?.description || "").trim();
  return { altText, description: String(raw?.description || "").trim(), nodes, edges };
}

function isBox(b) {
  return b && ["x", "y", "w", "h"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k]));
}

// Tidy a model's alt-text reply into one clean line: collapse whitespace and
// strip any surrounding quotes the model may have wrapped it in.
function cleanAltText(s) {
  return String(s || "").trim().replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

// ---------------------------------------------------------------------------
// Image preparation: fetch the photo's bytes from the PDS and downscale to a
// modest JPEG so payloads stay small and cheap. Returns { base64, mediaType }.
// ---------------------------------------------------------------------------
export async function preparePhotoImage(agent, did, blobRef, { maxEdge = 1400, quality = 0.85, onProgress } = {}) {
  onProgress?.("Loading photo from your PDS…");
  const src = await blobBytes(agent, did, blobRef);
  if (!src) throw new Error("Could not load the photo's image data.");
  const srcBlob = new Blob([src.bytes], { type: src.type });

  // downscale via canvas when the browser can decode it; otherwise send as-is.
  try {
    onProgress?.("Resizing image for the model…");
    const bitmap = await createImageBitmap(srcBlob);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (outBlob) return { base64: await blobToBase64(outBlob), mediaType: "image/jpeg" };
  } catch { /* fall through to sending the original bytes */ }

  // Fallback: the browser could not decode/resize the image. Only send it as-is
  // if its declared type is one the provider accepts and it is small enough to
  // POST directly; otherwise fail with an actionable message rather than sending
  // bytes under a mismatched media type or blowing the payload limit.
  const SUPPORTED = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const MAX_FALLBACK_BYTES = 3_500_000;   // ~5MB base64 ceiling, minus overhead
  if (!SUPPORTED.includes(src.type)) {
    throw new Error(`Unsupported image format for analysis: ${src.type || "unknown"}. Try a JPEG or PNG.`);
  }
  if (srcBlob.size > MAX_FALLBACK_BYTES) {
    throw new Error("This image couldn't be resized in the browser and is too large to send directly. Try a smaller or standard-format (JPEG/PNG) image.");
  }
  return { base64: await blobToBase64(srcBlob), mediaType: src.type };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result); const i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : s); };
    fr.onerror = () => reject(fr.error || new Error("Could not read image data."));
    fr.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Persistence: write an analysis result onto a photo (scene graph + alt text),
// matching the exact record shapes the manual scene editor uses.
// ---------------------------------------------------------------------------

// Remove any existing scene graph for a photo (the readers assume one graph per
// photo, so re-analysis replaces rather than accumulates).
export async function clearSceneGraph(agent, did, photoUri) {
  // Delete EVERY graph bound to this photo (not just the first), so a stray
  // second graph from a prior interrupted/concurrent run self-heals here.
  const graphs = (await listRecords(agent, did, NS.scene.graph)).filter((r) => r.value.subject === photoUri);
  if (!graphs.length) return;
  const graphUris = new Set(graphs.map((g) => g.uri));
  const uris = [];
  for (const n of (await listRecords(agent, did, NS.scene.node)).filter((r) => graphUris.has(r.value.scene))) uris.push(n.uri);
  for (const e of (await listRecords(agent, did, NS.scene.edge)).filter((r) => graphUris.has(r.value.scene))) uris.push(e.uri);
  for (const rg of (await listRecords(agent, did, NS.scene.region)).filter((r) => r.value.photo === photoUri)) uris.push(rg.uri);
  for (const g of graphs) uris.push(g.uri);
  for (const uri of uris) { try { await deleteRecord(agent, did, uri); } catch { /* best-effort cleanup */ } }
}

// Create graph -> regions -> nodes -> edges from a normalized analysis. Records
// are created sequentially because each cross-reference is a server-assigned
// AT-URI returned by the previous create. Provenance marks these as analysis.
export async function writeSceneGraph(agent, did, photoUri, analysis, { replace = true } = {}) {
  if (replace) await clearSceneGraph(agent, did, photoUri);
  const provenance = { source: "analysis", confidence: "likely", assertedAt: now() };
  const graphUri = await saveRecord(agent, did, NS.scene.graph, {
    subject: photoUri, ontologies: [], provenance, createdAt: now(),
  }, null);

  const nodeUriByKey = new Map();
  for (const n of analysis.nodes) {
    let regionUri;
    if (n.box) {
      // scene.region has no `provenance` field in its lexicon (unlike
      // graph/node/edge); match the manual editor's shapeToRegion shape exactly.
      regionUri = await saveRecord(agent, did, NS.scene.region, {
        photo: photoUri, kind: "bbox",
        bbox: { x: sc(n.box.x), y: sc(n.box.y), w: sc(n.box.w), h: sc(n.box.h) },
        createdAt: now(),
      }, null);
    }
    const nodeUri = await saveRecord(agent, did, NS.scene.node, {
      scene: graphUri, type: { id: n.type.id, label: n.type.label },
      label: n.label || undefined, region: regionUri || undefined,
      provenance, createdAt: now(),
    }, null);
    nodeUriByKey.set(n.key, nodeUri);
  }
  for (const e of analysis.edges) {
    const from = nodeUriByKey.get(e.from), to = nodeUriByKey.get(e.to);
    if (!from || !to) continue;
    await saveRecord(agent, did, NS.scene.edge, {
      scene: graphUri, type: { id: e.type.id, label: e.type.label }, from, to, provenance, createdAt: now(),
    }, null);
  }
  return graphUri;
}

// ---------------------------------------------------------------------------
// Top-level orchestration used by the gallery editor.
// ---------------------------------------------------------------------------

// Validate a candidate config against its provider (throws on failure).
export async function validateConfig(config) {
  const provider = PROVIDERS[config?.provider];
  if (!provider) throw new Error("Unknown provider.");
  if (!config.apiKey) throw new Error("Enter an API key.");
  return provider.validate(config);
}

// Run analysis on one photo's pixels and return the normalized result.
// onProgress(msg) reports PDS fetch, resize, and provider wait stages.
export async function analyzePhoto(agent, did, blobRef, config, { onProgress } = {}) {
  const provider = getProvider(config);
  const image = await preparePhotoImage(agent, did, blobRef, { onProgress });
  onProgress?.(`Sending image to ${provider.label}…`);
  return provider.analyze(config, image);
}

// Generate alt text only (no object detection / scene graph). Returns the alt
// text string. Throws if the configured provider does not support description.
export async function describePhoto(agent, did, blobRef, config, { onProgress } = {}) {
  const provider = getProvider(config);
  if (!provider.describe) throw new Error(`${provider.label} does not support alt-text generation.`);
  const image = await preparePhotoImage(agent, did, blobRef, { onProgress });
  onProgress?.(`Asking ${provider.label} for alt text…`);
  return provider.describe(config, image);
}

// Parse a natural-language search query into the shared query IR (raw, unvalidated
// — sceneSearch.validateIR checks/repairs it). Text-only; no image, no grounding.
export async function parseSearchQuery(query, config, { relations = [] } = {}) {
  const provider = getProvider(config);
  if (!provider.parseQuery) throw new Error(`${provider.label} does not support query parsing.`);
  return provider.parseQuery(config, query, relations);
}

// Rerank candidates ([{ uri, text }]) by text relevance -> Map<uri, grade[0,1]>.
// Empty map when the provider can't rerank; caller falls back to two-signal fusion.
export async function rerankSearch(query, config, candidates = []) {
  const provider = getProvider(config);
  const list = (candidates || []).slice(0, 30);
  if (!provider.rerankQuery || !list.length) return new Map();
  const raw = await provider.rerankQuery(config, query, list.map((c) => c.text || ""));
  const out = new Map();
  for (const s of raw?.scores || []) { const c = list[(Number(s.i) | 0) - 1]; if (c && Number.isFinite(s.rel)) out.set(c.uri, Math.max(0, Math.min(1, s.rel / 3))); }
  return out;
}

// Persist an analysis result onto a photo: alt text + scene graph. `photo` is
// the in-app { uri, cid, value } record; its cid is updated in place after the
// alt-text write so a subsequent re-render/save sees the fresh cid. Separated
// from analysis so a caller can interpose term grounding between the two.
export async function saveAnalysis(agent, did, photo, result) {
  if (result.altText) {
    const cid = await savePhotoAlt(agent, did, photo, result.altText);
    if (cid) photo.cid = cid;
  }
  await writeSceneGraph(agent, did, photo.uri, result);
  return result;
}

// Analyze one photo AND persist. `autoGround` silently links confident Wikidata
// matches (used for bulk, where an interactive disambiguation modal would block
// the batch); the per-photo path instead grounds interactively before saving.
export async function analyzeAndSave(agent, did, photo, config, { autoGround = false, onProgress } = {}) {
  if (!photo?.value) throw new Error("This photo has no image record to analyze.");
  let result = await analyzePhoto(agent, did, photo.value.photo, config, { onProgress });
  if (autoGround) {
    onProgress?.("Linking types to Wikidata…");
    result = await autoGroundAnalysis(result);
  }
  onProgress?.("Saving alt text and scene graph…");
  return saveAnalysis(agent, did, photo, result);
}
