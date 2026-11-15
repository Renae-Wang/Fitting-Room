import test from 'node:test';
import assert from 'node:assert/strict';
import {genericName, describedRecord} from '../public/intake.js';

test('file and camera names count as unnamed; names you typed do not', () => {
  for (const n of ['', '  ', 'IMG 0409', 'IMG_0409', 'IMG 0409 2', 'IMG E0409', 'PXL 20261101 103211', 'DSC 1234', 'Screenshot 2026-11-01 at 10.32.11 AM', 'image (3)', 'New piece', '5F3A2B1C-9D4E-4F11', '0409'])
    assert.equal(genericName(n), true, n);
  for (const n of ['ring', 'belt', 'doc martins', 'Semi see through green top', 'IMG 0409 red skirt', 'ring (pinky)', 'arm cuff (big)', 'vans checkered slip ons'])
    assert.equal(genericName(n), false, n);
});

test('a description fills what is missing and corrects categories', () => {
  const opts = {categories: ['Tops', 'Bottoms', 'Makeup']};
  const s = {name: 'cream crinkle cap-sleeve blouse', category: 'Tops', description: 'Cream crinkled cotton blouse, cap sleeves, ends at the high hip.', colors: [{name: 'cream', hex: '#f3ead8'}, {name: 'bad', hex: 'cream'}], shades: [{name: 'x', hex: '#000000', finish: '', type: '', use: ''}]};
  const a = describedRecord({id: 'a', name: 'IMG 0409', category: '', photos: ['p']}, s, opts);
  assert.equal(a.record.name, s.name); assert.equal(a.record.category, 'Tops'); assert.equal(a.record.aiDescription, s.description);
  assert.deepEqual(a.record.colors, [{name: 'cream', hex: '#F3EAD8'}, {name: 'bad', hex: ''}], 'hex codes are checked');
  assert.equal(a.record.shades, undefined, 'shades are for makeup only');
  assert.deepEqual(a.filled, ['name', 'category', 'aiDescription', 'colors']);
  const b = describedRecord({id: 'b', name: 'doc martins', category: 'Bottoms', aiDescription: 'kept'}, s, opts);
  assert.equal(b.record.name, 'doc martins', 'a descriptive name you typed stays');
  assert.equal(b.record.category, 'Tops', 'a wrong category is corrected');
  assert.equal(b.record.aiDescription, 'kept', 'an existing description is kept');
  assert.equal(describedRecord({id: 'r', aiDescription: 'old', category: 'Tops'}, s, {...opts, refresh: true}).record.aiDescription, s.description, 'asking again refreshes it');
  const locked = describedRecord({id: 'l', name: 'ring', nameLocked: true, category: 'Bottoms', categoryLocked: true}, s, opts);
  assert.deepEqual(locked.filled, ['aiDescription', 'colors'], 'what you set by hand is never changed');
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

test('a plain name is replaced, keeping your note in brackets', () => {
  const opts = {categories: ['Jewelry']};
  const s = {name: 'slim silver band ring', category: 'Jewelry', color: 'silver'};
  assert.equal(describedRecord({name: 'ring (pinky)', category: 'Jewelry', color: 'gold'}, s, opts).record.name, 'slim silver band ring (pinky)');
  assert.equal(describedRecord({name: 'belt', category: 'Jewelry'}, s, opts).record.name, 'slim silver band ring');
  assert.equal(describedRecord({name: 'snake ring', category: 'Jewelry'}, s, opts).record.name, 'snake ring');
  assert.equal(describedRecord({name: 'IMG 0409 (2)', category: ''}, s, opts).record.name, 'slim silver band ring', 'file-name brackets are not notes');
});
