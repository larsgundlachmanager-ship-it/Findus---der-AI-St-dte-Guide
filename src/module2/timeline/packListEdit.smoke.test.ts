/**
 * Packlisten-Edit-Parser (ohne Store).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/timeline/packListEdit.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { looksLikePackListEdit, parsePackListEdit } from './packListEdit';

assert.equal(looksLikePackListEdit('Ergänze die Packliste um Sonnencreme'), true);
assert.equal(looksLikePackListEdit('Erstelle mir eine neue Packliste für Kiel'), false);

const add = parsePackListEdit('Ergänze die Packliste um Sonnencreme und Adapter');
assert.equal(add?.kind, 'add');
if (add?.kind === 'add') {
  assert.ok(add.labels.some((l) => /sonnencreme/i.test(l)));
  assert.ok(add.labels.some((l) => /adapter/i.test(l)));
}

const rm = parsePackListEdit('Streich den Pulli von der Packliste');
assert.equal(rm?.kind, 'remove');
if (rm?.kind === 'remove') assert.match(rm.query, /pulli/i);

const chk = parsePackListEdit('Hake den Reisepass auf der Packliste ab');
assert.equal(chk?.kind, 'check');
if (chk?.kind === 'check') {
  assert.equal(chk.done, true);
  assert.match(chk.query, /reisepass/i);
}

console.log('packListEdit.smoke.test.ts OK');
