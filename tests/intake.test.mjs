import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planPieces, createIntake} from '../public/intake.js';

const tick = (ms = 1) => new Promise(r => setTimeout(r, ms));
function rig({failUpload = () => false, known = new Set(), delay = 3} = {}) {
  const log = [], saved = [];
  let preparing = 0, maxPreparing = 0, uploading = 0, maxUploading = 0;
  const intake = createIntake({
    prepare: async f => { preparing++; maxPreparing = Math.max(maxPreparing, preparing); await tick(delay); preparing--; log.push('prep ' + f.name); return {id: f.hash, blob: f}; },
    upload: async r => { uploading++; maxUploading = Math.max(maxUploading, uploading); await tick(delay * 2); uploading--; if (failUpload(r)) throw Error('Network down'); log.push('up ' + r.id); },
    save: async rec => { saved.push(rec); log.push('save ' + rec.name); },
    knownPhoto: id => known.has(id),
    concurrency: 3, now: () => 1000,
  });
  const idle = () => new Promise(resolve => { const t = setInterval(() => { if (!intake.busy()) { clearInterval(t); resolve(); } }, 2); });
  return {intake, log, saved, idle, max: () => ({maxPreparing, maxUploading})};
}
const files = n => Array.from({length: n}, (_, i) => ({name: `IMG_${i + 1}.HEIC`, hash: 'h' + (i + 1)}));
let n = 0; const id = () => 'p' + (++n);

test('plans one piece per photo, or one piece with several angles', () => {
  const f = files(3);
  assert.deepEqual(planPieces(f, 'separate', id).map(p => [p.name, p.files.length]), [['IMG 1', 1], ['IMG 2', 1], ['IMG 3', 1]]);
  const one = planPieces(f, 'angles', id);
  assert.equal(one.length, 1); assert.equal(one[0].files.length, 3);
  assert.deepEqual(planPieces([], 'separate', id), []);
});

test('uploads overlap, preparation runs one at a time, and every piece is saved as unreviewed', async () => {
  const r = rig();
  const pieces = planPieces(files(8), 'separate', id);
  r.intake.add(pieces);
  await r.idle();
  assert.equal(r.saved.length, 8);
  assert.ok(r.saved.every(s => s.intake === 'new' && s.category === '' && s.photos.length === 1));
  assert.deepEqual(r.saved.map(s => s.created).sort(), pieces.map((_, i) => 1000 + i), 'created keeps upload order');
  assert.equal(r.max().maxPreparing, 1, 'one photo prepared at a time');
  assert.ok(r.max().maxUploading > 1 && r.max().maxUploading <= 3, 'uploads overlap, up to three');
  assert.deepEqual(r.intake.progress(), {total: 8, finished: 8, saved: 8, skipped: 0, failed: 0, busy: false});
});

test('pieces are saved as they finish, not at the end of the batch', async () => {
  const r = rig();
  r.intake.add(planPieces(files(9), 'separate', id));
  await r.idle();
  const firstSave = r.log.findIndex(l => l.startsWith('save')), lastPrep = r.log.findLastIndex(l => l.startsWith('prep'));
  assert.ok(firstSave < lastPrep, 'the first piece is saved before the last photo is prepared');
});

test('photos already in the closet, or repeated in the batch, are skipped', async () => {
  const r = rig({known: new Set(['h2'])});
  const f = files(3); f.push({name: 'copy.jpg', hash: 'h1'});
  r.intake.add(planPieces(f, 'separate', id));
  await r.idle();
  assert.deepEqual(r.saved.map(s => s.photos[0]).sort(), ['h1', 'h3']);
  assert.equal(r.intake.progress().skipped, 2);
});

test('a failed piece does not stop the others, and Retry finishes it', async () => {
  let down = true;
  const r = rig({failUpload: rec => down && rec.id === 'h2'});
  const pieces = planPieces(files(4), 'separate', id);
  r.intake.add(pieces);
  await r.idle();
  assert.equal(r.saved.length, 3);
  const p = r.intake.progress();
  assert.equal(p.failed, 1); assert.equal(p.finished, 4);
  assert.equal(r.intake.statusOf(pieces[1].id).step, 'failed');
  down = false; r.intake.retry();
  assert.notEqual(r.intake.statusOf(pieces[1].id).step, 'failed', 'retrying starts the piece again');
  await r.idle();
  assert.equal(r.saved.length, 4);
  assert.deepEqual(r.intake.progress(), {total: 4, finished: 4, saved: 4, skipped: 0, failed: 0, busy: false});
  assert.equal(r.intake.statusOf(pieces[1].id), null);
});

test('a new batch after a finished one starts its count fresh', async () => {
  const r = rig();
  r.intake.add(planPieces(files(2), 'separate', id)); await r.idle();
  r.intake.add(planPieces([{name: 'x.jpg', hash: 'hx'}], 'separate', id));
  assert.equal(r.intake.progress().total, 1);
  await r.idle();
});
