import { extractUtteranceSlots } from '../src/module2/planning/planUtteranceSlots';
import { joinSttSegments } from '../src/services/sttJoin';
const SEG1 = 'ich möchte gerne am Montag nach Hamburg so gegen 9 Uhr los und möchte da irgendwie ganz entspannt typisch hamburgerisch frühstücken abends habe ich mir überlegt mal Hamburger';
const SEG2 = 'musst du die beste Ort wo man Hamburger pannenfisch essen kann vielleicht sogar mit mehr Blick vielleicht sogar Sonnenuntergang kann man dann am Montag einen guten Sonnenuntergang rechnen';
const SEG3 = 'Michel draufgehen dass ich ziemlich cool ja wie teuer ist das was ist der Michel überhaupt genau ansonsten wäre einfach ein bisschen Hamburger must have ne was da muss man so gesehen haben warum Hamburg Kennenlernen';
const FULL = joinSttSegments(joinSttSegments(SEG1, SEG2), SEG3);
const slots = extractUtteranceSlots(FULL);
for (const s of slots) {
  console.log(s.kind, s.title, 'michelInCtx', /michel/i.test(s.context), 'ctx', s.context.slice(0,120));
}
console.log('word boundary', /\bmichel\b/i.test(FULL));
console.log('any michel title', slots.some(s => /michel/i.test(s.title)));
