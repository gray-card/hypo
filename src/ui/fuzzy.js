// fuzzy.js: one fuzzy matcher used by every local search box in the app so
// behaviour is consistent. fzf-style subsequence matching with bonuses for
// consecutive characters and word starts, plus a big bonus for a literal
// substring so exact matches always rank first. Multi-word queries are matched
// token by token (each token must appear), so "nikon 50" finds
// "Nikon AF Nikkor 50mm f/1.8D".

const WORD_START = /[\s\-/._(,]/;

// score one whitespace-free token as a subsequence of `t` (already lowercased).
// returns a number, or null if the token's characters are not all present in order.
function tokenScore(token, t) {
  let ti = 0, score = 0, prev = -2;
  for (let i = 0; i < token.length; i++) {
    const j = t.indexOf(token[i], ti);
    if (j === -1) return null;
    let s = 1;
    if (j === prev + 1) s += 4;                        // consecutive run
    if (j === 0 || WORD_START.test(t[j - 1])) s += 5;  // start of a word
    score += s;
    prev = j;
    ti = j + 1;
  }
  return score;
}

// Fuzzy score of `query` against `target`. Higher is better; null means no match.
export function fuzzyScore(query, target) {
  const t = String(target).toLowerCase();
  const q = String(query).toLowerCase().trim();
  if (!q) return 0;

  let total = 0;
  const idx = t.indexOf(q);
  if (idx !== -1) total += 80 - idx * 0.2 + (idx === 0 ? 40 : 0); // literal-substring bonus

  for (const tok of q.split(/\s+/)) {
    const s = tokenScore(tok, t);
    if (s === null) return null;
    total += s;
  }
  return total - t.length * 0.02; // gentle nudge toward shorter targets on ties
}

// Filter + rank `items` by fuzzy match of `query` against keyFn(item).
export function fuzzyFilter(query, items, keyFn = (x) => x, limit = Infinity) {
  const q = String(query || "").trim();
  if (!q) return limit === Infinity ? items.slice() : items.slice(0, limit);
  const scored = [];
  for (const it of items) {
    const s = fuzzyScore(q, keyFn(it));
    if (s !== null) scored.push([s, it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = scored.map((x) => x[1]);
  return limit === Infinity ? out : out.slice(0, limit);
}

// Convenience predicate for row-based show/hide filters.
export function fuzzyMatches(query, target) {
  return fuzzyScore(query, target) !== null;
}
