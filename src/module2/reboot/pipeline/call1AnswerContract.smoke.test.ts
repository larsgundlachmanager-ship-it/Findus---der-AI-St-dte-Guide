/**
 * Call1→Call2 Vertrag: Situationen, topicCut, Flight/Compound Tips.
 */
import assert from 'node:assert/strict';
import {
  detectCall1Situation,
  getCall1AnswerContract,
  formatCall1AnswerContractForPrompt,
} from './call1AnswerContract';

assert.equal(
  detectCall1Situation(
    'Ich will Hamburger Pannfisch essen beim Sonnenuntergang mit Elbblick',
  ),
  'dining_compound',
);
assert.equal(
  getCall1AnswerContract(
    'Ich will Hamburger Pannfisch essen beim Sonnenuntergang mit Elbblick',
  ).topicCut,
  true,
);

assert.equal(
  detectCall1Situation('Wann muss ich am Flughafen sein?'),
  'flight_leave_by',
);
const flight = getCall1AnswerContract('Wann muss ich am Flughafen sein?');
assert.ok(flight.neededSlots.includes('leave_by_ms'));
assert.ok(flight.call2Tips.some((t) => /rückwärts|Leave-by/i.test(t)));

assert.equal(detectCall1Situation('Wie ist das Wetter morgen?'), 'weather');
assert.equal(detectCall1Situation('Wecker um 7'), 'alarm_timer');
assert.equal(
  detectCall1Situation('mag ich nicht', { correction: true }),
  'correction',
);

assert.equal(
  detectCall1Situation(
    'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf, Tour, stell mir einen Plan',
  ),
  'day_plan',
);
assert.ok(
  getCall1AnswerContract(
    'Morgen nach Hamburg, frühstücken und abends Pannfisch, Plan bitte',
  ).call2Tips.some((t) => /Tagesplan|Timeline/i.test(t)),
);

assert.equal(
  detectCall1Situation('Habe irgendwie Lust Dinosaurier zu sehen'),
  'interest_activity',
);
assert.ok(
  getCall1AnswerContract('Habe Lust Dinosaurier zu sehen').researchSlots.some(
    (s) => /expand|places/i.test(s),
  ),
);

assert.equal(
  detectCall1Situation(
    'In zwei Wochen fahre ich für ein Wochenende nach Lissabon',
  ),
  'reisebuero_collect',
);
assert.equal(
  detectCall1Situation(
    'Plane mir einen Wochenendurlaub nach Lissabon in zwei Wochen: Flug Hamburg hin und zurueck, Hotel und Programm',
  ),
  'reisebuero_collect',
  'Wochenendurlaub + Flug → Reisebüro, nicht Solo-Flug',
);
assert.equal(
  detectCall1Situation('Irgendwo warm, Reisebüro, Inspiration'),
  'reisebuero_collect',
);
assert.equal(
  detectCall1Situation('Bier irgendwo im Angebot?'),
  'product_offer',
  'product offer irgendwo ≠ Reisebüro',
);
assert.equal(
  detectCall1Situation('Milch und Butter irgendwo im Angebot?'),
  'product_offer',
  'multi product offer ≠ Reisebüro',
);
assert.equal(
  getCall1AnswerContract('Was gibt es für Bier im Angebot?').topicCut,
  true,
  'product offer topicCut',
);
assert.ok(
  getCall1AnswerContract(
    'In zwei Wochen fahre ich für ein Wochenende nach Lissabon',
  ).researchSlots.includes('pro_enrich_mandatory'),
);
assert.equal(
  detectCall1Situation(
    'Samstagabend wäre cool Live Musik — was kannst du mir vorschlagen?',
  ),
  'stay_day_interactive',
);
assert.ok(
  getCall1AnswerContract(
    'Samstagabend Live Musik, was schlägst du vor?',
  ).call2Tips.some((t) => /Aufenthalts-Tag|Timeline/i.test(t)),
);

const pack = formatCall1AnswerContractForPrompt(
  getCall1AnswerContract('Ich will Steak essen in Hamburg'),
);
assert.ok(/CALL1→CALL2 VERTRAG/.test(pack));
assert.ok(/dining_simple/.test(pack));

console.log('call1AnswerContract.smoke: ok');
