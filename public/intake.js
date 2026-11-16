// Upload-first intake. Each piece is uploaded and saved as soon as its own photos are up,
// so closing the tab or losing the connection never costs a whole batch.
// No page access here: the caller supplies prepare (photo → {id, blob}), upload, save and knownPhoto.

export function planPieces(files, mode, makeId) {
  const label = f => String(f.name || '').replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'New piece';
  const groups = mode === 'angles' ? [files] : files.map(f => [f]);
  return groups.filter(g => g.length).map(g => ({id: makeId(), name: label(g[0]), files: g}));
}

export function createIntake({prepare, upload, save, knownPhoto = () => false, concurrency = 3, onChange = () => {}, now = Date.now}) {
  const state = {total: 0, saved: 0, skipped: 0, failed: [], pending: new Map(), active: new Map()};
  const queue = [], claimed = new Set();
  let running = 0, lock = Promise.resolve();
  // Photo preparation (HEIC conversion, resizing) is memory-heavy, so it runs one at a time while uploads overlap.
  const oneAtATime = fn => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

  async function work(piece) {
    const records = [];
    for (const [n, file] of piece.files.entries()) {
      state.active.set(piece.id, {step: 'preparing', photo: n + 1, of: piece.files.length});
      const r = await oneAtATime(() => prepare(file));
      if (!records.some(x => x.id === r.id)) records.push(r);
    }
    const first = records[0].id;
    if (claimed.has(first) || knownPhoto(first)) return 'skipped';
    claimed.add(first);
    try {
      state.active.set(piece.id, {step: 'uploading'});
      for (const r of records) await upload(r);
      await save({id: piece.id, name: piece.name, photos: records.map(r => r.id), category: '', status: 'available', intake: 'new', created: piece.created});
    } catch (e) { claimed.delete(first); throw e; }
    return 'saved';
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const piece = queue.shift();
      running++;
      work(piece).then(result => {
        state[result === 'saved' ? 'saved' : 'skipped']++;
        onChange({type: result, id: piece.id});
      }, error => {
        state.failed.push({piece, message: error?.message || 'This piece could not be uploaded.'});
        onChange({type: 'failed', id: piece.id});
      }).finally(() => {
        state.pending.delete(piece.id); state.active.delete(piece.id);
        running--; pump();
        if (!running && !queue.length) onChange({type: 'idle'});
      });
    }
  }

  const busy = () => running > 0 || queue.length > 0;
  return {
    state,
    busy,
    add(pieces) {
      if (!busy() && !state.failed.length) { state.total = 0; state.saved = 0; state.skipped = 0; }
      const base = now();
      pieces.forEach((p, i) => { p.created ??= base + i; state.pending.set(p.id, p); });
      state.total += pieces.length;
      queue.push(...pieces);
      onChange({type: 'start'});
      pump();
    },
    retry() {
      const again = state.failed.splice(0).map(f => f.piece);
      for (const p of again) state.pending.set(p.id, p);
      queue.push(...again);
      onChange({type: 'start'});
      pump();
    },
    progress() {
      const finished = state.saved + state.skipped + state.failed.length;
      return {total: state.total, finished, saved: state.saved, skipped: state.skipped, failed: state.failed.length, busy: busy()};
    },
    statusOf(id) {
      if (state.failed.some(f => f.piece.id === id)) return {step: 'failed', message: state.failed.find(f => f.piece.id === id).message};
      if (state.active.has(id)) return state.active.get(id);
      if (state.pending.has(id)) return {step: 'waiting'};
      return null;
    },
  };
}

// True when a piece's name is only a camera or file name ("IMG 0409", "PXL_2026…", "Screenshot 2026-11-01 at 10.32"), or empty.
export function genericName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (/^[0-9a-f]{8}[\s_-]?[0-9a-f]{4}/i.test(s)) return true;
  const rest = s.replace(/_/g, ' ')
    .replace(/\b(img|image|photo|pic|pxl|dsc|dscn|dcim|screenshot|screen shot|shopping|new piece|untitled|piece|copy|edited|at|am|pm)\b/gi, '')
    .replace(/\b[a-z](?=\d)/gi, '')
    .replace(/[\d\s_\-.:()]+/g, '');
  return !rest;
}

// Words that say what a piece is, or only its color or metal, but nothing that tells two of them apart.
const plainWords = new Set(('ring rings belt belts earring earrings necklace necklaces bracelet bracelets cuff cuffs arm ear watch clip clips hair hat cap scarf gloves '
  + 'bag bags purse shoe shoes boot boots heel heels top tops shirt sweater jacket coat bra skirt pants jeans shorts dress swimsuit '
  + 'makeup palette eyeliner lipstick lip powder eyeshadow piece item accessory jewelry thing '
  + 'silver gold black white brown red blue green pink purple yellow orange gray grey beige cream tan navy and a the my').split(' '));

// True when a name you typed is too plain for the stylist to tell pieces apart: "ring", "belt", "silver earrings", "arm cuff (big)".
export function vagueName(name) {
  const words = String(name || '').replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[\s/]+/).filter(Boolean);
  return words.length > 0 && words.length <= 3 && words.every(w => plainWords.has(w));
}

// Applies an AI description to a piece. AI rewrites the short name you see, the category, and the detailed
// description (with colors and, for makeup, shades) that only the AI reads. Nothing is locked; a note you added
// in brackets to the name, like "(pinky)", is kept.
const hex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : '';
const clean = (list, keys, max) => (Array.isArray(list) ? list : []).slice(0, max)
  .map(x => Object.fromEntries(keys.map(k => [k, k === 'hex' ? hex(x?.[k]) : String(x?.[k] ?? '').trim().slice(0, k === 'use' ? 160 : 60)])))
  .filter(x => x.name);
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
export function describedRecord(item, suggestion, {categories}) {
  const next = {...item}, filled = [];
  delete next.nameLocked; delete next.categoryLocked;
  const text = v => typeof v === 'string' ? v.trim() : '';
  const set = (k, v) => { if (!same(item[k], v)) { next[k] = v; filled.push(k); } };
  if (text(suggestion?.name)) {
    const note = genericName(item.name) ? '' : (String(item.name || '').match(/\([^)]*\)/g) || []).join(' ');
    set('name', (text(suggestion.name) + (note ? ' ' + note : '')).slice(0, 120));
  }
  if (categories.includes(suggestion?.category)) set('category', suggestion.category);
  const description = text(suggestion?.description).slice(0, 1200);
  if (description) set('aiDescription', description);
  const colors = clean(suggestion?.colors, ['name', 'hex'], 6);
  if (colors.length) set('colors', colors);
  const shades = clean(suggestion?.shades, ['name', 'hex', 'finish', 'type', 'use'], 40);
  if (next.category === 'Makeup' && shades.length) set('shades', shades);
  return {record: next, filled};
}
