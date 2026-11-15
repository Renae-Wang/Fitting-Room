import test from 'node:test';
import assert from 'node:assert/strict';
import {genericName, describedRecord} from '../public/intake.js';

test('file and camera names count as unnamed; names you typed do not', () => {
  for (const n of ['', '  ', 'IMG 0409', 'IMG_0409', 'IMG 0409 2', 'IMG E0409', 'PXL 20261101 103211', 'DSC 1234', 'Screenshot 2026-11-01 at 10.32.11 AM', 'image (3)', 'New piece', '5F3A2B1C-9D4E-4F11', '0409'])
    assert.equal(genericName(n), true, n);
  for (const n of ['ring', 'belt', 'doc martins', 'Semi see through green top', 'IMG 0409 red skirt', 'ring (pinky)', 'arm cuff (big)', 'vans checkered slip ons'])
    assert.equal(genericName(n), false, n);
});

test('a description fills only what is missing', () => {
  const opts = {categories: ['Tops', 'Bottoms'], fields: ['color', 'material', 'notes']};
  const s = {name: 'cream crinkle cap-sleeve blouse', category: 'Tops', color: 'cream', material: 'cotton', notes: ''};
  const a = describedRecord({id: 'a', name: 'IMG 0409', category: '', color: '', photos: ['p']}, s, opts);
  assert.equal(a.record.name, s.name); assert.equal(a.record.category, 'Tops'); assert.equal(a.record.color, 'cream');
  assert.deepEqual(a.filled, ['name', 'category', 'color', 'material']);
  const b = describedRecord({id: 'b', name: 'doc martins', category: 'Bottoms', color: 'black'}, s, opts);
  assert.equal(b.record.name, 'doc martins'); assert.equal(b.record.category, 'Bottoms'); assert.equal(b.record.color, 'black');
  assert.deepEqual(b.filled, ['material']);
  const c = describedRecord({id: 'c', name: 'IMG 1', category: ''}, {name: 'x', category: 'Hats'}, opts);
  assert.equal(c.record.category, '', 'unknown categories are ignored');
});
