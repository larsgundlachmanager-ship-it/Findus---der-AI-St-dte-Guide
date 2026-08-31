/**
 * Run: npx --yes tsx src/services/persona/userNameSpeechHint.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  applyFirstNameSpeechHint,
  displayNameSpeechSuggestion,
  preferAutoNameSpeechHint,
  previewSentenceForName,
  sanitizeNameSpeechHint,
  speechHintFromTranscript,
  suggestNameSpeechHints,
} from './userNameSpeechHint';

assert.equal(sanitizeNameSpeechHint(' Yonna! '), 'Yonna');
assert.equal(sanitizeNameSpeechHint('Yønna'), 'Ynna');
assert.equal(sanitizeNameSpeechHint('⟦joːna⟧'), 'jona');
assert.equal(sanitizeNameSpeechHint('123'), '');
assert.equal(sanitizeNameSpeechHint('Jonna-Marie'), 'Jonna-Marie');

assert.equal(
  applyFirstNameSpeechHint(
    'Moin Jonna, schön dass du da bist.',
    'Jonna',
    'Yonna',
    true,
  ),
  'Moin Yonna, schön dass du da bist.',
);
assert.equal(
  applyFirstNameSpeechHint('Moin Jonna.', 'Jonna', 'Jonna', true),
  'Moin Jonna.',
);
assert.equal(
  applyFirstNameSpeechHint('Moin Jonna.', 'Jonna', '', true),
  'Moin Jonna.',
);
assert.equal(
  applyFirstNameSpeechHint('Jonnas Jacke', 'Jonna', 'Yonna', true),
  'Jonnas Jacke',
);
assert.equal(
  applyFirstNameSpeechHint('JONNA kommt.', 'Jonna', 'Yonna', true),
  'YONNA kommt.',
);
assert.equal(
  applyFirstNameSpeechHint('Hallo Jürgen.', 'Jürgen', 'Yürgen', true),
  'Hallo Yürgen.',
);

assert.equal(
  applyFirstNameSpeechHint('Moin Jonna.', 'Jonna', 'Yonna', true),
  'Moin Yonna.',
);
assert.equal(
  applyFirstNameSpeechHint('Moin Jonna.', 'Jonna', 'Yonna', false),
  'Moin Jonna.',
);
assert.equal(
  applyFirstNameSpeechHint('Moin Jonna.', 'Jonna', 'Yonna'),
  'Moin Jonna.',
);

const jonnaHints = suggestNameSpeechHints('Jonna');
assert.ok(jonnaHints.includes('Yonna'), 'Jonna → Yonna Vorschlag');
assert.ok(!jonnaHints.includes('Jonna'), 'geschriebenen Namen nicht vorschlagen');
assert.equal(preferAutoNameSpeechHint('Jonna'), 'Yonna');
assert.equal(preferAutoNameSpeechHint('Jonne'), 'Yonne');
assert.equal(preferAutoNameSpeechHint('Maria'), '');
assert.equal(displayNameSpeechSuggestion('Jonne'), 'Yonne');
assert.equal(displayNameSpeechSuggestion('Lars'), 'Lars');
assert.equal(displayNameSpeechSuggestion('Lars', 'Lars'), 'Lars');

assert.equal(previewSentenceForName('Yonna'), 'Moin Yonna.');
assert.equal(speechHintFromTranscript('Ich heiße Yonna'), 'Yonna');
assert.equal(speechHintFromTranscript('Yonna.'), 'Yonna');

console.log('userNameSpeechHint.smoke.test.ts ok');
