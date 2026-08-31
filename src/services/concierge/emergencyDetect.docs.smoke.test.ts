/**
 * Pure detect smoke without RN store imports.
 * Mirrors DOCS / FOOT / DENTIST priority from emergencyConcierge.
 */
import assert from 'assert';

const DENTIST_RE =
  /\b(zahnarzt|zahnärztin|zahnaerztin|zahnschmerzen?|zahnweh|zahn\s+gebrochen)\b/iu;
const FOOT_RE =
  /\b(fu[sß]|fuss|knöchel|knoechel|knie|bein|sprunggelenk).{0,24}\b(gebrochen|verstaucht|weh|schmerz|verletz)|(?:gebrochen|verstaucht).{0,24}\b(fu[sß]|fuss|knöchel|knoechel|knie|bein)\b/iu;
const DOCS_LOST_RE =
  /\b(reisepass|pass(?:wort)?|ausweis|personalausweis|konsulat|botschaft|auslandsvertretung|portemonnaie|geldbeutel|kreditkarte|geklaut|gestohlen)\b/iu;
const LOST_RE =
  /\b(verloren|verlaufen|verirrt|ich\s+(find|finde)\s+(den\s+weg\s+)?nicht|ich\s+hab\s+mich\s+(verlaufen|verirrt|verloren)|bin\s+ich\s+verloren|lost)\b/iu;

function detect(t: string): string | null {
  if (DENTIST_RE.test(t)) return 'dentist';
  if (FOOT_RE.test(t)) return 'hospital';
  if (DOCS_LOST_RE.test(t)) return 'docs';
  if (LOST_RE.test(t)) return 'lost';
  return null;
}

assert.strictEqual(
  detect('Ich habe meinen Reisepass verloren, wo ist mein Konsulat?'),
  'docs',
);
assert.strictEqual(
  detect('Mein Freund hat den Fuss gebrochen, wo koennen wir hin?'),
  'hospital',
);
assert.strictEqual(
  detect('Ich habe akute Zahnschmerzen, welcher Zahnarzt hat jetzt Notdienst?'),
  'dentist',
);
assert.strictEqual(
  detect('Ich habe mich verlaufen, wo ist mein Hotel?'),
  'lost',
);

console.log('emergencyDetect.docs.smoke: ok');
