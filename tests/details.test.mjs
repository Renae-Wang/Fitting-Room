import {test} from 'node:test';
import assert from 'node:assert/strict';
import {regionsFromPoints, areaOf, lookAreas, spotsFor, cropStyle, containRect, sentences} from '../public/details.js';

// A front-facing standing pose in normalized coordinates (BlazePose 33-point order).
function pose(overrides = {}) {
  const p = Array.from({length: 33}, () => ({x: 0.5, y: 0.5, v: 0.99}));
  const set = (i, x, y, v = 0.99) => { p[i] = {x, y, v}; };
  set(0, 0.5, 0.12); set(2, 0.47, 0.105); set(5, 0.53, 0.105); set(7, 0.44, 0.115); set(8, 0.56, 0.115);
  set(9, 0.48, 0.145); set(10, 0.52, 0.145); set(11, 0.4, 0.22); set(12, 0.6, 0.22);
  set(15, 0.33, 0.5); set(16, 0.67, 0.5); set(17, 0.32, 0.53); set(18, 0.68, 0.53);
  set(19, 0.33, 0.54); set(20, 0.67, 0.54); set(21, 0.34, 0.52); set(22, 0.66, 0.52);
  for (const [i, v] of Object.entries(overrides)) p[i] = {...p[i], ...v};
  return p;
}
const inside = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

test('regions cover the face with ears, the neckline and each visible hand', () => {
  const r = regionsFromPoints(pose(), 2 / 3);
  assert.deepEqual(Object.keys(r).sort(), ['face', 'handL', 'handR', 'neck']);
  assert.ok(inside(r.face, 0.44, 0.115) && inside(r.face, 0.56, 0.115) && inside(r.face, 0.5, 0.145), 'face box holds ears and mouth');
  assert.ok(inside(r.neck, 0.5, 0.2), 'neck box sits between chin and shoulders');
  assert.ok(inside(r.handL, 0.33, 0.5) && inside(r.handR, 0.67, 0.5), 'hand boxes hold the wrists');
  for (const b of Object.values(r)) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, 'boxes stay inside the image');
});

test('areas that cannot be located reliably are left out', () => {
  const hidden = regionsFromPoints(pose({15: {v: 0.2}, 17: {v: 0.1}}), 2 / 3);
  assert.ok(!hidden.handL && hidden.handR, 'an occluded hand gets no box');
  const offFrame = regionsFromPoints(pose({0: {y: -0.05}}), 2 / 3);
  assert.ok(!offFrame.face, 'a face outside the frame gets no box');
  assert.deepEqual(regionsFromPoints([], 2 / 3), {});
  assert.deepEqual(regionsFromPoints(null), {});
});

test('closet pieces map to the face, neckline or hands', () => {
  assert.equal(areaOf({category: 'Makeup', name: 'Oxblood lip stain'}), 'face');
  assert.equal(areaOf({category: 'Jewelry', name: 'Gold hoop earrings'}), 'face');
  assert.equal(areaOf({category: 'Jewelry', name: 'Layered chain necklace'}), 'neck');
  assert.equal(areaOf({category: 'Jewelry', name: 'Signet ring'}), 'hands');
  assert.equal(areaOf({category: 'Other Accessories', name: 'Leather watch'}), 'hands');
  assert.equal(areaOf({category: 'Other Accessories', name: 'Claw clip'}), 'face');
  assert.equal(areaOf({category: 'Tops', name: 'Chain-strap top'}), null, 'clothing is not explored by area');
  assert.equal(areaOf({category: 'Bags', name: 'Ring-handle bag'}), null);
});

test('look areas gather notes and selected pieces, and skip empty areas', () => {
  const items = [
    {id: 'lip', category: 'Makeup', name: 'Oxblood lip stain'},
    {id: 'hoops', category: 'Jewelry', name: 'Gold hoops'},
    {id: 'ring', category: 'Jewelry', name: 'Signet ring'},
    {id: 'top', category: 'Tops', name: 'Knit'},
  ];
  const look = {itemIds: ['lip', 'hoops', 'ring', 'top'], makeup: 'Blot the stain. Keep brows brushed up.',
    styling: 'Slick hair behind the ears to show the hoops. Stack the ring on your index finger. Tuck the knit.'};
  const areas = lookAreas(look, items);
  assert.deepEqual(areas.map(a => a.key), ['face', 'hands'], 'no neckline without a necklace or neckline note');
  const face = areas.find(a => a.key === 'face');
  assert.deepEqual(face.items.map(i => i.id), ['lip', 'hoops']);
  assert.ok(face.notes.includes('Blot the stain.') && face.notes.some(n => n.startsWith('Slick hair')));
  assert.deepEqual(areas.find(a => a.key === 'hands').items.map(i => i.id), ['ring']);
  assert.ok(!face.notes.includes('Tuck the knit.'));
  assert.deepEqual(lookAreas({itemIds: [], makeup: '', styling: ''}, items), []);
});

test('hotspots appear only for located areas that have content', () => {
  const areas = [{key: 'face'}, {key: 'hands'}];
  const regions = regionsFromPoints(pose(), 2 / 3);
  const spots = spotsFor(areas, regions);
  assert.deepEqual(spots.map(s => s.spot).sort(), ['face', 'handL', 'handR']);
  const face = spots.find(s => s.spot === 'face');
  assert.ok(Math.abs(face.x - (regions.face.x + regions.face.w / 2)) < 1e-9);
  assert.deepEqual(spotsFor(areas, undefined), [], 'older looks without hotspot data get no markers');
});

test('crops magnify exactly the box, and markers follow the letterboxed image', () => {
  const c = cropStyle({x: 0.25, y: 0.5, w: 0.5, h: 0.25}, 2 / 3);
  assert.equal(c.size, '200.00% auto');
  assert.equal(c.position, '50.00% 66.67%');
  assert.equal(c.ratio, +(0.5 * (2 / 3) / 0.25).toFixed(4));
  assert.deepEqual(containRect(600, 600, 1024, 1536), {left: 100, top: 0, width: 400, height: 600}, 'tall image in a square frame');
  assert.deepEqual(containRect(400, 900, 1024, 1536), {left: 0, top: 150, width: 400, height: 600}, 'tall image in a narrow frame');
});

test('notes split into sentences', () => {
  assert.deepEqual(sentences('One. Two!\nThree?'), ['One.', 'Two!', 'Three?']);
  assert.deepEqual(sentences(undefined), []);
});
