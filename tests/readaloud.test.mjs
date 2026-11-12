import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokenize, alignWords, estimateWords, wordAt} from '../public/readaloud.js';

const words = text => tokenize(text).filter(t => t.word).map(t => t.t);

test('tokenize keeps the exact text, with words and spaces separated', () => {
  const text = 'Tuck the knit.\n\nBlot  once.';
  const toks = tokenize(text);
  assert.equal(toks.map(t => t.t).join(''), text);
  assert.deepEqual(words(text), ['Tuck', 'the', 'knit.', 'Blot', 'once.']);
});

test('timings follow the spoken words, ignoring punctuation and case', () => {
  const w = words('Tuck the knit, then blot.');
  const spoken = [{w: 'tuck', s: 0.1, e: 0.3}, {w: 'the', s: 0.3, e: 0.4}, {w: 'knit', s: 0.4, e: 0.8}, {w: 'then', s: 1.0, e: 1.2}, {w: 'blot', s: 1.2, e: 1.6}];
  const t = alignWords(w, spoken, 1.8);
  assert.deepEqual(t.map(x => x.s), [0.1, 0.3, 0.4, 1.0, 1.2]);
});

test('words that are read differently get times between their neighbours', () => {
  const w = words('Wear 3 rings today.');
  const spoken = [{w: 'Wear', s: 0, e: 0.3}, {w: 'three', s: 0.3, e: 0.6}, {w: 'rings', s: 0.6, e: 1.0}, {w: 'today', s: 1.0, e: 1.4}];
  const t = alignWords(w, spoken, 1.5);
  assert.equal(t[0].s, 0); assert.equal(t[2].s, 0.6); assert.equal(t[3].s, 1.0);
  assert.ok(t[1].s >= 0.3 && t[1].e <= 0.6 + 1e-9, 'the unmatched "3" sits in the gap');
  for (let i = 1; i < t.length; i++) assert.ok(t[i].s >= t[i - 1].s, 'times never go backwards');
});

test('without timings, words are spread over the audio by length and pauses', () => {
  const w = words('Hi. A longer sentence follows here.');
  const t = estimateWords(w, 4);
  assert.equal(t.length, w.length);
  assert.ok(t[0].s > 0 && t.at(-1).e <= 4);
  assert.ok(t[1].s - t[0].e < 0.001, 'contiguous');
  assert.ok((t[0].e - t[0].s) > (t[1].e - t[1].s), 'a sentence end holds longer than a short word');
  assert.deepEqual(alignWords(w, null, 4), t, 'missing timings fall back to the estimate');
  assert.deepEqual(alignWords(w, [{w: 'zzz', s: 0, e: 1}], 4), t, 'unusable timings fall back too');
});

test('wordAt finds the spoken word, and nothing before or after', () => {
  const t = [{s: 0.2, e: 0.5}, {s: 0.6, e: 0.9}, {s: 1.4, e: 1.8}];
  assert.equal(wordAt(t, 0.1), -1);
  assert.equal(wordAt(t, 0.3), 0);
  assert.equal(wordAt(t, 0.55), 0, 'holds through the short gap');
  assert.equal(wordAt(t, 0.7), 1);
  assert.equal(wordAt(t, 1.5), 2);
  assert.equal(wordAt(t, 2.5), -1);
  assert.equal(wordAt([], 1), -1);
});
