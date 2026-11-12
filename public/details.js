// Outfit details: where each styling area sits in a portrait, and which pieces and notes belong to it.
// Pure functions only: no page access, no network and no paid calls.

const P = {nose: 0, eyeL: 2, eyeR: 5, earL: 7, earR: 8, mouthL: 9, mouthR: 10, shoulderL: 11, shoulderR: 12,
  wristL: 15, wristR: 16, pinkyL: 17, pinkyR: 18, indexL: 19, indexR: 20, thumbL: 21, thumbR: 22};
const SURE = 0.65, LIKELY = 0.5;

export const AREAS = {
  face: {title: 'Face, hair & ears', hint: 'Makeup, hair and earrings'},
  neck: {title: 'Neckline', hint: 'Necklaces'},
  hands: {title: 'Hands & wrists', hint: 'Rings, bracelets and watches'},
};
export const SPOT_LABELS = {face: 'Face, hair & ears', neck: 'Neckline', handL: 'Your left hand & wrist', handR: 'Your right hand & wrist'};
export const SPOT_AREA = {face: 'face', neck: 'neck', handL: 'hands', handR: 'hands'};

function clampBox({x, y, w, h}) {
  w = Math.min(1, w); h = Math.min(1, h);
  x = Math.min(Math.max(0, x), 1 - w); y = Math.min(Math.max(0, y), 1 - h);
  return {x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4)};
}

// Turns pose landmarks (normalized 0–1, with visibility) into boxes for the areas we can locate reliably.
// aspect is image width / height, so boxes keep their shape in pixels.
export function regionsFromPoints(points, aspect = 2 / 3) {
  if (!Array.isArray(points) || points.length < 23 || !(aspect > 0)) return {};
  const inFrame = p => p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const sure = (...ids) => ids.every(i => inFrame(points[i]) && points[i].v >= SURE);
  const at = i => ({x: points[i].x * aspect, y: points[i].y});
  const dist = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
  const box = (cx, cy, w, h) => clampBox({x: (cx - w / 2) / aspect, y: cy - h / 2, w: w / aspect, h});
  const out = {};
  const shoulders = sure(P.shoulderL, P.shoulderR) ? dist(P.shoulderL, P.shoulderR) : 0;

  if (sure(P.nose, P.eyeL, P.eyeR) && sure(P.mouthL, P.mouthR)) {
    const eyes = dist(P.eyeL, P.eyeR);
    const ears = sure(P.earL, P.earR) ? dist(P.earL, P.earR) : eyes * 2.1;
    const span = Math.max(ears, eyes * 2.1);
    const eyeY = (at(P.eyeL).y + at(P.eyeR).y) / 2, mouthY = (at(P.mouthL).y + at(P.mouthR).y) / 2;
    const cx = (at(P.eyeL).x + at(P.eyeR).x) / 2, w = span * 2.1, h = w * 1.3;
    if (span > 0.02 && mouthY > eyeY) out.face = box(cx, (eyeY + mouthY) / 2 - h * 0.08, w, h);
  }
  if (shoulders > 0.04 && sure(P.mouthL, P.mouthR)) {
    const mouthY = (at(P.mouthL).y + at(P.mouthR).y) / 2, shoulderY = (at(P.shoulderL).y + at(P.shoulderR).y) / 2;
    if (shoulderY > mouthY) {
      const top = mouthY + (shoulderY - mouthY) * 0.35, bottom = shoulderY + shoulders * 0.32;
      out.neck = box((at(P.shoulderL).x + at(P.shoulderR).x) / 2, (top + bottom) / 2, shoulders * 0.85, bottom - top);
    }
  }
  for (const [key, wrist, fingers] of [['handL', P.wristL, [P.pinkyL, P.indexL, P.thumbL]], ['handR', P.wristR, [P.pinkyR, P.indexR, P.thumbR]]]) {
    const seen = fingers.filter(i => inFrame(points[i]) && points[i].v >= LIKELY);
    if (!sure(wrist) || seen.length < 2) continue;
    const pts = [wrist, ...seen].map(at), xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const size = Math.max(extent * 2.2, shoulders * 0.5, 0.08);
    out[key] = box((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, size, size);
  }
  return out;
}

const text = item => [item.name, item.productType, item.attributes, item.silhouette, item.notes].filter(Boolean).join(' ').toLowerCase();
const FACE_ITEM = /\b(earrings?|ear ?cuffs?|studs?|hoops?|huggies|ear ?climbers?|hair ?(clips?|pins?|ties?|bands?)|barrettes?|scrunchies?|headbands?|claw ?clips?|bows?|sunglasses|glasses|hats?|caps?|beanies?|berets?)\b/;
const NECK_ITEM = /\b(necklaces?|chokers?|pendants?|chains?|lockets?|collars?|lariats?|torques?|beads?)\b/;
const HAND_ITEM = /\b(rings?|bracelets?|bangles?|cuffs?|watch(es)?|wristlets?|gloves?)\b/;

// Which area a closet piece belongs to, or null for clothing that isn't explored by area.
export function areaOf(item) {
  if (!item) return null;
  if (item.category === 'Makeup') return 'face';
  if (item.category !== 'Jewelry' && item.category !== 'Other Accessories') return null;
  const words = text(item);
  if (FACE_ITEM.test(words)) return 'face';
  if (NECK_ITEM.test(words)) return 'neck';
  if (HAND_ITEM.test(words)) return 'hands';
  return null;
}

const NOTE = {
  face: /\b(hair|bun|braid(s|ed)?|ponytail|part(ed|ing)?|curls?|waves?|slick(ed)?|fringe|bangs|earrings?|ears?|lobes?|hoops?|studs?)\b/i,
  neck: /\b(necklaces?|neckline|collar(bone)?s?|chains?|pendants?|chokers?|neck|décolletage)\b/i,
  hands: /\b(rings?|bracelets?|bangles?|watch(es)?|wrists?|hands?|cuffs?|nails?|manicure|knuckles?)\b/i,
};
export function sentences(value) {
  return String(value || '').split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

// The areas worth exploring for a look: each with its notes and the selected closet pieces that belong there.
export function lookAreas(look, items) {
  const chosen = (look?.itemIds || []).map(id => items.find(i => i.id === id)).filter(Boolean);
  const styling = sentences(look?.styling);
  return Object.keys(AREAS).map(key => {
    const notes = key === 'face' ? [...sentences(look?.makeup), ...styling.filter(s => NOTE.face.test(s))] : styling.filter(s => NOTE[key].test(s));
    return {key, ...AREAS[key], notes: [...new Set(notes)], items: chosen.filter(i => areaOf(i) === key)};
  }).filter(a => a.notes.length || a.items.length);
}

// Hotspots for the areas that have content and were located in this image.
export function spotsFor(areas, regions) {
  const keys = new Set(areas.map(a => a.key));
  return Object.entries(regions || {}).filter(([spot, box]) => box && keys.has(SPOT_AREA[spot]))
    .map(([spot, box]) => ({spot, area: SPOT_AREA[spot], label: SPOT_LABELS[spot], x: box.x + box.w / 2, y: box.y + box.h / 2, box}));
}

// Magnified crop of one box, drawn from the existing image with CSS: background size, position and the crop's shape.
export function cropStyle(box, aspect = 2 / 3) {
  const size = 100 / box.w;
  const px = box.w >= 1 ? 0 : (box.x / (1 - box.w)) * 100, py = box.h >= 1 ? 0 : (box.y / (1 - box.h)) * 100;
  return {size: size.toFixed(2) + '% auto', position: px.toFixed(2) + '% ' + py.toFixed(2) + '%', ratio: +((box.w * aspect) / box.h).toFixed(4)};
}

// Where an image drawn with object-fit: contain actually sits inside its frame, in pixels.
export function containRect(frameW, frameH, imageW, imageH) {
  if (!(frameW > 0 && frameH > 0 && imageW > 0 && imageH > 0)) return {left: 0, top: 0, width: frameW || 0, height: frameH || 0};
  const scale = Math.min(frameW / imageW, frameH / imageH), width = imageW * scale, height = imageH * scale;
  return {left: (frameW - width) / 2, top: (frameH - height) / 2, width, height};
}
