// tokenizerModel.js — load the shipped learned-phrase list and hand it to
// makeTokenizer() in src/sceneSearch.js so BM25 indexing and querying merge the
// same multiword units the caption-IDF df table was built with.
//
// The asset (tokenizer-model.json) is NPMI-selected phrase strings + aggregate
// counts derived from a large, permissively-licensed caption corpus (see
// scripts/build-tokenizer.mjs); it holds NO verbatim captions. It is
// dynamic-imported so it code-splits, and a missing/empty asset degrades cleanly
// to the base tokenizer (normalize+stem) — search still works fully offline.

let cached;   // undefined = not tried; null = unavailable; array = phrase list

// Returns the phrases array (underscore-joined stemmed tokens) or null.
export async function loadPhraseModel() {
  if (cached !== undefined) return cached;
  try {
    const m = await import("./tokenizer-model.json");
    const model = m.default || m;
    cached = Array.isArray(model?.phrases) && model.phrases.length ? model.phrases : null;
  } catch {
    cached = null;
  }
  return cached;
}
