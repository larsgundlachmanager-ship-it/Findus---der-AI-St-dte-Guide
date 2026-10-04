/**
 * Call-1 Referents smokes.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/call1Referents.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  formatCall1ReferentsForPrompt,
  parseCall1Referents,
  referentsFromFollowupBackup,
  validateCall1Referents,
} from './call1Referents';
import { emptyTurnFrame, parseTurnFrameFromLlm } from './turnFrame';

{
  const parsed = parseCall1Referents([
    { role: 'water', name: 'Alster', from: 'prior' },
    { role: 'bogus', name: 'X', from: 'prior' },
  ]);
  assert.equal(parsed.length, 1, 'only known roles');
  assert.equal(parsed[0]!.name, 'Alster');
}

{
  const refs = validateCall1Referents(
    [{ role: 'water', name: 'Alster', from: 'prior' }],
    {
      userText: 'Kann man da SUP fahren?',
      recentTexts: ['Wie groß ist die Alster?', 'Die Alster hat …'],
    },
  );
  assert.equal(refs.length, 1, 'alster in prior');

  const bad = validateCall1Referents(
    [{ role: 'water', name: 'Bodensee', from: 'prior' }],
    {
      userText: 'Kann man da SUP fahren?',
      recentTexts: ['Wie groß ist die Alster?'],
    },
  );
  assert.equal(bad.length, 0, 'invented referent dropped');
}

{
  const backup = referentsFromFollowupBackup('Kann man da Stand-up-Paddel fahren?', [
    { role: 'user', text: 'Wie groß ist die Alster?' },
    { role: 'assistant', text: 'Die Alster ist ein großer See in Hamburg.' },
  ]);
  assert.ok(
    backup.some((r) => r.role === 'water' && /alster/i.test(r.name)),
    'backup water from followup',
  );
}

{
  const frame = parseTurnFrameFromLlm(
    {
      referents: [{ role: 'water', name: 'Alster', from: 'prior' }],
      mustHaves: ['sup'],
    },
    null,
  );
  assert.ok(frame);
  assert.equal(frame!.referents?.[0]?.name, 'Alster');
}

{
  const block = formatCall1ReferentsForPrompt([
    { role: 'water', name: 'Alster', from: 'prior' },
  ]);
  assert.match(block, /CALL1_REFERENTS/);
  assert.match(block, /Alster/);
}

{
  const empty = emptyTurnFrame();
  assert.deepEqual(empty.referents, []);
}

console.log('call1Referents.smoke.test.ts ok');
