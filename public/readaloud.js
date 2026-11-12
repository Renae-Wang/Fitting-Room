// Read-aloud timing: which written word is being spoken at a given moment.
// Pure functions only: no page access, no network.

const norm = w => String(w ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

// Splits text into words and the spaces between them, so it can be redrawn exactly with each word wrapped.
export function tokenize(text) {
  return String(text || '').split(/(\s+)/).filter(Boolean).map(t => ({t, word: /\S/.test(t)}));
}

const weight = w => Math.max(1, norm(w).length) + 1 + (/[.!?]["”’)]*$/.test(w) ? 5 : /[,;:—–]["”’)]*$/.test(w) ? 2.5 : 0);

// Spreads the audio's length over the words by length and punctuation pauses. Used when exact timings are missing.
export function estimateWords(words, duration) {
  if (!words.length || !(duration > 0)) return words.map(() => ({s: 0, e: 0}));
  const lead = Math.min(0.15, duration * 0.02), span = duration * 0.97 - lead;
  const w = words.map(weight), total = w.reduce((a, b) => a + b, 0);
  let t = lead;
  return w.map(x => { const s = t; t += (x / total) * span; return {s: +s.toFixed(3), e: +t.toFixed(3)}; });
}

// Matches the written words to the words heard in the audio, in order. Words that can't be matched
// (numbers read out, merged words) get times between their matched neighbours.
export function alignWords(words, spoken, duration) {
  if (!Array.isArray(spoken) || !spoken.length) return estimateWords(words, duration);
  const D = words.map(norm), S = spoken.map(x => ({n: norm(x.w), s: +x.s, e: +x.e}));
  const out = new Array(D.length).fill(null);
  const close = (a, b) => a && b && (a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))));
  let j = 0;
  for (let i = 0; i < D.length; i++) {
    for (let k = j; k < Math.min(S.length, j + 6); k++) {
      if (close(D[i], S[k].n)) { out[i] = {s: S[k].s, e: S[k].e}; j = k + 1; break; }
    }
  }
  if (!out.some(Boolean)) return estimateWords(words, duration);
  const end = Math.max(duration || 0, S.at(-1).e);
  for (let i = 0; i < out.length; i++) {
    if (out[i]) continue;
    let k = i; while (k < out.length && !out[k]) k++;
    const from = i > 0 ? out[i - 1].e : 0, to = k < out.length ? out[k].s : end;
    const gap = words.slice(i, k).map(weight), total = gap.reduce((a, b) => a + b, 0);
    let t = from;
    for (let m = i; m < k; m++) { const s = t; t += ((to - from) * gap[m - i]) / total; out[m] = {s: +s.toFixed(3), e: +t.toFixed(3)}; }
    i = k - 1;
  }
  return out;
}

// Index of the word being spoken at time t, or -1 before the first word and after the last.
export function wordAt(times, t) {
  if (!times.length || t < times[0].s) return -1;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid].s <= t) lo = mid; else hi = mid - 1; }
  const next = times[lo + 1];
  return t <= Math.max(times[lo].e, next ? next.s : times[lo].e) + 0.25 ? lo : -1;
}
