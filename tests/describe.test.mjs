import test from 'node:test';
import assert from 'node:assert/strict';
import {genericName, describedRecord} from '../public/intake.js';

test('file and camera names count as unnamed; names you typed do not', () => {
  for (const n of ['', '  ', 'IMG 0409', 'IMG_0409', 'IMG 0409 2', 'IMG E0409', 'PXL 20261101 103211', 'DSC 1234', 'Screenshot 2026-11-01 at 10.32.11 AM', 'image (3)', 'New piece', '5F3A2B1C-9D4E-4F11', '0409'])
    assert.equal(genericName(n), true, n);
  for (const n of ['ring', 'belt', 'doc martins', 'Semi see through green top', 'IMG 0409 red skirt', 'ring (pinky)', 'arm cuff (big)', 'vans checkered slip ons'])
    assert.equal(genericName(n), false, n);
});

test('AI rewrites the name, category and detailed description from the photo; nothing is locked', () => {
  const opts = {categories: ['Tops', 'Bottoms', 'Makeup']};
  const s = {name: 'cream crinkle cap-sleeve blouse', category: 'Tops', description: 'Cream crinkled cotton blouse, cap sleeves, ends at the high hip.', colors: [{name: 'cream', hex: '#f3ead8'}, {name: 'bad', hex: 'cream'}], shades: [{name: 'x', hex: '#000000', finish: '', type: '', use: ''}]};
  const a = describedRecord({id: 'a', name: 'IMG 0409', category: '', photos: ['p']}, s, opts);
  assert.equal(a.record.name, s.name); assert.equal(a.record.category, 'Tops'); assert.equal(a.record.aiDescription, s.description);
  assert.deepEqual(a.record.colors, [{name: 'cream', hex: '#F3EAD8'}, {name: 'bad', hex: ''}], 'hex codes are checked');
  assert.equal(a.record.shades, undefined, 'shades are for makeup only');
  assert.deepEqual(a.filled, ['name', 'category', 'aiDescription', 'colors']);
  const b = describedRecord({id: 'b', name: 'doc martins', nameLocked: true, category: 'Bottoms', categoryLocked: true, aiDescription: 'old'}, s, opts);
  assert.equal(b.record.name, s.name, 'a typed name is rewritten too');
  assert.equal(b.record.category, 'Tops', 'and the category');
  assert.equal(b.record.aiDescription, s.description, 'and the detailed description');
  assert.ok(!('nameLocked' in b.record) && !('categoryLocked' in b.record), 'old locks are cleared');
  assert.equal(describedRecord({id: 'p', name: 'ring (pinky)', category: 'Tops'}, s, opts).record.name, 'cream crinkle cap-sleeve blouse (pinky)', 'a note in brackets is kept');
  assert.deepEqual(describedRecord({id: 's', name: s.name, category: 'Tops', aiDescription: s.description, colors: [{name: 'cream', hex: '#F3EAD8'}, {name: 'bad', hex: ''}]}, s, opts).filled, [], 'nothing changed, nothing reported');
  const m = describedRecord({id: 'm', name: 'makeup palette', category: 'Makeup'}, {...s, name: 'warm nine-pan eyeshadow palette', category: 'Makeup', shades: [{name: 'Honey', hex: '#c8913a', finish: 'shimmer', type: 'eyeshadow', use: 'lid wash'}]}, opts);
  assert.deepEqual(m.record.shades, [{name: 'Honey', hex: '#C8913A', finish: 'shimmer', type: 'eyeshadow', use: 'lid wash'}]);
});

test('plain names you typed are flagged for a better one; descriptive ones are not', async () => {
  const {vagueName} = await import('../public/intake.js');
  for (const n of ['ring', 'belt', 'earrings', 'watch', 'arm cuff (big)', 'ring (pinky)', 'silver earrings', 'gold necklace', 'hair clips', 'makeup palette'])
    assert.equal(vagueName(n), true, n);
  for (const n of ['doc martins', 'snake ring', 'heart earrings', 'silver rose ring', 'drippy necklace', 'silver beat up belt', 'cowgirl boots', 'gold hoop earrings', 'brown backpack', 'IMG 0409', ''])
    assert.equal(vagueName(n), false, n);
});

