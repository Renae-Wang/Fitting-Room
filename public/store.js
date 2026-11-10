// Private records live in Supabase (table "records"); photos live in the private "photos" bucket.
// Everything is loaded once on sign-in and kept in memory, so screens read instantly and writes go straight to Supabase.
import {client} from './supabase.js';

const tables = ['items', 'refs', 'looks', 'settings'];
const bucket = 'photos';
const week = 60 * 60 * 24 * 7;
let uid = '', cache = null;
const path = id => uid + '/' + id;

export async function openStore() {
  const {data: {session}} = await client.auth.getSession();
  if (!session) throw Error('Sign in to open your closet.');
  uid = session.user.id;
  cache = Object.fromEntries([...tables, 'assets'].map(name => [name, new Map()]));
  for (let from = 0; ; from += 1000) {
    const {data, error} = await client.from('records').select('store,id,data').order('store').order('id').range(from, from + 999);
    if (error) throw Error('Your closet could not be loaded. Check your connection and reload.');
    for (const row of data) cache[row.store]?.set(row.id, row.data);
    if (data.length < 1000) break;
  }
  const names = [];
  for (let offset = 0; ; offset += 1000) {
    const {data, error} = await client.storage.from(bucket).list(uid, {limit: 1000, offset});
    if (error) throw Error('Your photos could not be loaded. Check your connection and reload.');
    names.push(...data.map(f => f.name).filter(n => !n.startsWith('.')));
    if (data.length < 1000) break;
  }
  for (let i = 0; i < names.length; i += 500) {
    const {data, error} = await client.storage.from(bucket).createSignedUrls(names.slice(i, i + 500).map(path), week);
    if (error) throw Error('Your photos could not be loaded. Check your connection and reload.');
    data.forEach((row, n) => row.signedUrl && cache.assets.set(names[i + n], {id: names[i + n], url: row.signedUrl}));
  }
}

export async function all(name) {
  return name === 'assets' ? [...cache.assets.values()] : [...cache[name].values()].map(row => ({...row}));
}

export async function assetBlob(id) {
  const record = cache.assets.get(id);
  if (!record) throw Error('A source image is missing. Re-upload it before continuing.');
  if (!record.blob) {
    const resp = await fetch(record.url).catch(() => null);
    if (!resp?.ok) throw Error('A photo could not be downloaded. Check your connection and retry.');
    record.blob = await resp.blob();
  }
  return record.blob;
}

// Applies changes in order: new photos first, then record saves, then removals.
export async function batch(changes) {
  const uploads = changes.filter(c => c.store === 'assets' && !c.remove && !cache.assets.has(c.record.id));
  for (const {record} of uploads) {
    const {error} = await client.storage.from(bucket).upload(path(record.id), record.blob, {contentType: record.blob.type, upsert: false});
    if (error && !/exist|duplicate/i.test(error.message)) throw Error('A photo could not be uploaded. Check your connection and try again.');
    cache.assets.set(record.id, {id: record.id, blob: record.blob, url: URL.createObjectURL(record.blob)});
  }
  const rows = new Map();
  for (const c of changes) if (c.store !== 'assets' && !c.remove) rows.set(c.store + '/' + c.record.id, {user_id: uid, store: c.store, id: c.record.id, data: c.record, updated_at: new Date().toISOString()});
  if (rows.size) {
    const {error} = await client.from('records').upsert([...rows.values()]);
    if (error) throw Error('Your changes could not be saved. Check your connection and try again.');
    for (const row of rows.values()) cache[row.store].set(row.id, structuredClone(row.data));
  }
  for (const c of changes.filter(c => c.remove)) {
    if (c.store === 'assets') { await dropAssets([c.remove]); continue; }
    const {error} = await client.from('records').delete().match({user_id: uid, store: c.store, id: c.remove});
    if (error) throw Error('This could not be deleted. Check your connection and try again.');
    cache[c.store].delete(c.remove);
  }
}
export const put = (store, record) => batch([{store, record}]);
export const remove = (store, id) => batch([{store, remove: id}]);

async function dropAssets(ids) {
  if (!ids.length) return;
  const {error} = await client.storage.from(bucket).remove(ids.map(path));
  if (error) throw Error('Unused photos could not be removed. They will be cleaned up next time.');
  for (const id of ids) {
    const url = cache.assets.get(id)?.url;
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    cache.assets.delete(id);
  }
}
// Removes photos that no closet piece or appearance reference uses any more.
export async function collectAssets() {
  const used = new Set();
  for (const row of cache.refs.values()) used.add(row.photo);
  for (const row of cache.items.values()) for (const id of row.photos || []) used.add(id);
  await dropAssets([...cache.assets.keys()].filter(id => !used.has(id))).catch(() => {});
}

// ---- Photo intake: JPEG, PNG, WebP, AVIF, GIF and HEIC/HEIF (iPhone) ----
const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const isHeic = file => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
const maxEdge = 2048;

export async function photoRecord(file) {
  const heic = isHeic(file);
  if (!heic && !types.includes(file.type)) throw Error('Choose a JPEG, PNG, WebP, AVIF, GIF or HEIC photo.');
  if (file.size > 32 * 1024 * 1024) throw Error('Use an image under 32 MB.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const id = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  let blob = heic ? await heicSource(file) : file;
  let image;
  try { image = await createImageBitmap(blob); } catch { throw Error('This photo could not be read. Export it as JPEG and try again.'); }
  try {
    if (heic || Math.max(image.width, image.height) > maxEdge) blob = await encode(image, maxEdge, file.type === 'image/png' ? 'image/png' : 'image/jpeg');
  } finally { image.close(); }
  return {id, blob};
}

async function encode(image, max, type) {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const out = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
  if (!out) throw Error('This photo could not be prepared. Export it as JPEG and try again.');
  return out;
}

// Safari reads HEIC natively. Other browsers convert it in an isolated, sandboxed frame.
async function heicSource(file) {
  try { (await createImageBitmap(file)).close(); return file; } catch {}
  const frame = await converter();
  const buffer = await file.arrayBuffer(), id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { done(); reject(Error('HEIC conversion took too long. Export the photo as JPEG and try again.')); }, 90000);
    function done() { clearTimeout(timer); removeEventListener('message', reply); }
    function reply(e) {
      if (e.source !== frame.contentWindow || e.data?.id !== id) return;
      done();
      if (e.data.jpeg) resolve(new Blob([e.data.jpeg], {type: 'image/jpeg'}));
      else reject(Error('This HEIC photo could not be converted. Export it as JPEG and try again.'));
    }
    addEventListener('message', reply);
    frame.contentWindow.postMessage({id, buffer}, '*', [buffer]);
  });
}
let frameReady;
function converter() {
  frameReady ??= new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = new URL('heic.html', import.meta.url).href;
    const timer = setTimeout(() => { removeEventListener('message', ready); frame.remove(); reject(Error('The HEIC converter did not load. Export the photo as JPEG and try again.')); }, 30000);
    function ready(e) { if (e.source === frame.contentWindow && e.data === 'heic-ready') { clearTimeout(timer); removeEventListener('message', ready); resolve(frame); } }
    addEventListener('message', ready);
    document.body.append(frame);
  });
  frameReady.catch(() => { frameReady = null; });
  return frameReady;
}

export async function referenceJPEG(blob, max = 1024) {
  if (!blob) throw Error('A source image is missing. Re-upload it before continuing.');
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, max / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .82);
  } finally { image.close(); }
}
