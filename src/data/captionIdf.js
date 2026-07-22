// captionIdf.js — load the shipped image-caption document-frequency table and
// build a BM25 idf(term) lookup for src/sceneSearch.js bm25Search.
//
// The asset (caption-idf.json) is aggregate df counts + N/avgdl derived from a
// large, permissively-licensed caption corpus (see scripts/build-caption-idf.mjs);
// it holds NO verbatim captions. It is dynamic-imported so it code-splits and a
// missing/empty/placeholder asset degrades cleanly to per-profile IDF — search
// still works fully offline.

let cached;   // undefined = not tried; null = unavailable; function = idf lookup

// Build idf(term) from a { N, dfFloor, df } table. Out-of-vocabulary terms get
// the IDF of the least-frequent kept term (high but bounded), so a rare query
// word is not silently treated as ubiquitous.
export function buildIdfLookup(table) {
  if (!table || !table.N) return null;
  const N = table.N;
  const df = table.df instanceof Map ? table.df : new Map(Object.entries(table.df || {}));
  const idfOf = (d) => Math.log(1 + (N - d + 0.5) / (d + 0.5));
  const defaultIdf = idfOf(Math.max(1, table.dfFloor || 1));
  return (term) => { const d = df.get(term); return d ? idfOf(d) : defaultIdf; };
}

export async function loadCaptionIdf() {
  if (cached !== undefined) return cached;
  try {
    const m = await import("./caption-idf.json");
    cached = buildIdfLookup(m.default || m);
  } catch {
    cached = null;
  }
  return cached;
}
